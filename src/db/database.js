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
};

let dbPromise = null;

function upgrade(db) {
  if (!db.objectStoreNames.contains(STORES.MENU)) {
    const menu = db.createObjectStore(STORES.MENU, { keyPath: 'id' });
    menu.createIndex('category', 'category', { unique: false });
    menu.createIndex('name', 'name', { unique: false });
  }
  if (!db.objectStoreNames.contains(STORES.TRANSACTIONS)) {
    const tx = db.createObjectStore(STORES.TRANSACTIONS, { keyPath: 'id' });
    tx.createIndex('businessDate', 'businessDate', { unique: false });
    tx.createIndex('orderNo', 'orderNo', { unique: true });
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

    request.onupgradeneeded = (event) => upgrade(event.target.result);
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

export async function put(storeName, record) {
  return runTransaction(storeName, 'readwrite', (stores) => {
    stores[storeName].put(record);
    return record;
  });
}

export async function putMany(storeName, records) {
  return runTransaction(storeName, 'readwrite', (stores) => {
    for (const record of records) stores[storeName].put(record);
    return records.length;
  });
}

export async function remove(storeName, key) {
  return runTransaction(storeName, 'readwrite', (stores) => {
    stores[storeName].delete(key);
    return true;
  });
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
