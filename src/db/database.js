/**
 * IndexedDB access layer.
 *
 * This is the ONLY file that talks to IndexedDB directly. Repositories call
 * these helpers; views never touch storage. Swapping IndexedDB for Supabase,
 * Firebase or a REST API means reimplementing the repository modules against
 * the same method signatures — no view code changes. See README → "Future
 * backend upgrade path".
 */

import { APP } from '../config/app.config.js';
import { AppError } from '../core/utils.js';

export const STORES = {
  MENU: 'menuItems',
  TRANSACTIONS: 'transactions',
  BUSINESS_DAYS: 'businessDays',
  SETTINGS: 'settings',
  COUNTERS: 'counters',
  USERS: 'users',

  /* Added with the cafe-floor features: stock, staff, tables, QR ordering. */
  INVENTORY: 'inventory',
  STOCK_MOVEMENTS: 'stockMovements',
  RECIPES: 'recipes',
  STAFF: 'staff',
  SHIFTS: 'shifts',
  ATTENDANCE: 'attendance',
  TABLES: 'tables',
  ONLINE_ORDERS: 'onlineOrders',

  /** Regulars: who they are, when they came in, and what they have earned. */
  CUSTOMERS: 'customers',

  /** Records waiting to be sent to the shared database. */
  SYNC_OUTBOX: 'syncOutbox',
};

/**
 * The primary key of each store, and by the same token the list of stores that
 * belong to the cafe rather than to this device. Everything named here is kept
 * in step with the shared database; anything not named here is local — the
 * outbox itself, and the counters a till falls back on when it is offline.
 */
export const STORE_KEYS = {
  [STORES.MENU]: 'id',
  [STORES.TRANSACTIONS]: 'id',
  [STORES.BUSINESS_DAYS]: 'date',
  [STORES.SETTINGS]: 'key',
  [STORES.USERS]: 'username',
  [STORES.INVENTORY]: 'id',
  [STORES.STOCK_MOVEMENTS]: 'id',
  [STORES.RECIPES]: 'menuItemId',
  [STORES.STAFF]: 'id',
  [STORES.SHIFTS]: 'id',
  [STORES.ATTENDANCE]: 'id',
  [STORES.TABLES]: 'id',
  [STORES.ONLINE_ORDERS]: 'id',
  [STORES.CUSTOMERS]: 'id',
};

export const SYNCED_STORES = Object.keys(STORE_KEYS);

export function isSyncedStore(storeName) {
  return Object.prototype.hasOwnProperty.call(STORE_KEYS, storeName);
}

export function recordKey(storeName, record) {
  return record?.[STORE_KEYS[storeName]];
}

function outboxEntry(storeName, key, deleted = false) {
  return {
    // One entry per record: a price edited five times before the network comes
    // back queues once, not five times.
    key: `${storeName}::${key}`,
    store: storeName,
    id: String(key),
    deleted,
    queuedAt: new Date().toISOString(),
  };
}

let dbPromise = null;

/**
 * Version 3 relaxed the orderNo index from unique to non-unique. An index
 * cannot be altered in place, so it is dropped and recreated — which needs the
 * running upgrade transaction, not just the database handle.
 */
function migrateIndexes(db, transaction) {
  if (!transaction || !db.objectStoreNames.contains(STORES.TRANSACTIONS)) return;

  const store = transaction.objectStore(STORES.TRANSACTIONS);
  if (store.indexNames.contains('orderNo') && store.index('orderNo').unique) {
    store.deleteIndex('orderNo');
    store.createIndex('orderNo', 'orderNo', { unique: false });
  }
}

function upgrade(db, transaction) {
  if (!db.objectStoreNames.contains(STORES.MENU)) {
    const menu = db.createObjectStore(STORES.MENU, { keyPath: 'id' });
    menu.createIndex('category', 'category', { unique: false });
    menu.createIndex('name', 'name', { unique: false });
  }
  if (!db.objectStoreNames.contains(STORES.TRANSACTIONS)) {
    const tx = db.createObjectStore(STORES.TRANSACTIONS, { keyPath: 'id' });
    tx.createIndex('businessDate', 'businessDate', { unique: false });
    // Not unique. Bill numbers are allocated by the shared database and are
    // unique in practice, but a till that billed while offline can produce one
    // that another till already used. A duplicate number is a thing to notice
    // and fix, not a reason to refuse to store somebody's sale.
    tx.createIndex('orderNo', 'orderNo', { unique: false });
    tx.createIndex('createdAt', 'createdAt', { unique: false });
    tx.createIndex('cashier', 'cashier', { unique: false });
    tx.createIndex('paymentMethod', 'paymentMethod', { unique: false });
  }
  if (!db.objectStoreNames.contains(STORES.BUSINESS_DAYS)) {
    const days = db.createObjectStore(STORES.BUSINESS_DAYS, { keyPath: 'date' });
    days.createIndex('dayNumber', 'dayNumber', { unique: false });
  }
  if (!db.objectStoreNames.contains(STORES.SETTINGS)) {
    db.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
  }
  if (!db.objectStoreNames.contains(STORES.COUNTERS)) {
    db.createObjectStore(STORES.COUNTERS, { keyPath: 'key' });
  }
  if (!db.objectStoreNames.contains(STORES.USERS)) {
    db.createObjectStore(STORES.USERS, { keyPath: 'username' });
  }

  /* ----------------------------------------------------------- stock --- */

  if (!db.objectStoreNames.contains(STORES.INVENTORY)) {
    const inventory = db.createObjectStore(STORES.INVENTORY, { keyPath: 'id' });
    inventory.createIndex('name', 'name', { unique: false });
    inventory.createIndex('category', 'category', { unique: false });
  }
  if (!db.objectStoreNames.contains(STORES.STOCK_MOVEMENTS)) {
    const movements = db.createObjectStore(STORES.STOCK_MOVEMENTS, { keyPath: 'id' });
    movements.createIndex('stockId', 'stockId', { unique: false });
    movements.createIndex('businessDate', 'businessDate', { unique: false });
    movements.createIndex('kind', 'kind', { unique: false });
  }
  // Keyed by menu item id: one recipe per menu item, so a lookup during a sale
  // is a single get() rather than a scan.
  if (!db.objectStoreNames.contains(STORES.RECIPES)) {
    db.createObjectStore(STORES.RECIPES, { keyPath: 'menuItemId' });
  }

  /* ----------------------------------------------------------- staff --- */

  if (!db.objectStoreNames.contains(STORES.STAFF)) {
    const staff = db.createObjectStore(STORES.STAFF, { keyPath: 'id' });
    staff.createIndex('name', 'name', { unique: false });
    staff.createIndex('username', 'username', { unique: false });
  }
  if (!db.objectStoreNames.contains(STORES.SHIFTS)) {
    const shifts = db.createObjectStore(STORES.SHIFTS, { keyPath: 'id' });
    shifts.createIndex('date', 'date', { unique: false });
    shifts.createIndex('staffId', 'staffId', { unique: false });
  }
  if (!db.objectStoreNames.contains(STORES.ATTENDANCE)) {
    const attendance = db.createObjectStore(STORES.ATTENDANCE, { keyPath: 'id' });
    attendance.createIndex('date', 'date', { unique: false });
    attendance.createIndex('staffId', 'staffId', { unique: false });
  }

  /* ------------------------------------------------- tables and QR --- */

  if (!db.objectStoreNames.contains(STORES.TABLES)) {
    const tables = db.createObjectStore(STORES.TABLES, { keyPath: 'id' });
    // The token is what a QR code carries, so it has to resolve to exactly one
    // table.
    tables.createIndex('token', 'token', { unique: true });
    tables.createIndex('zone', 'zone', { unique: false });
  }
  if (!db.objectStoreNames.contains(STORES.ONLINE_ORDERS)) {
    const orders = db.createObjectStore(STORES.ONLINE_ORDERS, { keyPath: 'id' });
    orders.createIndex('status', 'status', { unique: false });
    orders.createIndex('placedAt', 'placedAt', { unique: false });
    orders.createIndex('tableId', 'tableId', { unique: false });
  }

  /* ------------------------------------------------------- customers --- */

  if (!db.objectStoreNames.contains(STORES.CUSTOMERS)) {
    const customers = db.createObjectStore(STORES.CUSTOMERS, { keyPath: 'id' });
    // Phone is how a cashier finds somebody, but the index is NOT unique: two
    // tills that both took the same new customer while offline would otherwise
    // be unable to store each other's copy. The repository merges duplicates
    // instead, which loses nobody's visits.
    customers.createIndex('phone', 'phone', { unique: false });
    customers.createIndex('name', 'name', { unique: false });
    // Birthdays are stored as MM-DD so "who is in today" is one index range
    // rather than a scan of every customer the cafe has ever served.
    customers.createIndex('birthday', 'birthday', { unique: false });
    customers.createIndex('lastVisit', 'lastVisit', { unique: false });
  }

  /* ------------------------------------------------------------ sync --- */

  // One row per record that still has to reach the shared database. Keyed by
  // "store::id" so a record edited five times before the network comes back
  // queues once, not five times.
  if (!db.objectStoreNames.contains(STORES.SYNC_OUTBOX)) {
    const outbox = db.createObjectStore(STORES.SYNC_OUTBOX, { keyPath: 'key' });
    outbox.createIndex('queuedAt', 'queuedAt', { unique: false });
  }

  migrateIndexes(db, transaction);
}

export function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(
        new AppError(
          'This browser has no local database support, so sales cannot be saved. Use a current version of Chrome, Edge, Firefox or Safari.',
          'NO_INDEXEDDB'
        )
      );
      return;
    }

    let request;
    try {
      request = indexedDB.open(APP.dbName, APP.dbVersion);
    } catch (error) {
      reject(new AppError('Local storage could not be opened on this device.', 'DB_OPEN_FAILED'));
      return;
    }

    request.onupgradeneeded = (event) => upgrade(event.target.result, event.target.transaction);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () =>
      reject(
        new AppError(
          'Local storage is unavailable. Private/incognito windows and blocked site data can cause this.',
          'DB_BLOCKED'
        )
      );
    request.onblocked = () =>
      reject(
        new AppError('Close other tabs running this app and try again.', 'DB_BLOCKED')
      );
  });

  return dbPromise;
}

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Storage request failed'));
  });
}

/**
 * Run work inside one IndexedDB transaction and resolve when it COMMITS.
 * Resolving on commit (not on the last request) is what makes "a saved order
 * is really saved" true even if the page is closed a moment later.
 *
 * @param {string|string[]} storeNames
 * @param {'readonly'|'readwrite'} mode
 * @param {(stores: Record<string, IDBObjectStore>, tx: IDBTransaction) => any} work
 */
export async function runTransaction(storeNames, mode, work) {
  const db = await openDatabase();
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];

  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(names, mode);
    } catch (error) {
      reject(new AppError('Storage is busy. Try that again.', 'TX_FAILED'));
      return;
    }

    const stores = {};
    for (const name of names) stores[name] = tx.objectStore(name);

    let result;
    let failed = false;

    tx.oncomplete = () => {
      if (!failed) resolve(result);
    };
    tx.onerror = () => {
      failed = true;
      reject(tx.error || new AppError('The change could not be saved.', 'TX_ERROR'));
    };
    tx.onabort = () => {
      failed = true;
      reject(tx.error || new AppError('The change was rolled back and nothing was saved.', 'TX_ABORT'));
    };

    Promise.resolve()
      .then(() => work(stores, tx))
      .then((value) => {
        result = value;
      })
      .catch((error) => {
        failed = true;
        try {
          tx.abort();
        } catch {
          /* already finished */
        }
        reject(error);
      });
  });
}

/* ----------------------------------------------------------- shortcuts --- */

export async function getAll(storeName) {
  return runTransaction(storeName, 'readonly', (stores) => promisify(stores[storeName].getAll()));
}

export async function getByKey(storeName, key) {
  return runTransaction(storeName, 'readonly', (stores) =>
    promisify(stores[storeName].get(key))
  );
}

export async function getAllByIndex(storeName, indexName, value) {
  return runTransaction(storeName, 'readonly', (stores) =>
    promisify(stores[storeName].index(indexName).getAll(value))
  );
}

/**
 * Write a record, and queue it for the shared database in the SAME storage
 * transaction. Queuing separately would open a gap where a bill is saved on
 * the till but nothing remembers to send it; here the two either both happen
 * or neither does.
 */
export async function put(storeName, record) {
  const tracked = isSyncedStore(storeName);
  const names = tracked ? [storeName, STORES.SYNC_OUTBOX] : [storeName];

  return runTransaction(names, 'readwrite', (stores) => {
    stores[storeName].put(record);
    if (tracked) {
      stores[STORES.SYNC_OUTBOX].put(outboxEntry(storeName, recordKey(storeName, record)));
    }
    return record;
  });
}

export async function putMany(storeName, records) {
  const tracked = isSyncedStore(storeName);
  const names = tracked ? [storeName, STORES.SYNC_OUTBOX] : [storeName];

  return runTransaction(names, 'readwrite', (stores) => {
    for (const record of records) {
      stores[storeName].put(record);
      if (tracked) {
        stores[STORES.SYNC_OUTBOX].put(outboxEntry(storeName, recordKey(storeName, record)));
      }
    }
    return records.length;
  });
}

export async function remove(storeName, key) {
  const tracked = isSyncedStore(storeName);
  const names = tracked ? [storeName, STORES.SYNC_OUTBOX] : [storeName];

  return runTransaction(names, 'readwrite', (stores) => {
    stores[storeName].delete(key);
    // A deletion has to travel too, or the record would come back on the next
    // pull from a device that still has it.
    if (tracked) stores[STORES.SYNC_OUTBOX].put(outboxEntry(storeName, key, true));
    return true;
  });
}

/**
 * Write without queueing anything.
 *
 * Used only when applying what the shared database just sent us: queueing that
 * would send it straight back, and the two devices would volley the same record
 * between them forever.
 */
export async function putFromRemote(storeName, record) {
  return runTransaction(storeName, 'readwrite', (stores) => {
    stores[storeName].put(record);
    return record;
  });
}

export async function removeFromRemote(storeName, key) {
  return runTransaction(storeName, 'readwrite', (stores) => {
    stores[storeName].delete(key);
    return true;
  });
}

/**
 * Apply a page of incoming records to one store in a single transaction.
 *
 * A device that has been off for a day comes back to thousands of changes.
 * Opening a storage transaction per record turns that into a visibly frozen
 * screen; one transaction per store per page keeps it to a blink.
 *
 * @param {string} storeName
 * @param {object[]} records  records to write
 * @param {string[]} deletions  keys to remove
 */
export async function applyRemoteBatch(storeName, records, deletions = []) {
  if (!records.length && !deletions.length) return 0;

  return runTransaction(storeName, 'readwrite', (stores) => {
    for (const record of records) stores[storeName].put(record);
    for (const key of deletions) stores[storeName].delete(key);
    return records.length + deletions.length;
  });
}

/* -------------------------------------------------------------- outbox --- */

/** Queue a record written through a raw transaction, which cannot self-queue. */
export async function enqueueForSync(storeName, key, deleted = false) {
  if (!isSyncedStore(storeName) || key === undefined || key === null) return false;
  try {
    await runTransaction(STORES.SYNC_OUTBOX, 'readwrite', (stores) => {
      stores[STORES.SYNC_OUTBOX].put(outboxEntry(storeName, key, deleted));
    });
    return true;
  } catch (error) {
    // Never let bookkeeping fail the sale it belongs to. The start-up sweep
    // picks up anything that slips through here.
    console.error('[TBC POS] could not queue a record for the shared database', error);
    return false;
  }
}

/**
 * Queue many records at once.
 *
 * Handing a whole cafe over to the shared database means queueing every record
 * it has. One storage transaction per record turns that into a several-second
 * freeze on the setup screen; one transaction for the lot is instant.
 *
 * @param {{store:string, id:string|number, deleted?:boolean}[]} items
 */
export async function enqueueManyForSync(items) {
  const valid = items.filter(
    (item) => isSyncedStore(item.store) && item.id !== undefined && item.id !== null
  );
  if (!valid.length) return 0;

  try {
    await runTransaction(STORES.SYNC_OUTBOX, 'readwrite', (stores) => {
      for (const item of valid) {
        stores[STORES.SYNC_OUTBOX].put(outboxEntry(item.store, item.id, Boolean(item.deleted)));
      }
    });
    return valid.length;
  } catch (error) {
    console.error('[TBC POS] could not queue records for the shared database', error);
    return 0;
  }
}

export async function readOutbox(limit = 400) {
  const entries = await getAll(STORES.SYNC_OUTBOX);
  return entries
    .sort((a, b) => String(a.queuedAt).localeCompare(String(b.queuedAt)))
    .slice(0, limit);
}

export async function clearOutboxEntries(keys) {
  if (!keys.length) return 0;
  return runTransaction(STORES.SYNC_OUTBOX, 'readwrite', (stores) => {
    for (const key of keys) stores[STORES.SYNC_OUTBOX].delete(key);
    return keys.length;
  });
}

export function outboxSize() {
  return count(STORES.SYNC_OUTBOX);
}

export async function clearStore(storeName) {
  return runTransaction(storeName, 'readwrite', (stores) => {
    stores[storeName].clear();
    return true;
  });
}

export async function count(storeName) {
  return runTransaction(storeName, 'readonly', (stores) => promisify(stores[storeName].count()));
}

export { promisify };

/** Rough storage headroom, used by the Settings screen. */
export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota };
  } catch {
    return null;
  }
}

/**
 * Ask the browser to keep this origin's data instead of evicting it under
 * storage pressure. Best-effort: some browsers grant silently, some ignore it.
 */
export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
