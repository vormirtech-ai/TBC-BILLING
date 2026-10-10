/**
 * The sync service.
 *
 * A background job on the till. It pushes what happened in the restaurant up
 * to Supabase, pulls back the configuration an owner may have changed from
 * somewhere else, and gets out of the way. The restaurant trades exactly the
 * same whether it is running, broken, or switched off — which is the point,
 * and the reason it is a job beside the till rather than a thing the till
 * depends on.
 *
 * How it decides what to send
 * ---------------------------
 * A high-water mark per table: the `updated_at` of the newest row already
 * sent. Next time, everything above it goes. No change log to keep in step
 * with the writes, nothing to go wrong if the process dies mid-batch — the
 * worst case is that the same rows are sent twice, and an upsert makes that
 * a no-op. A till off for a week catches up by the same path as one off for
 * a minute.
 *
 * What happens when two people change the same thing
 * --------------------------------------------------
 * Only configuration can be changed in two places, and only `updated_at`
 * decides: the newer edit wins, and the till wins a tie. Bills cannot
 * conflict because nothing but the till ever writes one.
 *
 * The one rule that outranks the rest: a sync must never interrupt service.
 * Every path here is wrapped so that a failure is recorded and retried, and
 * never thrown at somebody holding a card machine.
 */

import { all, one, run, tx } from '../db/index.js';
import { config } from '../config.js';
import { log } from '../log.js';
import { createClient, SyncError, redact } from './supabase.js';
import { TABLES, pushed, pulled, toRemote, toLocal } from './tables.js';

/** Rows per request. Large enough to be few trips, small enough to retry cheaply. */
const BATCH = 200;

const state = {
  running: false,
  timer: null,
  startedAt: 0,
  lastRun: null,
  lastError: null,
  lastSuccessAt: 0,
  consecutiveFailures: 0,
};

/* --------------------------------------------------------- watermarks --- */

const mark = (name) =>
  one('SELECT watermark, rows, at FROM sync_state WHERE name = ?', name)
  || { watermark: 0, rows: 0, at: 0 };

const setMark = (name, watermark, added) => run(
  'INSERT INTO sync_state (name, watermark, rows, at) VALUES (?, ?, ?, ?)'
  + ' ON CONFLICT (name) DO UPDATE SET watermark = excluded.watermark,'
  + ' rows = sync_state.rows + excluded.rows, at = excluded.at',
  name, watermark, added, Date.now()
);

/** How much is waiting to go up, without sending anything. */
export function pending() {
  const out = {};
  let total = 0;
  for (const table of pushed()) {
    const since = mark(`push:${table.name}`).watermark;
    const n = table.cursor
      ? one(`SELECT count(*) AS n FROM ${table.name} WHERE ${table.cursor} > ?`, since).n
      : 0;
    if (n) out[table.name] = n;
    total += n;
  }
  return { total, byTable: out };
}

/* --------------------------------------------------------------- push --- */

async function pushTable(client, table) {
  const name = `push:${table.name}`;

  // Two rows of counters, or a handful of 86'd dishes: send the lot.
  if (!table.cursor) {
    const rows = all(`SELECT * FROM ${table.name}`);
    if (table.mirror) {
      // Mirrored, so a dish put back on the menu stops being 86 in the cloud
      // too. Delete-then-insert is safe here precisely because this table
      // holds no money and no history.
      await client.deleteWhere(table.name, rows.length
        ? { [table.key]: `not.in.(${rows.map((r) => `"${r[table.key]}"`).join(',')})` }
        : { [table.key]: 'not.is.null' });
    }
    if (!rows.length) return 0;
    await client.upsert(table.name, rows.map((r) => toRemote(table, r)), {
      onConflict: table.key,
    });
    setMark(name, Date.now(), rows.length);
    return rows.length;
  }

  let since = mark(name).watermark;
  let sent = 0;

  for (;;) {
    const rows = all(
      `SELECT * FROM ${table.name} WHERE ${table.cursor} > ?`
      + ` ORDER BY ${table.cursor} LIMIT ${BATCH}`,
      since
    );
    if (!rows.length) break;

    await client.upsert(table.name, rows.map((r) => toRemote(table, r)), {
      onConflict: table.key,
    });

    // Advance only after the far end has taken them. A crash here resends the
    // batch next time, which an upsert absorbs.
    since = rows[rows.length - 1][table.cursor];
    setMark(name, since, rows.length);
    sent += rows.length;

    if (rows.length < BATCH) break;
  }

  return sent;
}

/* --------------------------------------------------------------- pull --- */

/**
 * Bring back configuration changed in the cloud.
 *
 * Only the tables marked `both`, and only when the cloud's row is genuinely
 * newer than the till's. A row the till changed a second ago is left alone,
 * so an owner editing a price in Supabase while a captain edits it on the
 * floor ends with the later of the two, not with whichever synced last.
 */
async function pullTable(client, table) {
  const name = `pull:${table.name}`;
  const since = mark(name).watermark;

  const rows = await client.select(table.name, {
    filter: { [table.cursor]: `gt.${since}` },
    order: `${table.cursor}.asc`,
    limit: BATCH * 5,
  });
  if (!rows.length) return 0;

  let applied = 0;
  let highest = since;

  tx(() => {
    for (const remote of rows) {
      highest = Math.max(highest, Number(remote[table.cursor]) || 0);

      const local = one(
        `SELECT * FROM ${table.name} WHERE ${table.key} = ?`, remote[table.key]
      );
      // The till wins a tie: if both say the same millisecond, the one that
      // took the money is the one to believe.
      if (local && Number(local[table.cursor]) >= Number(remote[table.cursor])) continue;

      const row = toLocal(table, remote);
      const columns = Object.keys(row);
      run(
        `INSERT INTO ${table.name} (${columns.join(', ')})`
        + ` VALUES (${columns.map(() => '?').join(', ')})`
        + ` ON CONFLICT (${table.key}) DO UPDATE SET `
        + columns.filter((c) => c !== table.key).map((c) => `${c} = excluded.${c}`).join(', '),
        ...columns.map((c) => row[c])
      );
      applied += 1;
    }
    if (applied) bumpLocalRevision();
  });

  setMark(name, highest, applied);
  return applied;
}

/**
 * Tell the terminals something changed under them.
 *
 * A price pulled from the cloud has to reach the tablet in the captain's
 * hand the same way a price changed in Setup does.
 */
function bumpLocalRevision() {
  run('UPDATE meta SET revision = revision + 1 WHERE id = 1');
}

/* ---------------------------------------------------------------- run --- */

export function isConfigured() {
  return Boolean(config.supabaseUrl && config.supabaseKey);
}

/**
 * One pass: everything up, then the configuration down.
 *
 * @param {object} [opts]
 * @param {string} [opts.reason] what asked for it, for the log
 * @returns {Promise<object>} what happened, for the Setup screen
 */
export async function runOnce({ reason = 'scheduled' } = {}) {
  if (!isConfigured()) {
    return { ok: false, skipped: 'not configured' };
  }
  if (state.running) {
    return { ok: false, skipped: 'already running' };
  }

  state.running = true;
  state.startedAt = Date.now();
  const started = Date.now();
  const result = { reason, pushed: {}, pulled: {}, ok: true, error: null };

  try {
    const client = createClient({ url: config.supabaseUrl, key: config.supabaseKey });

    for (const table of pushed()) {
      const n = await pushTable(client, table);
      if (n) result.pushed[table.name] = n;
    }
    for (const table of pulled()) {
      const n = await pullTable(client, table);
      if (n) result.pulled[table.name] = n;
    }

    state.lastError = null;
    state.lastSuccessAt = Date.now();
    state.consecutiveFailures = 0;

    const moved = Object.keys(result.pushed).length + Object.keys(result.pulled).length;
    if (moved) {
      log.info('cloud sync', {
        reason,
        up: Object.values(result.pushed).reduce((a, b) => a + b, 0),
        down: Object.values(result.pulled).reduce((a, b) => a + b, 0),
        ms: Date.now() - started,
      });
    }
  } catch (error) {
    result.ok = false;
    result.error = error instanceof SyncError ? error.message : 'The sync failed';
    state.consecutiveFailures += 1;
    state.lastError = {
      at: Date.now(),
      message: result.error,
      retryable: error.retryable !== false,
    };

    // A restaurant with no internet is the normal case, not an incident. Say
    // it once at warn, then keep quiet until it works again.
    const level = state.consecutiveFailures === 1 ? 'warn' : 'debug';
    log[level]('cloud sync failed', {
      reason,
      error: redact(result.error),
      failures: state.consecutiveFailures,
    });
  } finally {
    state.running = false;
    state.lastRun = { ...result, at: Date.now(), ms: Date.now() - started };
  }

  return result;
}

/* ------------------------------------------------------------ service --- */

/**
 * Start the background loop.
 *
 * Deliberately unref'd: the sync must never be the reason a till will not
 * shut down. The first pass waits a minute so it does not compete with a
 * restaurant opening its doors.
 */
export function start() {
  if (!isConfigured()) {
    log.info('cloud sync is off', { reason: 'no Supabase project configured' });
    return null;
  }
  if (state.timer) return state.timer;

  const every = Math.max(1, config.syncMinutes) * 60_000;

  const tick = () => {
    runOnce({ reason: 'scheduled' }).catch(() => { /* already recorded */ });
  };

  setTimeout(tick, 60_000).unref();
  state.timer = setInterval(tick, every).unref();

  log.info('cloud sync is on', {
    every: `${config.syncMinutes}m`,
    project: hostOf(config.supabaseUrl),
  });
  return state.timer;
}

export function stop() {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
}

const hostOf = (url) => {
  try { return new URL(url).host; } catch { return 'unknown'; }
};

/** What the Setup screen shows. Never includes the key. */
export function status() {
  const waiting = isConfigured() ? pending() : { total: 0, byTable: {} };
  return {
    configured: isConfigured(),
    enabled: Boolean(state.timer),
    project: isConfigured() ? hostOf(config.supabaseUrl) : null,
    everyMinutes: config.syncMinutes,
    running: state.running,
    lastSuccessAt: state.lastSuccessAt || null,
    lastError: state.lastError,
    lastRun: state.lastRun,
    pending: waiting.total,
    pendingByTable: waiting.byTable,
    tables: TABLES.map((t) => ({ name: t.name, direction: t.direction })),
  };
}

/** Check the project answers and the schema is there, without syncing. */
export async function check() {
  if (!isConfigured()) throw new SyncError('No Supabase project is configured');
  const client = createClient({ url: config.supabaseUrl, key: config.supabaseKey });
  await client.check();
  return { ok: true, project: hostOf(config.supabaseUrl) };
}
