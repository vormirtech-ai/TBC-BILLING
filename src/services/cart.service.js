/**
 * The open order at the counter.
 *
 * Two things matter here:
 *
 * 1. PRICE SNAPSHOTS. When an item is added, its price is copied into the cart
 *    line. If an admin edits the menu price while an order is open, the open
 *    order keeps the price the customer was quoted.
 *
 * 2. CRASH SAFETY. The draft is mirrored to localStorage on every change, so a
 *    stray refresh or a laptop lid closing mid-order does not wipe the counter.
 *    Only completed orders go to IndexedDB; a draft is never a sale.
 */

import { AppError, uid } from '../core/utils.js';
import { getSettings } from '../repositories/settings.repo.js';
import { priceOrder } from './pricing.js';

const DRAFT_KEY = 'tbc.cart.draft';
const MAX_QUANTITY = 999;

const state = {
  lines: [],
  discount: { type: 'PERCENT', value: 0 },
  customerName: '',
  note: '',
};

const listeners = new Set();

export function onCartChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function persist() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
  } catch {
    /* storage full or blocked — the in-memory cart still works */
  }
}

function announce() {
  persist();
  const snapshot = getCart();
  listeners.forEach((fn) => fn(snapshot));
}

export function restoreDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved.lines) || !saved.lines.length) return false;

    state.lines = saved.lines.filter(
      (line) => line && Number.isInteger(line.unitPrice) && line.quantity > 0
    );
    state.discount = saved.discount || { type: 'PERCENT', value: 0 };
    state.customerName = saved.customerName || '';
    state.note = saved.note || '';
    announce();
    return state.lines.length > 0;
  } catch {
    return false;
  }
}

/* --------------------------------------------------------------- reads --- */

export function getLines() {
  return state.lines.map((line) => ({ ...line }));
}

export function isEmpty() {
  return state.lines.length === 0;
}

export function quantityOf(itemId) {
  return state.lines
    .filter((line) => line.itemId === itemId)
    .reduce((total, line) => total + line.quantity, 0);
}

/** The cart, fully priced against current settings. */
export function getCart() {
  const totals = priceOrder(state.lines, getSettings(), state.discount);
  return {
    ...totals,
    lines: totals.items,
    discount: { ...state.discount },
    customerName: state.customerName,
    note: state.note,
  };
}

/* -------------------------------------------------------------- writes --- */

/**
 * Add a menu item. Clicking the same item again bumps the quantity on the
 * existing row instead of stacking duplicate rows.
 */
export function addItem(item, quantity = 1) {
  if (!item) throw new AppError('That item is no longer on the menu.', 'NOT_FOUND');
  if (!item.available) throw new AppError(`${item.name} is marked unavailable.`, 'UNAVAILABLE');

  const existing = state.lines.find(
    (line) => line.itemId === item.id && line.unitPrice === item.price && !line.note
  );

  if (existing) {
    existing.quantity = Math.min(MAX_QUANTITY, existing.quantity + quantity);
  } else {
    state.lines.push({
      lineId: uid('ln'),
      itemId: item.id,
      name: item.name,
      category: item.category,
      unitPrice: item.price, // snapshot — never re-read from the menu later
      quantity: Math.min(MAX_QUANTITY, Math.max(1, quantity)),
      taxRate: item.taxRate ?? null,
      note: '',
    });
  }
  announce();
  return getCart();
}

export function setQuantity(lineId, quantity) {
  const line = state.lines.find((row) => row.lineId === lineId);
  if (!line) return getCart();

  const next = Math.round(Number(quantity));
  if (!Number.isFinite(next)) throw new AppError('Enter a whole number of items.', 'VALIDATION');

  if (next <= 0) return removeLine(lineId);
  line.quantity = Math.min(MAX_QUANTITY, next);
  announce();
  return getCart();
}

export function increment(lineId, by = 1) {
  const line = state.lines.find((row) => row.lineId === lineId);
  if (!line) return getCart();
  return setQuantity(lineId, line.quantity + by);
}

export function removeLine(lineId) {
  state.lines = state.lines.filter((row) => row.lineId !== lineId);
  announce();
  return getCart();
}

export function setLineNote(lineId, note) {
  const line = state.lines.find((row) => row.lineId === lineId);
  if (!line) return getCart();
  line.note = String(note || '').slice(0, 120);
  announce();
  return getCart();
}

export function setDiscount(type, value) {
  const settings = getSettings();
  if (!settings.discountEnabled) throw new AppError('Discounts are switched off in Settings.', 'DISABLED');

  const amount = Number(value) || 0;
  if (amount < 0) throw new AppError('A discount cannot be negative.', 'VALIDATION');
  if (type === 'PERCENT' && amount > (Number(settings.maxDiscountPercent) || 100) * 100) {
    throw new AppError(`The maximum discount is ${settings.maxDiscountPercent}%.`, 'VALIDATION');
  }
  state.discount = { type: type === 'FLAT' ? 'FLAT' : 'PERCENT', value: Math.round(amount) };
  announce();
  return getCart();
}

export function clearDiscount() {
  state.discount = { type: 'PERCENT', value: 0 };
  announce();
  return getCart();
}

export function setCustomerName(name) {
  state.customerName = String(name || '').slice(0, 60);
  persist();
}

export function setNote(note) {
  state.note = String(note || '').slice(0, 200);
  persist();
}

export function clearCart() {
  state.lines = [];
  state.discount = { type: 'PERCENT', value: 0 };
  state.customerName = '';
  state.note = '';
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
  announce();
  return getCart();
}
