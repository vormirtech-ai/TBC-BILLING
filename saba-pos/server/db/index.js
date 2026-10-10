/**
 * The database.
 *
 * SQLite through Node's own `node:sqlite`, which means the whole product has
 * no runtime dependencies at all — nothing to compile on the till, nothing to
 * go stale, nothing to audit. The module is still marked experimental in Node,
 * so the Docker image pins the Node version; every call to it is funnelled
 * through this one file, which is also what would make swapping in
 * better-sqlite3 a half-hour job rather than a rewrite.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from '../config.js';
import { log } from '../log.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Bump when schema.sql changes in a way an existing database needs told about. */
export const SCHEMA_VERSION = 1;

let db = null;

/** Prepared statements, cached per connection. Cleared when it closes. */
const cache = new Map();
let depth = 0;

/* --------------------------------------------------------------- open --- */

export function openDatabase({ file } = {}) {
  if (db) return db;

  mkdirSync(config.dataDir, { recursive: true });
  const path = file || join(config.dataDir, 'saba.db');

  db = new DatabaseSync(path);

  // WAL lets the kitchen display read while the till is writing, which is the
  // whole point of running several terminals against one database.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = FULL');   // a restaurant loses power; bills must not
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  db.exec(readFileSync(resolve(HERE, 'schema.sql'), 'utf8'));
  migrate(db);

  log.info('database open', { path });
  return db;
}

export function getDb() {
  if (!db) throw new Error('the database has not been opened yet');
  return db;
}

export function closeDatabase() {
  if (!db) return;
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch { /* closing anyway */ }
  db.close();
  db = null;
  // Prepared statements belong to the connection that made them. Keeping the
  // cache across a close would hand the next connection a pile of handles to
  // a database that no longer exists.
  cache.clear();
  depth = 0;
}

/* ------------------------------------------------------------ migrate --- */

/**
 * schema.sql is written with IF NOT EXISTS throughout, so it is safe to run
 * against an existing database and brings a new one fully up to date. This
 * function carries the changes that cannot be expressed that way — a column
 * added to an existing table, a backfill — one numbered step at a time.
 */
function migrate(handle) {
  const row = handle.prepare('SELECT schema_version FROM meta WHERE id = 1').get();
  if (!row) {
    handle.prepare(
      'INSERT INTO meta (id, revision, schema_version, installed_at) VALUES (1, 0, ?, ?)'
    ).run(SCHEMA_VERSION, Date.now());
    return;
  }

  let version = row.schema_version;
  if (version >= SCHEMA_VERSION) return;

  log.info('migrating database', { from: version, to: SCHEMA_VERSION });

  // Steps are deliberately dumb and forward-only. Add to this list; never
  // edit a step that has already shipped.
  const steps = {
    // 1: the initial schema, created by schema.sql above.
  };

  while (version < SCHEMA_VERSION) {
    version += 1;
    const step = steps[version];
    if (step) {
      handle.exec('BEGIN');
      try {
        step(handle);
        handle.prepare('UPDATE meta SET schema_version = ? WHERE id = 1').run(version);
        handle.exec('COMMIT');
      } catch (error) {
        handle.exec('ROLLBACK');
        throw new Error(`migration ${version} failed: ${error.message}`);
      }
    } else {
      handle.prepare('UPDATE meta SET schema_version = ? WHERE id = 1').run(version);
    }
  }
}

/* --------------------------------------------------------- statements --- */

/** Prepared statements are cached: the same dozen run thousands of times. */
export function stmt(sql) {
  let prepared = cache.get(sql);
  if (!prepared) {
    prepared = getDb().prepare(sql);
    cache.set(sql, prepared);
  }
  return prepared;
}

export const one = (sql, ...args) => stmt(sql).get(...args);
export const all = (sql, ...args) => stmt(sql).all(...args);
export const run = (sql, ...args) => stmt(sql).run(...args);

/* ------------------------------------------------------- transactions --- */

/**
 * Run `fn` inside a transaction and return its value.
 *
 * Nesting is handled with savepoints so a command that calls another command
 * cannot half-commit. Everything that changes state goes through here — which
 * is what makes "two terminals settle the same table at once" a non-event
 * rather than a corrupted bill.
 */
export function tx(fn) {
  const handle = getDb();
  const nested = depth > 0;
  const name = `sp${depth}`;

  handle.exec(nested ? `SAVEPOINT ${name}` : 'BEGIN IMMEDIATE');
  depth += 1;
  try {
    const result = fn();
    depth -= 1;
    handle.exec(nested ? `RELEASE ${name}` : 'COMMIT');
    return result;
  } catch (error) {
    depth -= 1;
    try {
      handle.exec(nested ? `ROLLBACK TO ${name}; RELEASE ${name}` : 'ROLLBACK');
    } catch (rollbackError) {
      log.error('rollback failed', { error: rollbackError.message });
    }
    throw error;
  }
}

/* ---------------------------------------------------------- revision --- */

/**
 * Every write bumps this. Terminals hold the revision they last saw; when the
 * server broadcasts a higher one they know to refetch. It is the smallest
 * thing that keeps four screens honest with each other.
 */
export function bumpRevision() {
  run('UPDATE meta SET revision = revision + 1 WHERE id = 1');
  return one('SELECT revision FROM meta WHERE id = 1').revision;
}

export const currentRevision = () =>
  one('SELECT revision FROM meta WHERE id = 1')?.revision ?? 0;

/* ----------------------------------------------------------- counters --- */

/** Next value of a named counter, allocated inside the caller's transaction. */
export function nextCounter(name, start = 1) {
  const row = one('SELECT value FROM counters WHERE name = ?', name);
  const value = row ? row.value + 1 : start;
  run(
    'INSERT INTO counters (name, value) VALUES (?, ?) '
    + 'ON CONFLICT (name) DO UPDATE SET value = excluded.value',
    name, value
  );
  return value;
}

export function peekCounter(name, fallback = 0) {
  return one('SELECT value FROM counters WHERE name = ?', name)?.value ?? fallback;
}

/* ------------------------------------------------------------ backup --- */

/**
 * A consistent copy of the database, WAL included.
 *
 * `VACUUM INTO` writes a complete, already-compacted database file in one
 * step while the restaurant keeps trading — which is the difference between a
 * backup you can restore and three files that were copied at slightly
 * different moments.
 */
export function backupTo(path) {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    throw new Error(`refusing to overwrite an existing backup at ${path}`);
  }
  getDb().exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
  return path;
}

/** Swap in a database file, keeping the one being replaced beside it. */
export function restoreFrom(sourcePath) {
  const target = join(config.dataDir, 'saba.db');
  const keep = join(config.dataDir, `saba.replaced-${Date.now()}.db`);

  // Check the candidate opens and carries our schema before touching the live
  // file. Restoring a corrupt or foreign database is not a recoverable mistake.
  const probe = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    const meta = probe.prepare('SELECT schema_version FROM meta WHERE id = 1').get();
    if (!meta) throw new Error('no meta row');
    if (meta.schema_version > SCHEMA_VERSION) {
      throw new Error(
        `that backup is from a newer version of Saba (schema ${meta.schema_version})`
      );
    }
    probe.prepare('SELECT count(*) AS n FROM orders').get();
  } catch (error) {
    probe.close();
    throw new Error(`that file is not a Saba backup: ${error.message}`);
  }
  probe.close();

  closeDatabase();
  copyFileSync(target, keep);
  copyFileSync(sourcePath, target);
  openDatabase();
  log.warn('database restored from backup', { from: sourcePath, previous: keep });
  return { restored: target, previous: keep };
}
