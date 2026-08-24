/**
 * Dining tables and the QR code stuck to each one.
 *
 * Every table carries a TOKEN — a short random string generated when the table
 * is created. The QR code encodes the site address plus that token, so scanning
 * it opens the customer menu already knowing which table the phone is sitting
 * at. Nothing about the cafe's data is in the code itself: the token is a name
 * to look up, not a payload, so a photographed QR code gives away nothing more
 * than the table number.
 *
 * Tokens can be regenerated. If a code leaks, or a printed card walks off, a
 * new token retires the old card instantly.
 */

import { STORES, getAll, getByKey, put, remove, putMany, clearStore } from '../db/database.js';
import { requireAdmin, requireSignedIn } from '../core/session.js';
import { AppError, uid, matchesQuery } from '../core/utils.js';
import { TABLE_STATUS } from '../config/app.config.js';
import { getSettings } from './settings.repo.js';

let cache = null;
const listeners = new Set();

export function onTablesChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function announce() {
  listeners.forEach((fn) => fn(cache));
}

/**
 * Natural ordering: zone first, then table numbers as numbers, so Table 10
 * comes after Table 9 rather than after Table 1.
 */
function sortTables(rows) {
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  return rows.sort(
    (a, b) =>
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
      collator.compare(a.zone || '', b.zone || '') ||
      collator.compare(a.name, b.name)
  );
}

/* --------------------------------------------------------------- token --- */

/**
 * A short, URL-safe, hard-to-guess token. Uses the crypto generator when the
 * page is on https (always, once hosted) and falls back so the app still runs
 * from a plain local file server.
 */
function randomToken(length = 12) {
  const alphabet = 'abcdefghijkmnopqrstuvwxyz23456789'; // no look-alike 0/o/1/l
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

async function uniqueToken() {
  // A collision is vanishingly unlikely, but a duplicate token would send two
  // tables' orders to one place, so it is checked rather than assumed.
  for (let attempt = 0; attempt < 8; attempt++) {
    const token = randomToken();
    if (!(await findByToken(token))) return token;
  }
  throw new AppError('Could not generate a unique table code. Try again.', 'TOKEN_CLASH');
}

/* --------------------------------------------------------------- reads --- */

export async function loadTables() {
  cache = sortTables(await getAll(STORES.TABLES));
  return cache;
}

export function getTables({ activeOnly = false } = {}) {
  const rows = cache || [];
  return activeOnly ? rows.filter((row) => row.active !== false) : rows;
}

export function getTable(id) {
  return getTables().find((row) => row.id === id) || null;
}

/** Resolve the token from a scanned QR code back to its table. */
export async function findByToken(token) {
  const key = String(token || '').trim();
  if (!key) return null;

  const cached = getTables().find((row) => row.token === key);
  if (cached) return cached;

  // A customer's phone has its own copy of the database and may not have the
  // list cached yet, so fall back to storage.
  const rows = await getAll(STORES.TABLES);
  return rows.find((row) => row.token === key) || null;
}

export function getZones() {
  const seen = [];
  for (const table of getTables()) {
    const zone = table.zone || 'Main';
    if (!seen.includes(zone)) seen.push(zone);
  }
  return seen;
}

export function searchTables({ query = '', zone = 'All', status = 'All' } = {}) {
  return getTables().filter((table) => {
    if (zone !== 'All' && (table.zone || 'Main') !== zone) return false;
    if (status !== 'All' && (table.status || TABLE_STATUS.FREE) !== status) return false;
    if (!query) return true;
    return matchesQuery(table.name, query) || matchesQuery(table.zone, query);
  });
}

/* ------------------------------------------------------------ QR links --- */

/**
 * The address the QR code points at.
 *
 * Normally worked out from wherever the app is being used, which is right for
 * GitHub Pages, a custom domain or a laptop on the counter alike. An admin can
 * override it in Settings for the one case that needs it: printing codes
 * somewhere other than where customers will scan them.
 */
export function siteBaseUrl() {
  const configured = String(getSettings().publicSiteUrl || '').trim();
  if (configured) {
    const withoutHash = configured.split('#')[0];
    return withoutHash.endsWith('/') ? withoutHash : `${withoutHash}/`;
  }
  const { origin, pathname } = window.location;
  return `${origin}${pathname.replace(/[^/]*$/, '')}`;
}

/**
 * The connection a scanned phone needs, packed for a URL.
 *
 * A customer's phone has never seen this cafe and has no way to reach its
 * database unless the table card tells it how, so the card carries the address
 * and the public key. That key is public by design — every Supabase web app
 * ships it in its own JavaScript — and putting it on a printed card keeps it to
 * people standing in the cafe rather than on the open web.
 *
 * It is also why the app never lets a signed-out device write anything except
 * the order it just placed.
 */
function connectionParam() {
  const settings = getSettings();
  if (!settings.cloudSyncEnabled || !settings.cloudSyncUrl || !settings.cloudSyncKey) return null;

  return btoa(
    JSON.stringify({
      v: 1,
      url: settings.cloudSyncUrl,
      key: settings.cloudSyncKey,
      table: settings.cloudSyncTable || 'tbc_sync',
    })
  )
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * The full link a customer's phone opens when it scans this table's code.
 *
 * The token identifies the table; the name rides along purely so the phone can
 * say "Table 7" without needing a copy of the cafe's table list. Only the token
 * is trusted — the counter always resolves it against its own tables.
 */
export function tableOrderUrl(table) {
  const params = new URLSearchParams({ t: table.token, n: table.name });
  const connection = connectionParam();
  if (connection) params.set('c', connection);
  return `${siteBaseUrl()}#/order?${params.toString()}`;
}

/** Whether table codes currently carry the cafe connection. */
export function tableCodesCarryConnection() {
  return connectionParam() !== null;
}

/* -------------------------------------------------------------- writes --- */

function validate(draft, { existingId = null } = {}) {
  const name = String(draft.name || '').trim();
  if (!name) throw new AppError('Give the table a name or number.', 'VALIDATION');
  if (name.length > 40) throw new AppError('Table names are limited to 40 characters.', 'VALIDATION');

  const clash = getTables().find(
    (table) => table.id !== existingId && table.name.toLowerCase() === name.toLowerCase()
  );
  if (clash) throw new AppError(`There is already a table called "${name}".`, 'DUPLICATE');

  const seats = Math.round(Number(draft.seats) || 0);
  if (seats < 0 || seats > 99) throw new AppError('Enter a seat count between 0 and 99.', 'VALIDATION');

  return { name, seats };
}

export async function createTable(draft) {
  requireAdmin('adding tables');
  const { name, seats } = validate(draft);
  const now = new Date().toISOString();

  const table = {
    id: uid('tbl'),
    name,
    seats,
    zone: String(draft.zone || '').trim() || 'Main',
    token: await uniqueToken(),
    status: TABLE_STATUS.FREE,
    notes: String(draft.notes || '').trim(),
    active: draft.active !== false,
    sortOrder: getTables().length,
    createdAt: now,
    updatedAt: now,
  };

  await put(STORES.TABLES, table);
  cache = sortTables([...getTables(), table]);
  announce();
  return table;
}

/**
 * Set up a room in one go — "add tables 1 to 12" is how a cafe actually thinks
 * about this, and doing it one dialog at a time is twelve dialogs.
 */
export async function createTables({ count, prefix = 'Table ', startAt = 1, seats = 4, zone = 'Main' }) {
  requireAdmin('adding tables');
  const total = Math.round(Number(count) || 0);
  if (total < 1 || total > 100) {
    throw new AppError('Add between 1 and 100 tables at a time.', 'VALIDATION');
  }

  const now = new Date().toISOString();
  const existingNames = new Set(getTables().map((table) => table.name.toLowerCase()));
  const created = [];
  let sortOrder = getTables().length;

  for (let i = 0; i < total; i++) {
    const name = `${prefix}${Number(startAt) + i}`.trim();
    // Skip names already in use rather than failing the whole batch: adding
    // "1 to 12" when 1 to 4 exist should quietly add the missing eight.
    if (existingNames.has(name.toLowerCase())) continue;

    created.push({
      id: uid('tbl'),
      name,
      seats: Math.max(0, Math.round(Number(seats) || 0)),
      zone: String(zone || '').trim() || 'Main',
      token: await uniqueToken(),
      status: TABLE_STATUS.FREE,
      notes: '',
      active: true,
      sortOrder: sortOrder++,
      createdAt: now,
      updatedAt: now,
    });
    existingNames.add(name.toLowerCase());
  }

  if (!created.length) {
    throw new AppError('Every table in that range already exists.', 'DUPLICATE');
  }

  await putMany(STORES.TABLES, created);
  cache = sortTables([...getTables(), ...created]);
  announce();
  return created;
}

export async function updateTable(id, patch) {
  requireAdmin('editing tables');
  const existing = await getByKey(STORES.TABLES, id);
  if (!existing) throw new AppError('That table no longer exists.', 'NOT_FOUND');

  const merged = { ...existing, ...patch };
  const { name, seats } = validate(merged, { existingId: id });

  const table = {
    ...merged,
    name,
    seats,
    zone: String(merged.zone || '').trim() || 'Main',
    notes: String(merged.notes || '').trim(),
    token: existing.token, // only regenerateToken changes this
    updatedAt: new Date().toISOString(),
  };

  await put(STORES.TABLES, table);
  cache = sortTables(getTables().map((row) => (row.id === id ? table : row)));
  announce();
  return table;
}

/** Retire the printed card for a table and issue a new one. */
export async function regenerateToken(id) {
  requireAdmin('regenerating a table code');
  const existing = await getByKey(STORES.TABLES, id);
  if (!existing) throw new AppError('That table no longer exists.', 'NOT_FOUND');

  const table = { ...existing, token: await uniqueToken(), updatedAt: new Date().toISOString() };
  await put(STORES.TABLES, table);
  cache = sortTables(getTables().map((row) => (row.id === id ? table : row)));
  announce();
  return table;
}

/**
 * Move a table between free, seated and ordered.
 * Any signed-in user can do this — it is ordinary floor work.
 */
export async function setStatus(id, status) {
  requireSignedIn();
  if (!Object.values(TABLE_STATUS).includes(status)) {
    throw new AppError('That is not a table status.', 'VALIDATION');
  }
  const existing = await getByKey(STORES.TABLES, id);
  if (!existing) return null;

  const table = { ...existing, status, updatedAt: new Date().toISOString() };
  await put(STORES.TABLES, table);
  cache = sortTables(getTables().map((row) => (row.id === id ? table : row)));
  announce();
  return table;
}

export async function deleteTable(id) {
  requireAdmin('deleting tables');
  await remove(STORES.TABLES, id);
  cache = getTables().filter((row) => row.id !== id);
  announce();
  return true;
}

/* ------------------------------------------------------ backup support --- */

export async function replaceAll(tables) {
  await clearStore(STORES.TABLES);
  if (tables?.length) await putMany(STORES.TABLES, tables);
  await loadTables();
  announce();
}
