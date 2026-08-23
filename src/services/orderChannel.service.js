/**
 * Getting an order from a customer's phone to the counter.
 *
 * There are three routes, and the app uses whichever ones are available:
 *
 *   1. SAME BROWSER — a BroadcastChannel, with a localStorage ping as a
 *      fallback for browsers that lack one. Instant, and covers a counter
 *      tablet where the customer menu is open in another tab.
 *
 *   2. HANDOFF CODE — the order is squeezed into a short string shown as a QR
 *      code and as four-character text. The counter scans or types it and the
 *      order lands in the till. No server, no network, works between any two
 *      devices in the room. This is the default answer for a static site.
 *
 *   3. SHARED BACKEND — if the cafe has filled in the cloud settings, orders
 *      travel by themselves and the counter polls for new ones.
 *
 * A handoff code carries item CODES, not prices. The counter prices the order
 * from its own menu, so a stale price on a customer's phone can never decide
 * what is charged.
 */

import { AppError, uid } from '../core/utils.js';
import { ONLINE_ORDER_STATUS } from '../config/app.config.js';
import * as ordersRepo from '../repositories/onlineOrders.repo.js';
import * as cloud from './cloudSync.service.js';

const CHANNEL_NAME = 'tbc.orders';
const PING_KEY = 'tbc.orders.ping';
const DEVICE_KEY = 'tbc.device';
const CURSOR_KEY = 'tbc.orders.cursor';

/* -------------------------------------------------------------- device --- */

/** A stable id for this browser, so a phone can follow its own orders. */
export function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = uid('dev');
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return 'dev_unknown';
  }
}

/* ------------------------------------------------------- local channel --- */

let channel = null;

function broadcastChannel() {
  if (channel !== null) return channel;
  try {
    channel = 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL_NAME) : false;
  } catch {
    channel = false;
  }
  return channel;
}

function broadcast(message) {
  const bus = broadcastChannel();
  if (bus) {
    try {
      bus.postMessage(message);
    } catch {
      /* a structured-clone failure must not stop the order being saved */
    }
  }
  // Older browsers get the same message through a storage event.
  try {
    localStorage.setItem(PING_KEY, JSON.stringify({ ...message, at: Date.now() }));
  } catch {
    /* storage full or blocked */
  }
}

/**
 * Listen for orders and status changes from anywhere.
 *
 * @param {(event:{type:string, order?:object}) => void} handler
 * @returns {() => void} unsubscribe
 */
export function subscribeOrders(handler) {
  const self = deviceId();

  const onMessage = (event) => {
    const message = event?.data;
    if (!message?.type) return;
    if (message.from === self) return; // our own echo
    handler(message);
  };

  const onStorage = (event) => {
    if (event.key !== PING_KEY || !event.newValue) return;
    try {
      const message = JSON.parse(event.newValue);
      if (message.from === self) return;
      handler(message);
    } catch {
      /* ignore a malformed ping */
    }
  };

  const bus = broadcastChannel();
  if (bus) bus.addEventListener('message', onMessage);
  window.addEventListener('storage', onStorage);

  // Anything this tab does itself still needs to repaint the queue.
  const unsubscribeLocal = ordersRepo.onOrdersChange(() => handler({ type: 'refresh' }));

  return () => {
    if (bus) bus.removeEventListener('message', onMessage);
    window.removeEventListener('storage', onStorage);
    unsubscribeLocal();
  };
}

/* --------------------------------------------------------- cloud polling --- */

let pollTimer = null;

function readCursor() {
  try {
    return localStorage.getItem(CURSOR_KEY) || '';
  } catch {
    return '';
  }
}

function writeCursor(value) {
  try {
    localStorage.setItem(CURSOR_KEY, value);
  } catch {
    /* ignore */
  }
}

/**
 * Pull anything new from the shared backend into this device's queue.
 * Safe to call at any time; does nothing when cloud sync is off.
 */
export async function pullRemoteOrders() {
  if (!cloud.isCloudEnabled()) return 0;

  const since = readCursor();
  const incoming = await cloud.pullOrders(since);
  if (!incoming.length) return 0;

  let received = 0;
  let newest = since;

  for (const order of incoming) {
    if (order?.deviceId === deviceId()) continue; // came from here
    try {
      const stored = await ordersRepo.receiveOrder(order);
      if (stored) received += 1;
    } catch (error) {
      console.error('[TBC POS] ignored a malformed order from the shared backend', error);
    }
    const stamp = order?.placedAt || '';
    if (stamp > newest) newest = stamp;
  }

  if (newest && newest !== since) writeCursor(newest);
  return received;
}

/** Start polling the shared backend. Returns a function that stops it. */
export function startOrderSync() {
  stopOrderSync();
  if (!cloud.isCloudEnabled()) return () => {};

  const { pollSeconds } = cloud.cloudConfig();
  const tick = async () => {
    try {
      const received = await pullRemoteOrders();
      if (received) ordersRepo.announceOrders();
    } catch (error) {
      console.error('[TBC POS] order sync failed', error);
    }
  };

  tick();
  pollTimer = setInterval(tick, pollSeconds * 1000);
  return stopOrderSync;
}

export function stopOrderSync() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/* --------------------------------------------------------------- send --- */

/** Place an order and push it out by every route available. */
export async function sendOrder(draft) {
  const order = await ordersRepo.placeOrder({ ...draft, deviceId: deviceId() });

  broadcast({ type: 'order', order, from: deviceId() });
  await cloud.pushOrder(order);

  return order;
}

/** Tell everyone an order was accepted, rejected or billed. */
export async function announceStatus(order) {
  broadcast({ type: 'status', order, from: deviceId() });
  await cloud.pushOrderStatus(order);
  return order;
}

/* ------------------------------------------------------- handoff codes --- */

const HANDOFF_PREFIX = 'TBC1';

/** Small non-cryptographic checksum, enough to catch a mistyped code. */
function checksum(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(6, '0').slice(-6);
}

/**
 * Squeeze an order into a string a QR code can carry.
 *
 * Item codes rather than ids, quantities rather than prices: short enough for a
 * small QR code, and it forces the counter to price from its own menu.
 */
export function encodeHandoff(order) {
  const lines = order.lines
    .map((line) => `${line.code}*${line.quantity}`)
    .join(',');
  const body = [
    HANDOFF_PREFIX,
    order.tableToken || '',
    lines,
    encodeURIComponent(order.customerName || ''),
    encodeURIComponent(order.note || ''),
    order.code || '',
  ].join('|');

  return `${body}|${checksum(body)}`;
}

/**
 * Read a handoff string back.
 *
 * @returns {{tableToken:string, lines:{code:string, quantity:number}[],
 *            customerName:string, note:string, code:string}}
 */
export function decodeHandoff(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new AppError('Paste or scan a customer order code first.', 'VALIDATION');

  const parts = raw.split('|');
  if (parts[0] !== HANDOFF_PREFIX || parts.length !== 7) {
    throw new AppError('That is not a customer order code from this app.', 'BAD_HANDOFF');
  }

  const body = parts.slice(0, 6).join('|');
  if (checksum(body) !== parts[6]) {
    throw new AppError('That order code is incomplete or was mistyped.', 'BAD_HANDOFF');
  }

  const lines = [];
  for (const entry of parts[2].split(',').filter(Boolean)) {
    const [code, quantity] = entry.split('*');
    const count = Number(quantity);
    if (!code || !Number.isInteger(count) || count < 1 || count > 99) {
      throw new AppError('That order code contains an item we cannot read.', 'BAD_HANDOFF');
    }
    lines.push({ code, quantity: count });
  }
  if (!lines.length) throw new AppError('That order code has no items in it.', 'BAD_HANDOFF');

  return {
    tableToken: parts[1],
    lines,
    customerName: decodeURIComponent(parts[3] || ''),
    note: decodeURIComponent(parts[4] || ''),
    code: parts[5] || '',
  };
}

/** How an order should be described to the customer once it is placed. */
export function deliveryRoute() {
  if (cloud.isCloudEnabled()) return 'CLOUD';
  return 'HANDOFF';
}

export { ONLINE_ORDER_STATUS };
