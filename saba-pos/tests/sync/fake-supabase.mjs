/**
 * A Supabase stand-in.
 *
 * Enough of PostgREST to exercise the sync: upsert with merge-duplicates,
 * select with a greater-than filter and an order, and the one delete the 86
 * board needs. It is a test double, not an implementation — it exists so the
 * sync's own logic (watermarks, batching, retry, the conflict rule) can be
 * tested on any machine, with no Postgres and no network.
 *
 * The SQL that a real Supabase project runs is verified separately, against
 * an actual PostgreSQL, by tools/verify-cloud.mjs.
 */

import { createServer } from 'node:http';

export async function startFakeSupabase({ key = 'test-service-key' } = {}) {
  /** table name → Map of primary key → row */
  const tables = new Map();
  const seen = { requests: [], failNext: 0, failStatus: 503, offline: false };

  const table = (name) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name);
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fake');
    const name = url.pathname.replace(/^\/rest\/v1\//, '');
    const reply = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };

    seen.requests.push({ method: req.method, name, query: url.search });

    if (seen.offline) { req.destroy(); return; }
    if (seen.failNext > 0) { seen.failNext -= 1; return reply(seen.failStatus, { message: 'nope' }); }

    const apikey = req.headers.apikey || '';
    if (apikey !== key) return reply(401, { message: 'Invalid API key' });

    let body = '';
    for await (const chunk of req) body += chunk;

    // --- upsert -----------------------------------------------------------
    if (req.method === 'POST') {
      const rows = body ? JSON.parse(body) : [];
      const pk = url.searchParams.get('on_conflict') || 'id';
      for (const row of rows) table(name).set(String(row[pk]), { ...row });
      return reply(201, undefined);
    }

    // --- select -----------------------------------------------------------
    if (req.method === 'GET') {
      let rows = [...table(name).values()];
      for (const [column, expr] of url.searchParams) {
        if (['select', 'order', 'limit', 'on_conflict'].includes(column)) continue;
        const [op, ...rest] = String(expr).split('.');
        const value = rest.join('.');
        if (op === 'gt') rows = rows.filter((r) => Number(r[column]) > Number(value));
        if (op === 'eq') rows = rows.filter((r) => String(r[column]) === value);
      }
      const order = url.searchParams.get('order');
      if (order) {
        const [column, dir] = order.split('.');
        rows.sort((a, b) => (dir === 'desc' ? -1 : 1)
          * (Number(a[column]) - Number(b[column]) || String(a[column]).localeCompare(String(b[column]))));
      }
      const limit = Number(url.searchParams.get('limit'));
      if (Number.isFinite(limit)) rows = rows.slice(0, limit);
      return reply(200, rows);
    }

    // --- delete -----------------------------------------------------------
    if (req.method === 'DELETE') {
      for (const [column, expr] of url.searchParams) {
        const text = String(expr);
        if (text.startsWith('not.in.(')) {
          const keep = new Set(text.slice(8, -1).split(',').map((s) => s.replace(/^"|"$/g, '')));
          for (const [k, row] of table(name)) {
            if (!keep.has(String(row[column]))) table(name).delete(k);
          }
        } else if (text === 'not.is.null') {
          table(name).clear();
        }
      }
      return reply(204, undefined);
    }

    reply(405, { message: 'not allowed' });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}`,
    key,
    rows: (name) => [...table(name).values()],
    count: (name) => table(name).size,
    requests: seen.requests,
    /** Make the next n requests fail, to exercise the retry path. */
    failNext(n, status = 503) { seen.failNext = n; seen.failStatus = status; },
    /** Pull the cable out. */
    goOffline() { seen.offline = true; },
    comeBack() { seen.offline = false; },
    put(name, row, pk = 'id') { table(name).set(String(row[pk]), { ...row }); },
    async stop() {
      await new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); });
    },
  };
}
