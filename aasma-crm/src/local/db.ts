import { TABLE_NAMES, type Database, type TableName } from './types';

/**
 * The browser database.
 *
 * The whole dataset is held in memory and written back to IndexedDB after every
 * change. A single site's CRM is small — tens of thousands of rows at the very
 * outside — so this keeps every query synchronous and the code close to the
 * server version, while IndexedDB gives real durability across restarts.
 */

const DB_NAME = 'aasma-buildcon-crm';
const DB_VERSION = 1;
const STORE = 'tables';

let memory: Database | null = null;
let handle: IDBDatabase | null = null;
/** Serialises writes so two quick saves cannot interleave. */
let writeChain: Promise<void> = Promise.resolve();

function emptyDatabase(): Database {
  return TABLE_NAMES.reduce((acc, name) => {
    (acc as unknown as Record<string, unknown[]>)[name] = [];
    return acc;
  }, {} as Database);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened.'));
  });
}

function readTable(database: IDBDatabase, name: TableName): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE, 'readonly').objectStore(STORE).get(name);
    request.onsuccess = () => resolve((request.result as unknown[] | undefined) ?? []);
    request.onerror = () => reject(request.error);
  });
}

function writeTable(database: IDBDatabase, name: TableName, rows: unknown[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(rows, name);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

/** Loads every table into memory. Safe to call more than once. */
export async function loadDatabase(): Promise<Database> {
  if (memory) return memory;

  const next = emptyDatabase();
  try {
    handle = await openDatabase();
    for (const name of TABLE_NAMES) {
      (next as unknown as Record<string, unknown[]>)[name] = await readTable(handle, name);
    }
  } catch (error) {
    // A browser with storage blocked (private mode, or site data disabled) still
    // gets a working app for this session; nothing will survive a reload.
    console.warn('[db] IndexedDB is unavailable — running from memory only.', error);
    handle = null;
  }

  memory = next;
  return memory;
}

export function db(): Database {
  if (!memory) throw new Error('The local database has not been opened yet.');
  return memory;
}

/** Persists the named tables. Unnamed tables are left untouched. */
export function save(...tables: TableName[]): void {
  if (!handle || !memory) return;
  const database = handle;
  const snapshot = memory;
  writeChain = writeChain
    .then(async () => {
      for (const name of tables) {
        await writeTable(database, name, snapshot[name] as unknown[]);
      }
    })
    .catch((error) => {
      console.error('[db] could not save to IndexedDB:', error);
    });
}

/** Waits for any queued writes to reach disk. */
export async function flush(): Promise<void> {
  await writeChain;
}

export async function replaceDatabase(next: Database): Promise<void> {
  memory = next;
  save(...TABLE_NAMES);
  await flush();
}

/** Next free id for a table, mirroring SQLite's autoincrement. */
export function nextId(table: { id: number }[]): number {
  return table.reduce((max, row) => (row.id > max ? row.id : max), 0) + 1;
}

const DATE_KEY = /(At|On|Date)$/;

/** Turns ISO strings back into Date objects after a JSON round trip. */
export function reviveDates<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => reviveDates(item)) as unknown as T;
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(source)) {
      if (typeof item === 'string' && DATE_KEY.test(key) && /^\d{4}-\d{2}-\d{2}T/.test(item)) {
        result[key] = new Date(item);
      } else if (item && typeof item === 'object') {
        result[key] = reviveDates(item);
      } else {
        result[key] = item;
      }
    }
    return result as T;
  }
  return value;
}

export function serialiseDatabase(): string {
  return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), tables: db() });
}

export function parseDatabase(text: string): Database {
  const parsed = JSON.parse(text) as { tables?: unknown } | Database;
  const tables = (parsed as { tables?: unknown }).tables ?? parsed;
  const next = emptyDatabase();
  for (const name of TABLE_NAMES) {
    const rows = (tables as Record<string, unknown>)[name];
    if (Array.isArray(rows)) {
      (next as unknown as Record<string, unknown[]>)[name] = reviveDates(rows) as unknown[];
    }
  }
  return next;
}
