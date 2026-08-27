/**
 * Orders — everything the cafe has agreed to make but has not yet been paid for.
 *
 * Two things end up here. An order taken at the counter and sent to the kitchen,
 * so the till is free for the next customer while that one is being made; and an
 * order that arrived from a table's QR code.
 *
 * The difference between them is who agreed to it. An order placed from a
 * customer's phone is a REQUEST, not a sale: it carries no payment and books
 * nothing, it lands in the queue as NEW, and a member of staff decides whether
 * it is real. An order taken at the counter was agreed to by the person taking
 * it, so it starts at ACCEPTED — already being made.
 *
 * Either way an order only becomes money when it is billed through the counter.
 * That is why placing one is the single write in this app that does not require
 * a signed-in user, and why every other move on an order does.
 *
 * The store is still called onlineOrders, from when QR orders were the only
 * kind. Renaming it would mean a migration that buys the cafe nothing.
 */

import { STORES, getAll, getByKey, put, remove, putMany, clearStore } from '../db/database.js';
import { requireSignedIn, getSession } from '../core/session.js';
import { AppError, uid } from '../core/utils.js';
import {
  ONLINE_ORDER_STATUS,
  ORDER_SOURCES,
  ORDER_STATUS_FLOW,
  ORDER_STATUS_LABELS,
  OPEN_ORDER_STATUSES,
} from '../config/app.config.js';

const listeners = new Set();

export function onOrdersChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function announceOrders() {
  listeners.forEach((fn) => fn());
}

/**
 * A short code a customer and a cashier can say out loud: "order K7QM".
 * Ambiguous characters are left out so it survives being read off a screen.
 */
export function shortCode() {
  const alphabet = 'ACDEFGHJKLMNPQRTUVWXY34679';
  const bytes = new Uint8Array(4);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < 4; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

/* --------------------------------------------------------------- reads --- */

export function listOrders() {
  return getAll(STORES.ONLINE_ORDERS).then((rows) =>
    rows.sort((a, b) => String(b.placedAt).localeCompare(String(a.placedAt)))
  );
}

/** Orders a customer has asked for and nobody has agreed to yet. */
export async function listPendingOrders() {
  const rows = await listOrders();
  return rows.filter((row) => row.status === ONLINE_ORDER_STATUS.NEW);
}

/** Everything still on the floor: waiting, being made, ready, or served. */
export async function listOpenOrders() {
  const rows = await listOrders();
  return rows.filter((row) => OPEN_ORDER_STATUSES.includes(row.status));
}

/** Open orders for one table, newest first. */
export async function listOrdersForTable(tableId) {
  if (!tableId) return [];
  const rows = await listOpenOrders();
  return rows.filter((row) => row.tableId === tableId);
}

export function getOrder(id) {
  return getByKey(STORES.ONLINE_ORDERS, id);
}

export async function findByCode(code) {
  const key = String(code || '').trim().toUpperCase();
  if (!key) return null;
  const rows = await getAll(STORES.ONLINE_ORDERS);
  return rows.find((row) => row.code === key) || null;
}

/** Orders a customer placed from this phone, so they can watch their own. */
export async function listForDevice(deviceId) {
  const rows = await listOrders();
  return rows.filter((row) => row.deviceId === deviceId);
}

/* -------------------------------------------------------------- writes --- */

function validateLines(lines) {
  if (!Array.isArray(lines) || !lines.length) {
    throw new AppError('Add something to the order first.', 'EMPTY_ORDER');
  }
  if (lines.length > 60) {
    throw new AppError('That is too many different items for one order.', 'TOO_LARGE');
  }

  return lines.map((line) => {
    const quantity = Math.round(Number(line.quantity) || 0);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new AppError('Item quantities must be between 1 and 99.', 'VALIDATION');
    }
    if (!line.code || !line.name) {
      throw new AppError('That order refers to an item we cannot identify.', 'VALIDATION');
    }
    return {
      code: String(line.code),
      itemId: String(line.itemId || ''),
      name: String(line.name).slice(0, 80),
      category: String(line.category || '').slice(0, 40),
      unitPrice: Math.max(0, Math.round(Number(line.unitPrice) || 0)),
      quantity,
      note: String(line.note || '').slice(0, 120),
    };
  });
}

/**
 * Record an order placed from a phone.
 *
 * @param {{tableId:string, tableToken:string, tableName:string, lines:Array,
 *          customerName?:string, note?:string, deviceId?:string}} draft
 */
export async function placeOrder(draft) {
  const lines = validateLines(draft.lines);
  if (!draft.tableToken) {
    throw new AppError('This order is not linked to a table. Scan the code again.', 'NO_TABLE');
  }

  const now = new Date().toISOString();
  const order = {
    id: draft.id || uid('ord'),
    code: draft.code || shortCode(),
    tableId: draft.tableId || '',
    tableToken: draft.tableToken,
    tableName: draft.tableName || '',
    lines,
    // What the customer was shown. The counter re-prices from its own menu when
    // the order is billed, so this is an estimate, never the charge.
    estimatedTotal: lines.reduce((total, line) => total + line.unitPrice * line.quantity, 0),
    customerName: String(draft.customerName || '').slice(0, 60),
    customerId: String(draft.customerId || ''),
    customerPhone: String(draft.customerPhone || ''),
    note: String(draft.note || '').slice(0, 200),
    source: ORDER_SOURCES.QR,
    status: ONLINE_ORDER_STATUS.NEW,
    placedAt: draft.placedAt || now,
    deviceId: draft.deviceId || '',
    acceptedAt: null,
    acceptedBy: '',
    billedAt: null,
    transactionId: '',
    orderNo: '',
    rejectedAt: null,
    rejectReason: '',
  };

  await put(STORES.ONLINE_ORDERS, order);
  announceOrders();
  return order;
}

/**
 * Take an order at the counter and send it to the kitchen.
 *
 * The till is handed back empty afterwards, so one person can keep serving
 * while the order is made. It comes back to the counter to be paid for through
 * the same route a QR order does.
 *
 * @param {{lines:Array, tableId?:string, tableName?:string, customerName?:string,
 *          customerId?:string, customerPhone?:string, note?:string}} draft
 */
export async function createCounterOrder(draft) {
  const session = requireSignedIn();
  const lines = validateLines(
    (draft.lines || []).map((line) => ({ ...line, code: line.code || line.itemId }))
  );

  const now = new Date().toISOString();
  const order = {
    id: uid('ord'),
    code: shortCode(),
    tableId: draft.tableId || '',
    tableToken: '',
    tableName: draft.tableName || '',
    lines,
    estimatedTotal: lines.reduce((total, line) => total + line.unitPrice * line.quantity, 0),
    customerName: String(draft.customerName || '').slice(0, 60),
    customerId: String(draft.customerId || ''),
    customerPhone: String(draft.customerPhone || ''),
    note: String(draft.note || '').slice(0, 200),
    source: ORDER_SOURCES.COUNTER,
    // Nobody has to agree to an order the counter itself took.
    status: ONLINE_ORDER_STATUS.ACCEPTED,
    placedAt: now,
    deviceId: '',
    acceptedAt: now,
    acceptedBy: session.username,
    billedAt: null,
    transactionId: '',
    orderNo: '',
    rejectedAt: null,
    rejectReason: '',
  };

  await put(STORES.ONLINE_ORDERS, order);
  announceOrders();
  return order;
}

/**
 * Move an order along: being made → ready → served, or back a step when
 * somebody taps the wrong thing. What may follow what is in ORDER_STATUS_FLOW,
 * so an order can never jump straight to billed without a bill existing.
 */
export async function setOrderStatus(id, status) {
  requireSignedIn();
  const order = await getOrder(id);
  if (!order) throw new AppError('That order is no longer in the queue.', 'NOT_FOUND');

  const allowed = ORDER_STATUS_FLOW[order.status] || [];
  if (!allowed.includes(status)) {
    throw new AppError(
      `An order that is ${(ORDER_STATUS_LABELS[order.status] || order.status).toLowerCase()} cannot be marked ${(
        ORDER_STATUS_LABELS[status] || status
      ).toLowerCase()}.`,
      'BAD_STATUS'
    );
  }

  const now = new Date().toISOString();
  const stamps = {
    [ONLINE_ORDER_STATUS.ACCEPTED]: { acceptedAt: now, acceptedBy: getSession()?.username || '' },
    [ONLINE_ORDER_STATUS.READY]: { readyAt: now },
    [ONLINE_ORDER_STATUS.SERVED]: { servedAt: now },
  };

  const record = { ...order, status, ...(stamps[status] || {}), updatedAt: now };
  await put(STORES.ONLINE_ORDERS, record);
  announceOrders();
  return record;
}

/**
 * Change what an open order is for.
 *
 * An order that was ready or served and then changed goes back to being made,
 * because it is not ready any more — somebody has to make the new part of it.
 */
export async function updateOrder(id, patch) {
  requireSignedIn();
  const order = await getOrder(id);
  if (!order) throw new AppError('That order is no longer in the queue.', 'NOT_FOUND');
  if (order.status === ONLINE_ORDER_STATUS.BILLED) {
    throw new AppError('That order has already been billed.', 'ALREADY_BILLED');
  }

  const lines = patch.lines
    ? validateLines(patch.lines.map((line) => ({ ...line, code: line.code || line.itemId })))
    : order.lines;

  const settled = [ONLINE_ORDER_STATUS.READY, ONLINE_ORDER_STATUS.SERVED];
  const record = {
    ...order,
    ...patch,
    lines,
    estimatedTotal: lines.reduce((total, line) => total + line.unitPrice * line.quantity, 0),
    status: patch.lines && settled.includes(order.status) ? ONLINE_ORDER_STATUS.ACCEPTED : order.status,
    updatedAt: new Date().toISOString(),
  };

  await put(STORES.ONLINE_ORDERS, record);
  announceOrders();
  return record;
}

/** Store an order that arrived from somewhere else, without re-issuing its id. */
export async function receiveOrder(order) {
  if (!order?.id) return null;

  const existing = await getByKey(STORES.ONLINE_ORDERS, order.id);
  // Never let an incoming copy undo work already done at the counter.
  if (existing && existing.status !== ONLINE_ORDER_STATUS.NEW) return existing;

  const record = { ...order, lines: validateLines(order.lines) };
  await put(STORES.ONLINE_ORDERS, record);
  announceOrders();
  return record;
}

export async function acceptOrder(id) {
  const session = requireSignedIn();
  const order = await getOrder(id);
  if (!order) throw new AppError('That order is no longer in the queue.', 'NOT_FOUND');
  if (order.status === ONLINE_ORDER_STATUS.BILLED) {
    throw new AppError('That order has already been billed.', 'ALREADY_BILLED');
  }

  const record = {
    ...order,
    status: ONLINE_ORDER_STATUS.ACCEPTED,
    acceptedAt: new Date().toISOString(),
    acceptedBy: session.username,
  };
  await put(STORES.ONLINE_ORDERS, record);
  announceOrders();
  return record;
}

export async function rejectOrder(id, reason) {
  const session = requireSignedIn();
  const text = String(reason || '').trim();
  if (!text) throw new AppError('Give a reason so the customer can be told.', 'VALIDATION');

  const order = await getOrder(id);
  if (!order) throw new AppError('That order is no longer in the queue.', 'NOT_FOUND');
  if (order.status === ONLINE_ORDER_STATUS.BILLED) {
    throw new AppError('That order has already been billed.', 'ALREADY_BILLED');
  }

  const record = {
    ...order,
    status: ONLINE_ORDER_STATUS.REJECTED,
    rejectedAt: new Date().toISOString(),
    rejectedBy: session.username,
    rejectReason: text,
  };
  await put(STORES.ONLINE_ORDERS, record);
  announceOrders();
  return record;
}

/** Close an order off once its bill exists. */
export async function markBilled(id, transaction) {
  const order = await getOrder(id);
  if (!order) return null;

  const record = {
    ...order,
    status: ONLINE_ORDER_STATUS.BILLED,
    billedAt: new Date().toISOString(),
    billedBy: getSession()?.username || '',
    transactionId: transaction?.id || '',
    orderNo: transaction?.orderNo || '',
  };
  await put(STORES.ONLINE_ORDERS, record);
  announceOrders();
  return record;
}

export async function deleteOrder(id) {
  requireSignedIn();
  await remove(STORES.ONLINE_ORDERS, id);
  announceOrders();
  return true;
}

/**
 * Housekeeping. Finished orders are worth keeping for the day and then not
 * worth keeping at all — the bill is the permanent record, not the request.
 */
export async function pruneFinishedOrders(olderThanDays = 3) {
  const cutoff = Date.now() - olderThanDays * 86400000;
  const rows = await getAll(STORES.ONLINE_ORDERS);

  // Only orders that are finished with. An order still on the floor — being
  // made, ready, or served and not yet paid for — is somebody's coffee, however
  // long it has been sitting there.
  const finished = [ONLINE_ORDER_STATUS.BILLED, ONLINE_ORDER_STATUS.REJECTED];
  const stale = rows.filter(
    (row) => finished.includes(row.status) && new Date(row.placedAt).getTime() < cutoff
  );
  for (const row of stale) await remove(STORES.ONLINE_ORDERS, row.id);
  return stale.length;
}

/* ------------------------------------------------------ backup support --- */

export async function replaceAll(orders) {
  await clearStore(STORES.ONLINE_ORDERS);
  if (orders?.length) await putMany(STORES.ONLINE_ORDERS, orders);
  announceOrders();
}
