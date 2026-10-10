/**
 * Live updates.
 *
 * Every terminal holds one Server-Sent Events connection. When anything
 * changes, the server sends the new revision number — not the data. The
 * terminal compares it with the revision it last saw and, if it is behind,
 * fetches the working set.
 *
 * Sending a number rather than the change itself is the whole trick. It means
 * a terminal that was asleep, or wedged behind a flaky access point, or only
 * just plugged in, all recover by the same path: notice you are behind,
 * refetch. There is no patch stream to replay and nothing to get out of order.
 *
 * SSE rather than WebSockets because it is one-way traffic over plain HTTP —
 * it survives every proxy, reconnects by itself, and needs no library.
 */

import { config } from './config.js';
import { log } from './log.js';

/** @type {Set<{res: import('node:http').ServerResponse, id: string, user: string}>} */
const clients = new Set();
let heartbeat = null;

function write(client, event, data) {
  try {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch {
    drop(client);
    return false;
  }
}

function drop(client) {
  if (!clients.delete(client)) return;
  try { client.res.end(); } catch { /* already gone */ }
  log.debug('terminal disconnected', { id: client.id, remaining: clients.size });
  if (!clients.size && heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
}

/** Attach a request as a live terminal. Never resolves; the socket stays open. */
export function attach(req, res, { user, revision, id }) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    // Tell nginx not to buffer, or events arrive in clumps minutes apart.
    'x-accel-buffering': 'no',
  });

  // Ask the browser to wait a second before reconnecting, so a server restart
  // does not produce a thundering herd from every terminal in the building.
  res.write('retry: 1000\n\n');

  const client = { res, id, user: user?.name || 'unknown' };
  clients.add(client);
  log.debug('terminal connected', { id, user: client.user, total: clients.size });

  write(client, 'hello', { revision, serverTime: Date.now(), terminals: clients.size });

  if (!heartbeat) {
    heartbeat = setInterval(() => {
      for (const c of [...clients]) {
        // A bare comment line: keeps the connection warm, costs two bytes,
        // and is ignored by EventSource.
        try { c.res.write(': ping\n\n'); } catch { drop(c); }
      }
    }, Math.max(5, config.heartbeatSeconds) * 1000);
    heartbeat.unref?.();
  }

  const close = () => drop(client);
  req.on('close', close);
  req.on('error', close);
  res.on('error', close);
}

/**
 * Tell every terminal that the world has moved on.
 *
 * Coalesced on a short timer: settling a bill touches the order, the shift
 * and the audit log in one transaction, and that should wake the floor once,
 * not three times.
 */
let pending = null;
let pendingRevision = 0;

export function broadcast(revision, reason = 'change') {
  pendingRevision = Math.max(pendingRevision, revision);
  if (pending) return;
  pending = setTimeout(() => {
    const rev = pendingRevision;
    pending = null;
    pendingRevision = 0;
    for (const client of [...clients]) {
      write(client, 'revision', { revision: rev, reason });
    }
  }, 40);
  pending.unref?.();
}

/** Used when the server is going down, so terminals show it rather than hang. */
export function shutdown() {
  for (const client of [...clients]) {
    write(client, 'bye', { reason: 'The server is restarting' });
    drop(client);
  }
  if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
  if (pending) { clearTimeout(pending); pending = null; }
}

export const terminalCount = () => clients.size;

export const terminals = () =>
  [...clients].map((c) => ({ id: c.id, user: c.user }));
