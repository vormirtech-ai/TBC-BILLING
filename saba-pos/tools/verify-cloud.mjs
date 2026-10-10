#!/usr/bin/env node
/**
 * Prove the cloud schema against a real PostgreSQL.
 *
 *   node tools/verify-cloud.mjs "postgresql://user@host/db"
 *   node tools/verify-cloud.mjs --local        (spins up nothing; needs psql on PATH
 *                                               and PGHOST/PGPORT/PGUSER set)
 *
 * The sync's own logic is tested everywhere, against a stand-in, by
 * tests/sync/. This is the other half: that supabase/001_schema.sql and
 * 002_views.sql actually accept the rows the till produces, and that the
 * views add them up to the same figures the till's own reports show.
 *
 * It is not part of `npm test`, because it needs a PostgreSQL and the test
 * suite needs none. Run it when the SQL changes.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dsn = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;

const work = mkdtempSync(join(tmpdir(), 'saba-verify-'));
let failures = 0;

const psql = (sqlFile) => execFileSync('psql',
  [...(dsn ? [dsn] : []), '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-F', '|', '-f', sqlFile],
  { encoding: 'utf8' });

const query = (sql) => {
  const file = join(work, `q${Date.now()}${Math.random()}.sql`);
  writeFileSync(file, sql);
  return psql(file).trim();
};

const check = (label, actual, expected) => {
  const ok = String(actual) === String(expected);
  if (!ok) failures += 1;
  process.stdout.write(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label}`
    + (ok ? '\n' : `\n      expected ${expected}, got ${actual}\n`));
};

/* ------------------------------------------------- a till with history --- */

process.stdout.write('\n  Building a till with a month of trading…\n');

const dataDir = mkdtempSync(join(tmpdir(), 'saba-verify-db-'));
const { start } = await import('../server/main.js');
const db = await import('../server/db/index.js');
const store = await import('../server/store.js');
const { buildDayReport } = await import('../app/src/shared/takings.js');
const { TABLES, toRemote } = await import('../server/sync/tables.js');

const server = start({
  port: 9897, host: '127.0.0.1', dataDir, setupPin: '7391',
  seedDemo: true, logLevel: 'error',
});
await new Promise((r) => server.once('listening', r));

/* ------------------------------------------------------- load into pg --- */

process.stdout.write('  Running the migrations…\n');
psql(join(ROOT, 'supabase', '001_schema.sql'));
psql(join(ROOT, 'supabase', '002_views.sql'));

const COLUMN_TYPES = {
  orders: 'id text, number int, code text, business_day text, table_id text, status text,'
    + ' invoice_no int, opened_at bigint, closed_at bigint, total_paise bigint,'
    + ' covers int, doc jsonb, totals jsonb, updated_at bigint',
  audit: 'id bigint, at bigint, day text, kind text, actor text, message text, meta jsonb',
  shifts: 'id text, day text, opened_at bigint, opened_by text, closed_at bigint,'
    + ' closed_by text, float_paise bigint, counted_paise bigint, doc jsonb, updated_at bigint',
  counters: 'name text, value bigint',
  reservations: 'id text, at bigint, day text, status text, doc jsonb,'
    + ' updated_at bigint, deleted_at bigint',
  eighty_six: 'item_id text, by_name text, note text, at bigint',
  menu_items: 'id text, category text, station text, sort int, active boolean,'
    + ' doc jsonb, updated_at bigint',
  settings: 'key text, value jsonb, updated_at bigint',
  users: 'id text, name text, initials text, role text, active boolean,'
    + ' created_at bigint, updated_at bigint',
};
const DATE_COLUMNS = new Set(['business_day', 'day']);

process.stdout.write('  Loading it the way the sync would…\n');
let loaded = 0;

for (const table of TABLES) {
  const rows = db.all(`SELECT * FROM ${table.name}`).map((r) => toRemote(table, r));
  if (!rows.length) continue;

  const columns = Object.keys(rows[0]);
  const select = columns
    .map((c) => (DATE_COLUMNS.has(c) ? `${c}::date` : c))
    .join(', ');
  const update = columns.filter((c) => c !== table.key)
    .map((c) => `${c} = excluded.${c}`).join(', ');

  // jsonb_to_recordset is how PostgREST turns a JSON body into rows, so this
  // exercises the same path a real upsert takes.
  const file = join(work, `${table.name}.sql`);
  writeFileSync(file,
    `insert into public.${table.name} (${columns.join(', ')})\n`
    + `select ${select} from jsonb_to_recordset($SABA$${JSON.stringify(rows)}$SABA$::jsonb)\n`
    + `  as x(${COLUMN_TYPES[table.name]})\n`
    + `on conflict (${table.key}) do update set ${update};\n`);
  psql(file);
  loaded += rows.length;
  process.stdout.write(`      ${String(rows.length).padStart(5)}  ${table.name}\n`);
}

process.stdout.write(`\n  ${loaded} rows loaded. Checking the views say what the till says.\n\n`);

/* ------------------------------------------------------------- checks --- */

const day = store.today();
const report = buildDayReport(day, {
  settledOn: (d) => store.settledOn(d),
  ordersBetween: (a, b) => store.ordersBetween(a, b),
  openOrders: () => store.openOrders(),
  shiftFor: () => null,
});

check('every settled bill is in the cloud',
  query("select count(*) from public.orders where status = 'SETTLED';"),
  db.one("SELECT count(*) AS n FROM orders WHERE status = 'SETTLED'").n);

check("today's takings match the till's own day report",
  query(`select total_paise from public.v_daily_sales where business_day = '${day}';`),
  report.totals.total);

check('and so do the covers',
  query(`select covers from public.v_daily_sales where business_day = '${day}';`),
  report.totals.covers);

check('and the number of bills',
  query(`select bills from public.v_daily_sales where business_day = '${day}';`),
  report.totals.bills);

check('tax adds up to the same figure',
  query(`select coalesce(sum(tax_paise), 0) from public.v_tax_summary where business_day = '${day}';`),
  report.totals.taxTotal);

check('takings by tender add up to the day',
  query(`select coalesce(sum(total_paise), 0) from public.v_payments where business_day = '${day}';`),
  report.totals.total);

check('the bill view unpacks the document',
  query(`select count(*) from public.v_bills where business_day = '${day}' and table_label is not null;`),
  report.totals.bills);

check('items sold are counted',
  query(`select count(*) > 0 from public.v_item_sales where business_day = '${day}';`),
  't');

check('the health view covers every synced table',
  query('select count(*) from public.v_sync_health;'),
  6);

// A table with no rows yet is not a fault — no shift is open in the worked
// example — but one that has rows must say when it last heard from the till.
check('and every table that has rows knows when they arrived',
  query('select count(*) from public.v_sync_health where rows > 0 and last_seen is null;'),
  0);

check('no PIN material reached the cloud',
  query("select count(*) from information_schema.columns"
    + " where table_schema = 'public' and column_name in ('pin_hash', 'pin_salt');"),
  0);

check('row-level security is on for every table',
  query("select count(*) from pg_tables t join pg_class c on c.relname = t.tablename"
    + " where t.schemaname = 'public' and not c.relrowsecurity;"),
  0);

check('and forced, so even the table owner obeys it',
  query("select count(*) from pg_tables t join pg_class c on c.relname = t.tablename"
    + " where t.schemaname = 'public' and not c.relforcerowsecurity;"),
  0);

check('nothing is readable without a policy',
  query("select count(*) from pg_policies where schemaname = 'public';"),
  0);

/* --------------------------------------------------------------- done --- */

await server.shutdown({ graceMs: 200 });
try { db.closeDatabase(); } catch { /* closed */ }
rmSync(work, { recursive: true, force: true });
rmSync(dataDir, { recursive: true, force: true });

process.stdout.write(failures
  ? `\n  \x1b[31m${failures} check(s) failed\x1b[0m\n\n`
  : '\n  Everything the till produces, the cloud schema accepts and the views add up.\n\n');
process.exit(failures ? 1 : 0);
