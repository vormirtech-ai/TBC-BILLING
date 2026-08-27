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
import { ORDER_SOURCES } from '../config/app.config.js';
import { getSettings } from '../repositories/settings.repo.js';
import { priceOrder } from './pricing.js';

const DRAFT_KEY = 'tbc.cart.draft';
const MAX_QUANTITY = 999;

const state = {
  lines: [],
  discount: { type: 'PERCENT', value: 0 },
  customerName: '',
  /** The regular this order belongs to, when one has been looked up. */
  customerId: '',
  customerPhone: '',
  /** A loyalty treat: one item on the order given free. See loyalty.service.js. */
  reward: null,
  note: '',
  /** Which table this order is for, when the cafe seats people. */
  tableId: '',
  tableName: '',
  /** COUNTER, or QR when the order arrived from a customer's phone. */
  source: ORDER_SOURCES.COUNTER,
  /** Set when the order came in through a table QR code. */
  onlineOrderId: '',
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

/**
 * A reward belongs to a line. Take the line away — or empty the order — and the
 * free coffee has nothing to be free on, so it goes too. Doing this before
 * every repaint is what stops a cleared cart from carrying a phantom discount.
 */
function reconcileReward() {
  if (!state.reward) return;
  const line = state.lines.find((row) => row.lineId === state.reward.lineId);
  if (!line) state.reward = null;
  else state.reward = { ...state.reward, name: line.name, unitPrice: line.unitPrice };
}

function announce() {
  reconcileReward();
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
    state.customerId = saved.customerId || '';
    state.customerPhone = saved.customerPhone || '';
    state.reward = saved.reward || null;
    state.note = saved.note || '';
    state.tableId = saved.tableId || '';
    state.tableName = saved.tableName || '';
    state.source = saved.source || ORDER_SOURCES.COUNTER;
    state.onlineOrderId = saved.onlineOrderId || '';
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
  reconcileReward();
  const totals = priceOrder(state.lines, getSettings(), state.discount, state.reward);
  return {
    ...totals,
    lines: totals.items,
    discount: { ...state.discount },
    reward: state.reward ? { ...state.reward } : null,
    customerName: state.customerName,
    customerId: state.customerId,
    customerPhone: state.customerPhone,
    note: state.note,
    tableId: state.tableId,
    tableName: state.tableName,
    source: state.source,
    onlineOrderId: state.onlineOrderId,
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

/**
 * Attach a regular to this order, or pass null to take them off it.
 *
 * Taking the customer off also takes off any treat they had earned: the reward
 * belongs to the person, not to the order.
 */
export function setCustomer(customer) {
  if (!customer) {
    state.customerId = '';
    state.customerPhone = '';
    state.reward = null;
  } else {
    state.customerId = customer.id || '';
    state.customerPhone = customer.phone || '';
    if (customer.name) state.customerName = String(customer.name).slice(0, 60);
  }
  announce();
  return getCart();
}

export function getCustomerId() {
  return state.customerId;
}

/** Put a loyalty treat on the order. See loyalty.service.js for what is earned. */
export function setReward(reward) {
  if (!reward) {
    state.reward = null;
  } else {
    const line = state.lines.find((row) => row.lineId === reward.lineId);
    if (!line) throw new AppError('That item is no longer on the order.', 'NOT_FOUND');
    state.reward = { ...reward, name: line.name, unitPrice: line.unitPrice };
  }
  announce();
  return getCart();
}

export function clearReward() {
  return setReward(null);
}

export function setNote(note) {
  state.note = String(note || '').slice(0, 200);
  persist();
}

/** Seat this order at a table, or pass null to take it off one. */
export function setTable(table) {
  state.tableId = table?.id || '';
  state.tableName = table?.name || '';
  announce();
  return getCart();
}

export function getTableId() {
  return state.tableId;
}

/**
 * Load a customer's QR order onto the counter, ready to be billed. The lines
 * carry the prices the customer was shown, exactly as a counter order would.
 */
export function loadOnlineOrder(order, table) {
  state.lines = order.lines.map((line) => ({
    lineId: uid('ln'),
    itemId: line.itemId,
    name: line.name,
    category: line.category || '',
    unitPrice: line.unitPrice,
    quantity: line.quantity,
    taxRate: line.taxRate ?? null,
    note: line.note || '',
  }));
  state.discount = { type: 'PERCENT', value: 0 };
  state.reward = null;
  state.customerName = order.customerName || '';
  state.customerId = order.customerId || '';
  state.customerPhone = order.customerPhone || '';
  state.note = order.note || '';
  state.tableId = table?.id || order.tableId || '';
  state.tableName = table?.name || order.tableName || '';
  // An order taken at the counter and recalled is still a counter order; only
  // one that came in from a phone bills as a QR order.
  state.source = order.source || ORDER_SOURCES.QR;
  state.onlineOrderId = order.id;
  announce();
  return getCart();
}

export function clearCart() {
  state.lines = [];
  state.discount = { type: 'PERCENT', value: 0 };
  state.reward = null;
  state.customerName = '';
  state.customerId = '';
  state.customerPhone = '';
  state.note = '';
  state.tableId = '';
  state.tableName = '';
  state.source = ORDER_SOURCES.COUNTER;
  state.onlineOrderId = '';
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
  announce();
  return getCart();
}
