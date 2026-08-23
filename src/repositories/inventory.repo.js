/**
 * Stock on the shelf, and where it went.
 *
 * Two rules shape this file:
 *
 * 1. EVERY CHANGE LEAVES A TRACE. A stock level is never simply overwritten; it
 *    moves because something happened — a delivery arrived, a drink was sold,
 *    a jug was dropped, someone recounted the shelf. Each of those writes a
 *    movement record alongside the new level, so "we are 400 g short" always
 *    has an answer.
 *
 * 2. A SALE DEDUCTS STOCK INSIDE THE SALE'S OWN TRANSACTION. `applySaleToStock`
 *    is handed the already-open IndexedDB stores by transactions.repo, so the
 *    bill and the stock it consumed commit together or not at all. It only ever
 *    awaits IndexedDB requests — awaiting anything else would let the browser
 *    close the transaction underneath it.
 */

import {
  STORES,
  getAll,
  getByKey,
  put,
  remove,
  putMany,
  clearStore,
  runTransaction,
  promisify,
} from '../db/database.js';
import { requireAdmin, requireSignedIn, getSession } from '../core/session.js';
import { AppError, uid, matchesQuery, businessDateKey } from '../core/utils.js';
import { STOCK_MOVEMENT_KINDS, STOCK_UNITS } from '../config/app.config.js';
import { multiplyQuantity } from '../core/quantity.js';

let cache = null;
const listeners = new Set();

export function onInventoryChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function announce() {
  listeners.forEach((fn) => fn(cache));
}

function sortItems(items) {
  return items.sort(
    (a, b) => a.category.localeCompare(b.category, 'en') || a.name.localeCompare(b.name, 'en')
  );
}

/* --------------------------------------------------------------- reads --- */

export async function loadInventory() {
  cache = sortItems(await getAll(STORES.INVENTORY));
  return cache;
}

/** Synchronous read of the cached stock list. Safe after boot. */
export function getInventory() {
  return cache || [];
}

export function getStockItem(id) {
  return getInventory().find((item) => item.id === id) || null;
}

export function getStockCategories() {
  const seen = [];
  for (const item of getInventory()) {
    if (!seen.includes(item.category)) seen.push(item.category);
  }
  return seen.sort((a, b) => a.localeCompare(b, 'en'));
}

export function searchInventory({ query = '', category = 'All', lowOnly = false } = {}) {
  return getInventory().filter((item) => {
    if (category !== 'All' && item.category !== category) return false;
    if (lowOnly && !isLow(item)) return false;
    if (!query) return true;
    return (
      matchesQuery(item.name, query) ||
      matchesQuery(item.category, query) ||
      matchesQuery(item.supplier, query)
    );
  });
}

/** At or below the reorder level — the threshold the Stock screen highlights. */
export function isLow(item) {
  return Number(item.lowStockLevel) > 0 && Number(item.quantity) <= Number(item.lowStockLevel);
}

export function lowStockItems() {
  return getInventory().filter(isLow);
}

/** Total value of what is on the shelf, in paise. */
export function stockValue() {
  return getInventory().reduce(
    (total, item) => total + Math.round((item.quantity * (item.costPerUnit || 0)) / 1000),
    0
  );
}

export function listMovements() {
  return getAll(STORES.STOCK_MOVEMENTS).then((rows) =>
    rows.sort((a, b) => String(b.at).localeCompare(String(a.at)))
  );
}

export async function movementsFor(stockId, limit = 50) {
  const rows = await getAll(STORES.STOCK_MOVEMENTS);
  return rows
    .filter((row) => row.stockId === stockId)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, limit);
}

/* -------------------------------------------------------------- writes --- */

function validate(draft, { existingId = null } = {}) {
  const name = String(draft.name || '').trim();
  const category = String(draft.category || '').trim() || 'General';

  if (!name) throw new AppError('Give the stock item a name.', 'VALIDATION');
  if (name.length > 80) throw new AppError('Stock names are limited to 80 characters.', 'VALIDATION');
  if (!STOCK_UNITS.some((unit) => unit.id === draft.unit)) {
    throw new AppError('Choose a unit for this stock item.', 'VALIDATION');
  }

  const clash = getInventory().find(
    (item) => item.id !== existingId && item.name.toLowerCase() === name.toLowerCase()
  );
  if (clash) throw new AppError(`"${name}" is already in the stock list.`, 'DUPLICATE');

  return { name, category };
}

/** Record a movement and the level it produced, in one place. */
function movementRecord({ stockId, kind, change, balanceAfter, note, reference, session }) {
  const now = new Date();
  return {
    id: uid('mov'),
    stockId,
    kind,
    change,
    balanceAfter,
    note: String(note || '').slice(0, 160),
    reference: reference || '',
    at: now.toISOString(),
    businessDate: businessDateKey(now),
    by: session?.username || 'system',
  };
}

export async function createStockItem(draft) {
  requireAdmin('adding stock items');
  const session = getSession();
  const { name, category } = validate(draft);
  const now = new Date().toISOString();
  const opening = Math.max(0, Math.round(Number(draft.quantity) || 0));

  const item = {
    id: uid('stk'),
    name,
    category,
    unit: draft.unit,
    quantity: opening,
    lowStockLevel: Math.max(0, Math.round(Number(draft.lowStockLevel) || 0)),
    costPerUnit: Math.max(0, Math.round(Number(draft.costPerUnit) || 0)),
    supplier: String(draft.supplier || '').trim(),
    notes: String(draft.notes || '').trim(),
    active: draft.active !== false,
    createdAt: now,
    updatedAt: now,
  };

  await runTransaction([STORES.INVENTORY, STORES.STOCK_MOVEMENTS], 'readwrite', (stores) => {
    stores[STORES.INVENTORY].put(item);
    if (opening > 0) {
      stores[STORES.STOCK_MOVEMENTS].put(
        movementRecord({
          stockId: item.id,
          kind: STOCK_MOVEMENT_KINDS.OPENING,
          change: opening,
          balanceAfter: opening,
          note: 'Opening count',
          session,
        })
      );
    }
  });

  cache = sortItems([...getInventory(), item]);
  announce();
  return item;
}

export async function updateStockItem(id, patch) {
  requireAdmin('editing stock items');
  const existing = await getByKey(STORES.INVENTORY, id);
  if (!existing) throw new AppError('That stock item no longer exists.', 'NOT_FOUND');

  const merged = { ...existing, ...patch };
  const { name, category } = validate(merged, { existingId: id });

  // Levels move through adjustStock so that a movement is always written.
  const item = {
    ...merged,
    name,
    category,
    quantity: existing.quantity,
    lowStockLevel: Math.max(0, Math.round(Number(merged.lowStockLevel) || 0)),
    costPerUnit: Math.max(0, Math.round(Number(merged.costPerUnit) || 0)),
    supplier: String(merged.supplier || '').trim(),
    notes: String(merged.notes || '').trim(),
    updatedAt: new Date().toISOString(),
  };

  await put(STORES.INVENTORY, item);
  cache = sortItems(getInventory().map((row) => (row.id === id ? item : row)));
  announce();
  return item;
}

/**
 * Move a stock level and say why.
 *
 * @param {string} id
 * @param {number} change  signed, in thousandths of the item's unit
 * @param {string} kind    one of STOCK_MOVEMENT_KINDS
 */
export async function adjustStock(id, change, { kind, note = '', reference = '' } = {}) {
  const session = requireSignedIn();
  const amount = Math.round(Number(change) || 0);
  if (!amount) throw new AppError('Enter an amount to add or remove.', 'VALIDATION');
  if (!Object.values(STOCK_MOVEMENT_KINDS).includes(kind)) {
    throw new AppError('That stock change has no reason attached.', 'VALIDATION');
  }
  // Receiving deliveries is routine counter work; writing off stock is not.
  if (kind !== STOCK_MOVEMENT_KINDS.RECEIVED) requireAdmin('changing stock levels');

  const updated = await runTransaction(
    [STORES.INVENTORY, STORES.STOCK_MOVEMENTS],
    'readwrite',
    async (stores) => {
      const item = await promisify(stores[STORES.INVENTORY].get(id));
      if (!item) throw new AppError('That stock item no longer exists.', 'NOT_FOUND');

      // A shelf cannot hold less than nothing; a correction that would go
      // negative lands at zero and the movement records what actually moved.
      const balanceAfter = Math.max(0, item.quantity + amount);
      const applied = balanceAfter - item.quantity;

      const next = { ...item, quantity: balanceAfter, updatedAt: new Date().toISOString() };
      stores[STORES.INVENTORY].put(next);
      stores[STORES.STOCK_MOVEMENTS].put(
        movementRecord({
          stockId: id,
          kind,
          change: applied,
          balanceAfter,
          note,
          reference,
          session,
        })
      );
      return next;
    }
  );

  cache = sortItems(getInventory().map((row) => (row.id === id ? updated : row)));
  announce();
  return updated;
}

/** Set a level to a counted figure, recording the difference as a correction. */
export async function recountStock(id, countedQuantity, note = 'Shelf recount') {
  requireAdmin('recounting stock');
  const item = getStockItem(id);
  if (!item) throw new AppError('That stock item no longer exists.', 'NOT_FOUND');

  const target = Math.max(0, Math.round(Number(countedQuantity) || 0));
  const difference = target - item.quantity;
  if (!difference) return item;

  return adjustStock(id, difference, { kind: STOCK_MOVEMENT_KINDS.CORRECTION, note });
}

export async function deleteStockItem(id) {
  requireAdmin('deleting stock items');
  await remove(STORES.INVENTORY, id);

  // Any recipe pointing at it would silently deduct nothing, so clear it out.
  const recipes = await getAll(STORES.RECIPES);
  const affected = recipes
    .filter((recipe) => recipe.items.some((line) => line.stockId === id))
    .map((recipe) => ({
      ...recipe,
      items: recipe.items.filter((line) => line.stockId !== id),
      updatedAt: new Date().toISOString(),
    }));
  if (affected.length) await putMany(STORES.RECIPES, affected);

  cache = getInventory().filter((item) => item.id !== id);
  announce();
  return true;
}

/* ------------------------------------------------------------ recipes --- */

export function listRecipes() {
  return getAll(STORES.RECIPES);
}

export function getRecipe(menuItemId) {
  return getByKey(STORES.RECIPES, menuItemId);
}

/**
 * @param {string} menuItemId
 * @param {{stockId:string, quantity:number}[]} lines  quantity per portion sold
 */
export async function saveRecipe(menuItemId, lines) {
  requireAdmin('editing recipes');

  const cleaned = [];
  for (const line of lines || []) {
    const quantity = Math.round(Number(line.quantity) || 0);
    if (quantity <= 0) continue;
    if (!getStockItem(line.stockId)) continue;
    // One row per ingredient: adding the same one twice just adds up.
    const existing = cleaned.find((row) => row.stockId === line.stockId);
    if (existing) existing.quantity += quantity;
    else cleaned.push({ stockId: line.stockId, quantity });
  }

  if (!cleaned.length) {
    await remove(STORES.RECIPES, menuItemId);
    return null;
  }

  const recipe = { menuItemId, items: cleaned, updatedAt: new Date().toISOString() };
  await put(STORES.RECIPES, recipe);
  return recipe;
}

/** Cost of one portion, in paise, from its ingredients' cost prices. */
export function recipeCost(recipe) {
  if (!recipe) return 0;
  return recipe.items.reduce((total, line) => {
    const item = getStockItem(line.stockId);
    if (!item) return total;
    return total + Math.round((line.quantity * (item.costPerUnit || 0)) / 1000);
  }, 0);
}

/* -------------------------------------------------- sale-time deduction --- */

/**
 * Draw ingredients down for a completed sale.
 *
 * Called by transactions.repo from INSIDE the sale's IndexedDB transaction, so
 * every await here must be an IndexedDB request and nothing else.
 *
 * @param {Record<string, IDBObjectStore>} stores  must include recipes, inventory, movements
 * @param {object} record     the transaction being written
 * @param {number} direction  -1 to consume on a sale, +1 to put back on a void
 * @returns {Promise<{deducted:number, shortages:{name:string}[]}>}
 */
export async function applySaleToStock(stores, record, direction = -1) {
  const recipes = stores[STORES.RECIPES];
  const inventory = stores[STORES.INVENTORY];
  const movements = stores[STORES.STOCK_MOVEMENTS];
  if (!recipes || !inventory || !movements) return { deducted: 0, shortages: [] };

  const reversing = direction > 0;
  const kind = reversing ? STOCK_MOVEMENT_KINDS.SALE_REVERSAL : STOCK_MOVEMENT_KINDS.SALE;

  // Add up the whole bill before touching a shelf: two lattes on one bill are
  // one deduction of milk, and one movement record to read later.
  const required = new Map();
  for (const line of record.items) {
    const recipe = await promisify(recipes.get(line.itemId));
    if (!recipe) continue;
    for (const ingredient of recipe.items) {
      const amount = multiplyQuantity(ingredient.quantity, line.quantity);
      required.set(ingredient.stockId, (required.get(ingredient.stockId) || 0) + amount);
    }
  }

  const shortages = [];
  let deducted = 0;

  for (const [stockId, amount] of required) {
    const item = await promisify(inventory.get(stockId));
    if (!item) continue;

    const change = reversing ? amount : -amount;
    const balanceAfter = Math.max(0, item.quantity + change);
    const applied = balanceAfter - item.quantity;

    // The sale already happened. Record the shortfall rather than refusing it.
    if (!reversing && item.quantity < amount) {
      shortages.push({ id: item.id, name: item.name, short: amount - item.quantity });
    }

    inventory.put({ ...item, quantity: balanceAfter, updatedAt: record.createdAt });
    movements.put(
      movementRecord({
        stockId,
        kind,
        change: applied,
        balanceAfter,
        note: reversing ? `Bill ${record.orderNo} voided` : `Sold on ${record.orderNo}`,
        reference: record.orderNo || record.id,
        session: { username: record.cashier },
      })
    );
    deducted += 1;
  }

  return { deducted, shortages };
}

/**
 * Would this cart run a shelf dry? Read-only, used to warn before payment.
 *
 * @param {{itemId:string, quantity:number, name:string}[]} lines
 */
export async function checkAvailability(lines) {
  const required = new Map();
  for (const line of lines) {
    const recipe = await getRecipe(line.itemId);
    if (!recipe) continue;
    for (const ingredient of recipe.items) {
      const amount = multiplyQuantity(ingredient.quantity, line.quantity);
      required.set(ingredient.stockId, (required.get(ingredient.stockId) || 0) + amount);
    }
  }

  const shortages = [];
  for (const [stockId, amount] of required) {
    const item = getStockItem(stockId);
    if (item && item.quantity < amount) {
      shortages.push({ id: stockId, name: item.name, unit: item.unit, have: item.quantity, need: amount });
    }
  }
  return shortages;
}

/* ------------------------------------------------------ backup support --- */

export async function replaceAll(items, movements, recipes) {
  await clearStore(STORES.INVENTORY);
  if (items?.length) await putMany(STORES.INVENTORY, items);

  await clearStore(STORES.STOCK_MOVEMENTS);
  if (movements?.length) await putMany(STORES.STOCK_MOVEMENTS, movements);

  await clearStore(STORES.RECIPES);
  if (recipes?.length) await putMany(STORES.RECIPES, recipes);

  await loadInventory();
  announce();
}
