/**
 * Keeping this device and the shared database in step.
 *
 * HOW IT WORKS
 * The till writes to its own storage first, always, and never waits for the
 * network to finish a sale. Every write also drops a note in an outbox, in the
 * same storage transaction, so a bill and the reminder to send it can never
 * come apart. A loop then does two things, over and over:
 *
 *   PUSH — drain the outbox up to the shared database.
 *   PULL — ask for everything changed since we last looked, and apply it.
 *
 * That ordering matters. Pushing first means this device's own work is safe
 * before anything can overwrite it.
 *
 * WHEN TWO DEVICES DISAGREE
 * Last write wins, judged by the SERVER's clock rather than either device's —
 * a till with the wrong date must not be able to bury someone else's work. For
 * a cafe this is the right trade: the alternative is asking a cashier to
 * resolve a merge conflict mid-queue.
 *
 * Bills are the exception that needs no rule. Each one is written once and
 * never edited, apart from being voided, so two tills cannot fight over one.
 */

import {
  STORES,
  STORE_KEYS,
  SYNCED_STORES,
  clearStore,
  getAll,
  getByKey,
  applyRemoteBatch,
  readOutbox,
  clearOutboxEntries,
  outboxSize,
  enqueueManyForSync,
} from '../db/database.js';
import * as cloud from './cloudSync.service.js';
import { getSettings, replaceSettings, loadSettings } from '../repositories/settings.repo.js';
import { getSession } from '../core/session.js';
import { loadMenu } from '../repositories/menu.repo.js';
import { loadInventory } from '../repositories/inventory.repo.js';
import { loadStaff } from '../repositories/staff.repo.js';
import { loadTables } from '../repositories/tables.repo.js';
import { announceOrders } from '../repositories/onlineOrders.repo.js';

const CURSOR_KEY = 'tbc.sync.cursor';
const SEEDED_KEY = 'tbc.sync.seeded';

/**
 * Settings that belong to this device, not to the cafe.
 *
 * The connection details must never travel: if they did, switching the shared
 * database off on one laptop would switch it off on the counter too, and a
 * device with a bad key could push that key everywhere.
 */
const DEVICE_ONLY_SETTINGS = [
  'cloudSyncEnabled',
  'cloudSyncUrl',
  'cloudSyncKey',
  'cloudSyncTable',
  'cloudSyncPollSeconds',
];

const listeners = new Set();
let state = {
  running: false,
  busy: false,
  lastSyncAt: null,
  lastError: null,
  pending: 0,
  pulled: 0,
  pushed: 0,
};

export function onSyncChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function syncState() {
  return { ...state, enabled: cloud.isCloudEnabled() };
}

function setState(patch) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => {
    try {
      fn(syncState());
    } catch (error) {
      console.error('[TBC POS] a sync listener failed', error);
    }
  });
}

/* -------------------------------------------------------------- cursor --- */

function readCursor() {
  try {
    return localStorage.getItem(CURSOR_KEY) || '';
  } catch {
    return '';
  }
}

function writeCursor(value) {
  try {
    if (value) localStorage.setItem(CURSOR_KEY, value);
  } catch {
    /* a device with storage blocked re-reads more than it needs to; harmless */
  }
}

/** Forget where we had got to, so the next pull fetches the lot. */
export function resetCursor() {
  try {
    localStorage.removeItem(CURSOR_KEY);
    localStorage.removeItem(SEEDED_KEY);
  } catch {
    /* ignore */
  }
}

/* ---------------------------------------------------------------- push --- */

function strippedSettings(record) {
  const copy = { ...record };
  for (const field of DEVICE_ONLY_SETTINGS) delete copy[field];
  return copy;
}

/**
 * Send queued records up.
 *
 * Entries only leave the outbox once the server has taken them, so a dropped
 * connection means a retry rather than a lost bill.
 */
export async function pushPending() {
  if (!cloud.isCloudEnabled()) return { ok: false, pushed: 0 };

  const entries = await readOutbox();
  if (!entries.length) return { ok: true, pushed: 0 };

  // A device with nobody signed in is a customer's phone. It may send the order
  // it just placed and nothing else — it must never be able to push its own
  // idea of the menu, the settings or the staff list over the cafe's.
  const signedIn = Boolean(getSession());
  const allowed = signedIn ? entries : entries.filter((entry) => entry.store === STORES.ONLINE_ORDERS);
  if (!allowed.length) {
    // Nothing to send, but the rest must not sit in the queue forever.
    if (!signedIn) await clearOutboxEntries(entries.map((entry) => entry.key));
    return { ok: true, pushed: 0 };
  }

  const rows = [];
  for (const entry of allowed) {
    if (entry.deleted) {
      rows.push({ kind: entry.store, ref: entry.id, payload: {}, deleted: true });
      continue;
    }

    const record = await getByKey(entry.store, entry.id);
    if (!record) {
      // Written then deleted before we got here. A tombstone is the honest
      // thing to send.
      rows.push({ kind: entry.store, ref: entry.id, payload: {}, deleted: true });
      continue;
    }

    rows.push({
      kind: entry.store,
      ref: entry.id,
      payload: entry.store === STORES.SETTINGS ? strippedSettings(record) : record,
    });
  }

  const result = await cloud.pushRecords(rows);
  if (!result.ok) {
    setState({ lastError: result.message || 'Could not reach the shared database.' });
    return { ok: false, pushed: 0 };
  }

  await clearOutboxEntries(
    signedIn ? entries.map((entry) => entry.key) : allowed.map((entry) => entry.key)
  );
  setState({ pushed: state.pushed + rows.length, pending: await outboxSize() });
  return { ok: true, pushed: rows.length };
}

/* ---------------------------------------------------------------- pull --- */

/**
 * Apply a page of records from the shared database.
 *
 * Grouped by store and written a store at a time, so one page costs a handful
 * of storage transactions rather than one per record. All of it bypasses the
 * outbox: sending these straight back would have two devices volleying the
 * same record between them forever.
 */
async function applyRemoteRows(rows, touched) {
  const puts = new Map();
  const deletes = new Map();
  let applied = 0;

  for (const row of rows) {
    const store = row.kind;
    if (!SYNCED_STORES.includes(store)) continue;

    // Settings are merged rather than replaced, so they go one at a time.
    if (store === STORES.SETTINGS) {
      if (!row.deleted && row.payload && typeof row.payload === 'object') {
        const local = getSettings();
        const merged = { ...row.payload };
        // This device's own connection details stay put; the cafe's settings
        // are taken.
        for (const field of DEVICE_ONLY_SETTINGS) merged[field] = local[field];
        merged.key = 'app';
        await replaceSettings(merged);
        touched.add(store);
        applied += 1;
      }
      continue;
    }

    if (row.deleted) {
      if (!deletes.has(store)) deletes.set(store, []);
      deletes.get(store).push(row.ref);
    } else if (row.payload && typeof row.payload === 'object') {
      if (!puts.has(store)) puts.set(store, []);
      puts.get(store).push(row.payload);
    } else {
      continue;
    }
    touched.add(store);
    applied += 1;
  }

  for (const store of new Set([...puts.keys(), ...deletes.keys()])) {
    await applyRemoteBatch(store, puts.get(store) || [], deletes.get(store) || []);
  }
  return applied;
}

/** Reload the in-memory caches for whichever stores actually changed. */
async function refreshCaches(touched) {
  const jobs = [];
  if (touched.has(STORES.MENU)) jobs.push(loadMenu());
  if (touched.has(STORES.INVENTORY)) jobs.push(loadInventory());
  if (touched.has(STORES.STAFF)) jobs.push(loadStaff());
  if (touched.has(STORES.TABLES)) jobs.push(loadTables());
  if (touched.has(STORES.SETTINGS)) jobs.push(loadSettings());
  if (jobs.length) await Promise.all(jobs);

  // The order queue repaints itself from an event rather than a cache.
  if (touched.has(STORES.ONLINE_ORDERS)) announceOrders();
}

/**
 * Fetch and apply everything changed since last time, a page at a time.
 *
 * @returns {Promise<{ok:boolean, applied:number, orders:number}>}
 */
export async function pullChanges() {
  if (!cloud.isCloudEnabled()) return { ok: false, applied: 0, orders: 0 };

  let cursor = readCursor();
  const touched = new Set();
  let applied = 0;
  let orders = 0;

  // A handful of pages at a time. A device that has been off for a week
  // catches up over a few ticks instead of blocking the counter on one very
  // long request.
  for (let page = 0; page < 20; page++) {
    const result = await cloud.pullRecords(cursor);
    if (!result.ok) {
      setState({ lastError: result.message || 'Could not read from the shared database.' });
      return { ok: false, applied, orders };
    }
    if (!result.rows.length) break;

    try {
      applied += await applyRemoteRows(result.rows, touched);
      orders += result.rows.filter((row) => row.kind === STORES.ONLINE_ORDERS && !row.deleted).length;
    } catch (error) {
      // A bad page must not stop the rest of the day arriving; the cursor is
      // left where it was so the next round tries again.
      console.error('[TBC POS] could not apply records from the shared database', error);
      return { ok: false, applied, orders };
    }

    cursor = result.cursor;
    writeCursor(cursor);
    if (result.done) break;
  }

  if (applied) await refreshCaches(touched);
  return { ok: true, applied, orders };
}

/* ---------------------------------------------------------------- seed --- */

/**
 * Push everything this device holds.
 *
 * Runs once when a device first joins, so the cafe that has been trading on one
 * till does not have to re-enter a thing — its existing bills, menu, stock and
 * staff become the shared starting point. Also available from Settings as a
 * repair tool.
 */
export async function pushEverything() {
  if (!cloud.isCloudEnabled()) return { ok: false, queued: 0 };

  let queued = 0;
  for (const store of SYNCED_STORES) {
    const records = await getAll(store);
    const items = [];
    for (const record of records) {
      const key = record?.[STORE_KEYS[store]];
      if (key !== undefined && key !== null) items.push({ store, id: key });
    }
    queued += await enqueueManyForSync(items);
  }

  setState({ pending: await outboxSize() });
  return { ok: true, queued };
}

export function hasJoined() {
  try {
    return localStorage.getItem(SEEDED_KEY) === '1';
  } catch {
    return false;
  }
}

function markJoined() {
  try {
    localStorage.setItem(SEEDED_KEY, '1');
  } catch {
    /* ignore */
  }
}

/** Is there a cafe in the shared database already, or is this a blank one? */
async function remoteHasData() {
  const [menu, users, bills] = await Promise.all([
    cloud.fetchKind(STORES.MENU),
    cloud.fetchKind(STORES.USERS),
    cloud.fetchKind(STORES.TRANSACTIONS),
  ]);
  // A failed fetch reads as null, and "we could not tell" must never be taken
  // as "it is empty" — that would let a fresh device flatten a real cafe.
  if (menu === null || users === null) return null;
  return Boolean(menu.length || users.length || bills?.length);
}

/**
 * Connect this device to the cafe database, one way or the other.
 *
 * There are exactly two situations, and guessing between them is the single
 * most dangerous thing this app could do, so it checks rather than assumes:
 *
 *   FOUNDED — the shared database is empty. This device's data becomes the
 *             cafe's data. Nothing is lost.
 *   JOINED  — the shared database already holds a cafe. This device adopts it,
 *             and whatever was on this device is replaced. That is the honest
 *             outcome: a second till must not add a second copy of the menu.
 *
 * The replace half needs saying out loud, so it will not happen without
 * `force` — the setup screen asks first, and offers a backup.
 *
 * @param {{force?:boolean}} options
 */
export async function joinSharedDatabase({ force = false } = {}) {
  if (!cloud.isCloudEnabled()) return { ok: false, mode: 'DISABLED' };

  const populated = await remoteHasData();
  if (populated === null) {
    return { ok: false, mode: 'UNREACHABLE', message: 'Could not read the shared database.' };
  }

  if (!populated) {
    const result = await pushEverything();
    markJoined();
    await syncNow();
    return { ok: true, mode: 'FOUNDED', queued: result.queued };
  }

  if (!force) {
    // Tell the caller what it is about to overwrite so it can ask properly.
    const bills = await getAll(STORES.TRANSACTIONS);
    return { ok: false, mode: 'JOIN_NEEDS_CONFIRMATION', localBills: bills.length };
  }

  // Adopt the cafe. Local records go first, along with anything queued to be
  // sent, so this device cannot push the data it is in the middle of dropping.
  for (const store of SYNCED_STORES) {
    if (store === STORES.SETTINGS) continue; // merged, not wiped: it holds the connection details
    await clearStore(store);
  }
  await clearStore(STORES.SYNC_OUTBOX);

  resetCursor();
  await fetchIdentity();
  const pull = await pullChanges();
  markJoined();

  return { ok: true, mode: 'JOINED', applied: pull.applied };
}

/**
 * What a device does at start-up, before anyone signs in.
 *
 * A brand-new device must take the cafe's accounts and menu BEFORE it seeds
 * defaults of its own, or it would invent an admin account and a second copy
 * of the menu that nobody asked for.
 */
export async function bootstrap() {
  if (!cloud.isCloudEnabled()) return { ok: false, mode: 'DISABLED' };

  const identity = await fetchIdentity();
  if (!identity.ok) return { ok: false, mode: 'UNREACHABLE' };

  if (!hasJoined()) {
    const populated = await remoteHasData();
    if (populated === false) {
      // A blank shared database and a device that may already have a cafe on
      // it: hand it over.
      await pushEverything();
      markJoined();
    } else if (populated === true) {
      markJoined();
    }
  }

  const pull = await pullChanges();
  return { ok: pull.ok, mode: 'READY', applied: pull.applied };
}

/* ----------------------------------------------------------- one round --- */

let inFlight = null;

/**
 * One push-then-pull round. Safe to call at any time; overlapping calls share
 * the round already running rather than stacking up.
 */
export function syncNow() {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    if (!cloud.isCloudEnabled()) return { ok: false, reason: 'DISABLED' };

    setState({ busy: true });
    try {
      const push = await pushPending();
      const pull = await pullChanges();

      const ok = push.ok && pull.ok;
      setState({
        busy: false,
        lastSyncAt: ok ? new Date().toISOString() : state.lastSyncAt,
        lastError: ok ? null : state.lastError,
        pulled: state.pulled + pull.applied,
        pending: await outboxSize(),
      });

      return { ok, pushed: push.pushed, applied: pull.applied, orders: pull.orders };
    } catch (error) {
      console.error('[TBC POS] sync round failed', error);
      setState({ busy: false, lastError: String(error?.message || error) });
      return { ok: false, reason: 'ERROR' };
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/* ---------------------------------------------------------------- loop --- */

let timer = null;
let onlineHandler = null;
let visibilityHandler = null;

export function startSync() {
  stopSync();
  if (!cloud.isCloudEnabled()) return () => {};

  const { pollSeconds } = cloud.cloudConfig();
  timer = setInterval(() => syncNow(), pollSeconds * 1000);

  // The two moments most worth syncing on: the network coming back, and
  // somebody looking at the screen again.
  onlineHandler = () => syncNow();
  visibilityHandler = () => {
    if (document.visibilityState === 'visible') syncNow();
  };
  window.addEventListener('online', onlineHandler);
  document.addEventListener('visibilitychange', visibilityHandler);

  setState({ running: true });
  syncNow();
  return stopSync;
}

export function stopSync() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (onlineHandler) {
    window.removeEventListener('online', onlineHandler);
    onlineHandler = null;
  }
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler);
    visibilityHandler = null;
  }
  setState({ running: false });
}

/* ----------------------------------------------------- start-up fetch --- */

/**
 * Fetch the accounts and settings a brand-new device needs BEFORE it can show
 * a login screen.
 *
 * Without this, opening the app on a manager's laptop for the first time would
 * seed its own default admin account and its own empty cafe — which is exactly
 * the "my data isn't there" problem. Bounded and fail-soft: if the network is
 * down, the device falls back to whatever it has and syncs later.
 *
 * @returns {Promise<{ok:boolean, users:number, settings:boolean}>}
 */
export async function fetchIdentity() {
  if (!cloud.isCloudEnabled()) return { ok: false, users: 0, settings: false };

  try {
    const [users, settings] = await Promise.all([
      cloud.fetchKind(STORES.USERS),
      cloud.fetchRecord(STORES.SETTINGS, 'app'),
    ]);

    const valid = Array.isArray(users) ? users.filter((user) => user?.username) : [];
    if (valid.length) await applyRemoteBatch(STORES.USERS, valid);
    const applied = valid.length;

    let settingsApplied = false;
    if (settings && typeof settings === 'object') {
      const local = getSettings();
      const merged = { ...settings };
      for (const field of DEVICE_ONLY_SETTINGS) merged[field] = local[field];
      merged.key = 'app';
      await replaceSettings(merged);
      settingsApplied = true;
    }

    return { ok: true, users: applied, settings: settingsApplied };
  } catch (error) {
    console.error('[TBC POS] could not fetch accounts from the shared database', error);
    return { ok: false, users: 0, settings: false };
  }
}
