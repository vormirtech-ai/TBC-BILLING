/** Menu items: read by everyone, written by admins only. */

import { STORES, getAll, put, remove, putMany, clearStore, getByKey } from '../db/database.js';
import { requireAdmin } from '../core/session.js';
import { AppError, uid, matchesQuery } from '../core/utils.js';
import { MENU_SEED } from '../data/menu.seed.js';
import { rupeesToPaise } from '../core/money.js';

/**
 * A stable, device-independent code for a menu item.
 *
 * Item ids are generated per device, so the counter's "Cappuccino" and a
 * customer's phone's "Cappuccino" have different ids even though they are the
 * same drink. Anything that crosses between devices — a QR order, a published
 * menu — travels by this code instead, which is derived from the item's own
 * name and category and so comes out the same everywhere.
 */
export function menuCode(name, category) {
  const input = `${String(category || '').trim().toLowerCase()}|${String(name || '')
    .trim()
    .toLowerCase()}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash = Math.imul(hash ^ input.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, '0').slice(-7);
}

let cache = null;
const listeners = new Set();

export function onMenuChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function announce() {
  listeners.forEach((fn) => fn(cache));
}

function sortItems(items) {
  return items.sort(
    (a, b) =>
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, 'en')
  );
}

export async function loadMenu() {
  const rows = await getAll(STORES.MENU);

  // Menus created before item codes existed get one now, so a till that has
  // been running since version 1 can take QR orders without being re-seeded.
  const missing = rows.filter((item) => !item.code);
  if (missing.length) {
    const patched = missing.map((item) => ({ ...item, code: menuCode(item.name, item.category) }));
    await putMany(STORES.MENU, patched);
    const byId = new Map(patched.map((item) => [item.id, item]));
    for (let i = 0; i < rows.length; i++) {
      if (byId.has(rows[i].id)) rows[i] = byId.get(rows[i].id);
    }
  }

  cache = sortItems(rows);
  return cache;
}

/** Find an item by its stable code — how an order from a phone is resolved. */
export function getItemByCode(code) {
  return getMenu().find((item) => item.code === code) || null;
}

/** Synchronous read of the cached menu — the POS grid renders from this. */
export function getMenu() {
  return cache || [];
}

export function getItem(id) {
  return getMenu().find((item) => item.id === id) || null;
}

export function getCategories({ includeEmpty = true } = {}) {
  const seen = [];
  for (const item of getMenu()) {
    if (!seen.includes(item.category)) seen.push(item.category);
  }
  return includeEmpty ? seen : seen.filter((c) => getMenu().some((i) => i.category === c && i.available));
}

export function searchMenu({ query = '', category = 'All', availableOnly = false } = {}) {
  return getMenu().filter((item) => {
    if (availableOnly && !item.available) return false;
    if (category && category !== 'All' && item.category !== category) return false;
    if (!query) return true;
    return (
      matchesQuery(item.name, query) ||
      matchesQuery(item.category, query) ||
      matchesQuery(item.description, query)
    );
  });
}

function validate(draft, { existingId = null } = {}) {
  const name = String(draft.name || '').trim();
  const category = String(draft.category || '').trim();

  if (!name) throw new AppError('Give the item a name.', 'VALIDATION');
  if (name.length > 80) throw new AppError('Item names are limited to 80 characters.', 'VALIDATION');
  if (!category) throw new AppError('Choose or type a category.', 'VALIDATION');

  const price = Number(draft.price);
  if (!Number.isInteger(price) || price < 0) {
    throw new AppError('Enter a valid price, for example 180 or 180.50.', 'VALIDATION');
  }
  if (price > 100000000) throw new AppError('That price looks too large.', 'VALIDATION');

  const clash = getMenu().find(
    (item) =>
      item.id !== existingId &&
      item.name.toLowerCase() === name.toLowerCase() &&
      item.category.toLowerCase() === category.toLowerCase()
  );
  if (clash) throw new AppError(`"${name}" already exists in ${category}.`, 'DUPLICATE');

  return { name, category, price };
}

export async function createItem(draft) {
  requireAdmin('adding menu items');
  const { name, category, price } = validate(draft);
  const now = new Date().toISOString();

  const item = {
    id: uid('itm'),
    code: menuCode(name, category),
    name,
    category,
    price,
    description: String(draft.description || '').trim(),
    image: draft.image || '',
    available: draft.available !== false,
    taxRate: draft.taxRate === null || draft.taxRate === undefined ? null : Number(draft.taxRate),
    sortOrder: getMenu().length,
    createdAt: now,
    updatedAt: now,
  };

  await put(STORES.MENU, item);
  cache = sortItems([...getMenu(), item]);
  announce();
  return item;
}

export async function updateItem(id, patch) {
  requireAdmin('editing menu items');
  const existing = await getByKey(STORES.MENU, id);
  if (!existing) throw new AppError('That item is no longer in the menu.', 'NOT_FOUND');

  const merged = { ...existing, ...patch };
  const { name, category, price } = validate(merged, { existingId: id });

  const item = {
    ...merged,
    // The code follows the name and category, so a renamed item is a new item
    // as far as other devices are concerned — which is the honest answer.
    code: menuCode(name, category),
    name,
    category,
    price,
    description: String(merged.description || '').trim(),
    taxRate: merged.taxRate === null || merged.taxRate === undefined ? null : Number(merged.taxRate),
    updatedAt: new Date().toISOString(),
  };

  await put(STORES.MENU, item);
  cache = sortItems(getMenu().map((row) => (row.id === id ? item : row)));
  announce();
  return item;
}

/**
 * Availability toggle is the preferred alternative to deleting: past orders
 * keep referencing the item id and nothing in history breaks.
 */
export async function setAvailability(id, available) {
  requireAdmin('changing item availability');
  return updateItem(id, { available: Boolean(available) });
}

export async function deleteItem(id) {
  requireAdmin('deleting menu items');
  await remove(STORES.MENU, id);
  cache = getMenu().filter((item) => item.id !== id);
  announce();
  return true;
}

export async function reorderCategory(category, orderedIds) {
  requireAdmin('reordering the menu');
  const updates = [];
  orderedIds.forEach((id, index) => {
    const item = getItem(id);
    if (item && item.category === category) updates.push({ ...item, sortOrder: index });
  });
  if (updates.length) {
    await putMany(STORES.MENU, updates);
    await loadMenu();
    announce();
  }
}

/** Menu items ready for the database, straight from the printed menu card. */
export function buildSeedItems() {
  const now = new Date().toISOString();
  return MENU_SEED.map((item, index) => ({
    id: uid('itm'),
    code: menuCode(item.name, item.category),
    name: item.name,
    category: item.category,
    price: rupeesToPaise(item.price),
    description: item.description || '',
    image: '',
    available: true,
    taxRate: null,
    sortOrder: index,
    createdAt: now,
    updatedAt: now,
  }));
}

export async function seedMenuIfEmpty() {
  const existing = await getAll(STORES.MENU);
  if (existing.length) {
    cache = sortItems(existing);
    return { seeded: false, count: existing.length };
  }
  const items = buildSeedItems();
  await putMany(STORES.MENU, items);
  cache = sortItems(items);
  announce();
  return { seeded: true, count: items.length };
}

/**
 * Add items that are in the menu file but not yet on this device, and touch
 * nothing else.
 *
 * The destructive reset below is no use to a cafe that has been trading: it
 * would take their price edits with it. When a new menu card is added to the
 * file — the food menu, say — this brings just the new items across and leaves
 * every existing item, price and availability exactly as it is.
 *
 * Matching is by the item's stable code, so an item that was renamed on this
 * device comes back as a new one rather than being silently skipped. That is
 * the honest behaviour: the code IS the identity everything else relies on.
 */
export function previewMissingSeedItems() {
  const existing = new Set(getMenu().map((item) => item.code));
  const missing = MENU_SEED.filter((item) => !existing.has(menuCode(item.name, item.category)));

  const counts = new Map();
  for (const item of missing) counts.set(item.category, (counts.get(item.category) || 0) + 1);

  return {
    count: missing.length,
    categories: [...counts.entries()].map(([category, count]) => ({ category, count })),
  };
}

export async function addMissingSeedItems() {
  requireAdmin('adding items from the menu file');

  const existing = new Set(getMenu().map((item) => item.code));
  const missing = buildSeedItems().filter((item) => !existing.has(item.code));

  if (!missing.length) {
    return { added: 0, skipped: MENU_SEED.length, categories: [] };
  }

  // New items go on the end of the list rather than interleaving with a menu
  // somebody has already put in the order they like.
  let sortOrder = getMenu().reduce((max, item) => Math.max(max, item.sortOrder ?? 0), -1) + 1;
  const items = missing.map((item) => ({ ...item, sortOrder: sortOrder++ }));

  await putMany(STORES.MENU, items);
  await loadMenu();
  announce();

  return {
    added: items.length,
    skipped: MENU_SEED.length - items.length,
    categories: [...new Set(items.map((item) => item.category))],
  };
}

/** Admin action: throw away the working menu and reload from menu.seed.js. */
export async function resetMenuToSeed() {
  requireAdmin('resetting the menu');
  await clearStore(STORES.MENU);
  const items = buildSeedItems();
  await putMany(STORES.MENU, items);
  cache = sortItems(items);
  announce();
  return items.length;
}

/** Used by backup restore. */
export async function replaceAll(items) {
  await clearStore(STORES.MENU);
  if (items.length) await putMany(STORES.MENU, items);
  await loadMenu();
  announce();
}
