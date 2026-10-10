/**
 * The server.
 *
 * Boot order: open the database, seed it if it is empty, wire the request
 * pipeline, listen, and arrange to shut down without losing a write.
 */

import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';

import { config, configure } from './config.js';
import { log } from './log.js';
import { openDatabase, closeDatabase, currentRevision } from './db/index.js';
import { router } from './api.js';
import * as auth from './auth.js';
import * as live from './live.js';
import { ensureSeeded } from './seed.js';
import { loadCharges, loadFloorPlan } from './store.js';
import * as sync from './sync/index.js';
import {
  HttpError, serveStatic, sendJson, sendText, parseCookies, setCookie,
  clientAddress, requestId, sameOrigin,
} from './http/kit.js';
import { APP, mayOpen } from '../app/src/shared/config.js';

/* ------------------------------------------------------------ pipeline --- */

/**
 * One request.
 *
 * Authentication, same-origin checking and route permissions all happen here,
 * before any handler runs — so a handler can assume it is being called by
 * somebody allowed to call it.
 */
async function handle(req, res) {
  const started = process.hrtime.bigint();
  const id = requestId();
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;
  let status = 500;

  try {
    // Anything not under /api is the app itself.
    if (!pathname.startsWith('/api/')) {
      if (serveStatic(req, res, pathname)) {
        status = res.statusCode;
        return;
      }
      // A deep link such as /#/floor is still index.html; anything else is a
      // genuine 404 rather than a silently wrong page.
      if (!pathname.includes('.') && serveStatic(req, res, '/index.html')) {
        status = res.statusCode;
        return;
      }
      status = 404;
      sendText(res, 404, 'Not found');
      return;
    }

    const matched = router.match(req.method, pathname);
    if (!matched) {
      status = 404;
      sendJson(res, 404, { error: 'No such endpoint', path: pathname });
      return;
    }
    if (matched.methodNotAllowed) {
      status = 405;
      sendJson(res, 405, { error: `${req.method} is not allowed here` });
      return;
    }

    const { route, params } = matched;

    // Cross-site writes are refused outright. The session cookie is already
    // SameSite=Lax; this is the second lock on the same door.
    if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) {
      status = 403;
      sendJson(res, 403, { error: 'Cross-site requests are not accepted' });
      return;
    }

    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[auth.COOKIE] || null;
    const user = route.auth ? auth.sessionUser(token) : auth.sessionUser(token);

    if (route.auth && !user) {
      status = 401;
      sendJson(res, 401, { error: 'Sign in to continue', code: 'SIGNED_OUT' });
      return;
    }
    if (route.screen && !mayOpen(user.role, route.screen)) {
      throw new HttpError(403, `A ${user.role} cannot use that part of the system`);
    }
    if (route.ability) auth.requireAbility(user, route.ability);
    if (route.role) auth.requireRole(user, route.role);

    req.params = params;
    req.query = url.searchParams;

    const ctx = {
      id,
      user,
      token,
      address: clientAddress(req),
      setSession(value, maxAgeMs) {
        setCookie(res, auth.COOKIE, value, { maxAge: maxAgeMs / 1000 });
      },
      clearSession() {
        setCookie(res, auth.COOKIE, '', { clear: true });
      },
    };

    const outcome = await route.handler(req, res, ctx);

    // An SSE handler owns the socket from here; do not touch it again.
    if (outcome === 'streaming') return;

    status = res.statusCode;

    // Any successful command may have moved the world on. Telling the other
    // terminals is done after the reply, so the caller is never kept waiting
    // on a fan-out.
    if (req.method !== 'GET' && req.method !== 'HEAD' && status < 400) {
      live.broadcast(currentRevision(), pathname);
    }
  } catch (error) {
    status = error instanceof HttpError ? error.status : 500;
    if (status >= 500) {
      log.error('request failed', { id, path: pathname, error: error.message, stack: error.stack?.split('\n')[1]?.trim() });
    } else {
      log.debug('request refused', { id, path: pathname, status, error: error.message });
    }
    if (!res.headersSent) {
      sendJson(res, status, {
        error: status >= 500 ? 'Something went wrong at the server' : error.message,
        detail: status >= 500 ? undefined : error.detail,
      });
    } else {
      res.destroy();
    }
  } finally {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    if (pathname !== '/api/events') {
      log.debug('request', { id, method: req.method, path: pathname, status, ms: ms.toFixed(1) });
    }
    // A slow request on a till is worth knowing about even in production.
    if (ms > 250 && pathname !== '/api/events') {
      log.warn('slow request', { path: pathname, ms: ms.toFixed(0) });
    }
  }
}

/* ---------------------------------------------------------------- boot --- */

function localAddresses(port) {
  const out = [];
  for (const [, list] of Object.entries(networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(`http://${net.address}:${port}`);
    }
  }
  return out;
}

/**
 * Start the server.
 *
 * @param {object} [overrides] configuration to apply first — see config.js.
 *   The environment is the normal way to configure an install; this exists so
 *   the server can be started inside another process, which is how the tests
 *   run a real one per case.
 */
export function start(overrides) {
  if (overrides) configure(overrides);

  openDatabase();
  ensureSeeded();
  loadCharges();     // the restaurant's own rates, before a single bill is costed
  loadFloorPlan();   // and its own room, before a single table is drawn
  sync.start();      // the cloud copy, if one is configured

  const server = createServer(handle);

  // A kitchen display holds its event stream open for a whole service, so a
  // request is never timed out. Headers still are: a connection that opens
  // and then says nothing is not a terminal.
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;
  server.keepAliveTimeout = 72_000;

  server.on('clientError', (error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  server.listen(config.port, config.host, () => {
    log.info(`${APP.suite} ${APP.version} is running`, {
      port: config.port,
      data: config.dataDir,
    });
    for (const address of [`http://localhost:${config.port}`, ...localAddresses(config.port)]) {
      log.info(`  open ${address}`);
    }
  });

  /* -------------------------------------------------------- shutdown --- */

  /**
   * Stop taking requests, let what is in flight finish, close the database.
   *
   * Idle keep-alive sockets are hung up explicitly. Without that, a close
   * waits out `keepAliveTimeout` on every terminal that has merely gone
   * quiet — over a minute of a restart spent waiting for connections that
   * have nothing to say. The stragglers that are still mid-request get a
   * grace period and are then cut.
   */
  let closing = null;
  server.shutdown = ({ graceMs = 4000 } = {}) => {
    if (closing) return closing;

    closing = new Promise((resolve) => {
      let settled = false;
      const finish = (forced) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { closeDatabase(); } catch (error) {
          log.error('could not close the database cleanly', { error: error.message });
        }
        if (forced) log.warn('shut down with connections still open');
        else log.info('stopped cleanly');
        resolve();
      };

      sync.stop();                      // no new sync passes from here
      live.shutdown();                  // end every event stream politely
      server.close(() => finish(false));
      server.closeIdleConnections();    // and hang up on whoever is just loitering

      const timer = setTimeout(() => {
        server.closeAllConnections();
        finish(true);
      }, graceMs);
      timer.unref();
    });

    return closing;
  };

  return server;
}

/**
 * Wire Ctrl-C and `systemctl stop` to a clean shutdown.
 *
 * Only the command line does this. `start()` is also how the tests run a
 * server per case, and seventy of those each adding four process listeners is
 * both a warning in the output and a leak.
 */
export function installSignalHandlers(server) {
  const stop = (signal) => {
    log.info(`${signal} received, shutting down`);
    server.shutdown().then(() => process.exit(0));
  };

  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  // A crash must not leave the database half-written or the port held.
  process.on('uncaughtException', (error) => {
    log.error('uncaught exception', { error: error.message, stack: error.stack });
    try { closeDatabase(); } catch { /* going down anyway */ }
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    log.error('unhandled rejection', { reason: String(reason) });
  });

  return server;
}

// `node server/main.js` starts it; importing it (as the tests do) does not.
if (import.meta.url === `file://${process.argv[1]}`) installSignalHandlers(start());
