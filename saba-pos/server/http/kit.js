/**
 * A small HTTP layer: route matching, body parsing, static files and SSE.
 *
 * Written rather than installed. A POS that must still ring up a bill when
 * the internet is down has no business carrying a dependency tree it cannot
 * audit, and what a framework gives you here — a router and a body parser —
 * is two hundred lines.
 */

import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

import { config } from '../config.js';
import { log } from '../log.js';

/* --------------------------------------------------------------- errors --- */

/** Thrown by handlers. The error reaches the client as JSON with this status. */
export class HttpError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export const badRequest = (m, d) => new HttpError(400, m, d);
export const unauthorized = (m = 'Sign in to continue') => new HttpError(401, m);
export const forbidden = (m = 'Your role cannot do that') => new HttpError(403, m);
export const notFound = (m = 'Not found') => new HttpError(404, m);
export const conflict = (m, d) => new HttpError(409, m, d);

/* --------------------------------------------------------------- router --- */

/**
 * Routes are declared as `METHOD /path/:param` and matched segment by
 * segment. No regular expressions, no wildcards: every route in this product
 * is a fixed shape, and keeping it that way means a URL can never match a
 * handler the author did not intend.
 */
export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler, options = {}) {
    const parts = pattern.split('/').filter(Boolean);
    this.routes.push({
      method,
      parts,
      handler,
      // `auth: false` for the handful of endpoints reachable signed out.
      auth: options.auth !== false,
      /**
       * The screen this endpoint belongs to. The server refuses it to any
       * role that cannot open that screen — so hiding a button in the
       * browser is a courtesy, and this is the actual rule.
       */
      screen: options.screen || null,
      ability: options.ability || null,
      role: options.role || null,
    });
    return this;
  }

  get(p, h, o) { return this.add('GET', p, h, o); }
  post(p, h, o) { return this.add('POST', p, h, o); }
  patch(p, h, o) { return this.add('PATCH', p, h, o); }
  delete(p, h, o) { return this.add('DELETE', p, h, o); }

  match(method, pathname) {
    const parts = pathname.split('/').filter(Boolean);
    // HEAD is served by the GET handler; the body is dropped at the socket.
    const wanted = method === 'HEAD' ? 'GET' : method;

    let pathMatched = false;
    for (const route of this.routes) {
      if (route.parts.length !== parts.length) continue;
      const params = {};
      let ok = true;
      for (let i = 0; i < parts.length; i += 1) {
        const declared = route.parts[i];
        if (declared.startsWith(':')) params[declared.slice(1)] = decodeURIComponent(parts[i]);
        else if (declared !== parts[i]) { ok = false; break; }
      }
      if (!ok) continue;
      pathMatched = true;
      if (route.method === wanted) return { route, params };
    }
    // Tell the difference between "no such thing" and "wrong verb".
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}

/* ----------------------------------------------------------------- body --- */

const MAX_BODY = 8 * 1024 * 1024; // generous for a restore upload, finite for safety

export function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'That upload is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req) {
  const raw = await readBody(req);
  if (!raw.length) return {};
  try {
    const parsed = JSON.parse(raw.toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('expected an object');
    }
    return parsed;
  } catch (error) {
    throw badRequest(`The request body was not valid JSON: ${error.message}`);
  }
}

/* -------------------------------------------------------------- replies --- */

export function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload ?? null));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  });
  res.end(res.req?.method === 'HEAD' ? undefined : body);
}

export function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  const body = Buffer.from(text);
  res.writeHead(status, {
    'content-type': type,
    'content-length': body.length,
    'cache-control': 'no-store',
  });
  res.end(body);
}

export function sendFileDownload(res, filename, body, type = 'application/octet-stream') {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(200, {
    'content-type': type,
    'content-length': buffer.length,
    // Quoted and stripped of anything that could break out of the header.
    'content-disposition': `attachment; filename="${filename.replace(/[^\w.\-]/g, '_')}"`,
    'cache-control': 'no-store',
  });
  res.end(buffer);
}

/* --------------------------------------------------------------- cookies --- */

export function parseCookies(header) {
  const out = {};
  for (const pair of String(header || '').split(';')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const key = pair.slice(0, eq).trim();
    if (key) out[key] = decodeURIComponent(pair.slice(eq + 1).trim());
  }
  return out;
}

export function setCookie(res, name, value, { maxAge, clear } = {}) {
  const bits = [
    `${name}=${clear ? '' : encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    // Lax rather than Strict: the app is one origin, and Strict breaks a
    // terminal that reaches the till by following a bookmark.
    'SameSite=Lax',
  ];
  if (config.secureCookies) bits.push('Secure');
  bits.push(`Max-Age=${clear ? 0 : Math.floor(maxAge)}`);

  const existing = res.getHeader('set-cookie');
  const list = existing ? [].concat(existing) : [];
  list.push(bits.join('; '));
  res.setHeader('set-cookie', list);
}

/* ---------------------------------------------------------------- static --- */

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Serve a file from the app directory.
 *
 * The path is normalised and then checked to be inside the root — belt and
 * braces against `..` and against an encoded separator slipping through.
 */
export function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';

  const full = normalize(join(config.appDir, rel));
  if (full !== config.appDir && !full.startsWith(config.appDir + sep)) {
    sendText(res, 403, 'Forbidden');
    return true;
  }

  let info;
  try {
    info = statSync(full);
    if (info.isDirectory()) return false;
  } catch {
    return false;
  }

  const type = TYPES[extname(full).toLowerCase()] || 'application/octet-stream';
  const tag = `W/"${info.size}-${Number(info.mtimeMs).toString(36)}"`;

  if (req.headers['if-none-match'] === tag) {
    res.writeHead(304, { etag: tag });
    res.end();
    return true;
  }

  // The shell must never be stale after an upgrade; fingerprinted assets can
  // sit in cache. Everything here is small, so revalidation is cheap.
  const cache = /\.(png|jpe?g|svg|woff2|ico)$/i.test(full)
    ? 'public, max-age=86400, must-revalidate'
    : 'no-cache';

  res.writeHead(200, {
    'content-type': type,
    'content-length': info.size,
    'cache-control': cache,
    etag: tag,
  });

  if (req.method === 'HEAD') { res.end(); return true; }

  const stream = createReadStream(full);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
  return true;
}

/* -------------------------------------------------------------- requests --- */

export function clientAddress(req) {
  if (config.trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return String(forwarded).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

export const requestId = () => randomUUID().slice(0, 8);

/**
 * Reject cross-site writes.
 *
 * The session cookie is SameSite=Lax, which already blocks cross-site POSTs
 * from a form. This is the second lock: a state-changing request must either
 * carry no Origin (a same-origin fetch from the app, or curl) or an Origin
 * matching the Host it arrived on.
 */
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export { log };
