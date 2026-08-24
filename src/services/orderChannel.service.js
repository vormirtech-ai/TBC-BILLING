/**
 * Getting an order from a customer's phone to the counter.
 *
 * With the cafe database connected — which is how this is meant to run — an
 * order is simply another record: the phone writes it, sync carries it, and it
 * appears at the counter within seconds without anybody scanning anything.
 *
 * Two other routes exist for when it is not:
 *
 *   SAME BROWSER — a BroadcastChannel, with a localStorage ping behind it, so a
 *   counter tablet with the customer menu open in another tab sees the order at
 *   once.
 *
 *   HANDOFF CODE — the order squeezed into a short string, shown as a QR code
 *   and four readable characters, which the counter scans or types. It needs no
 *   network whatsoever, so it is what the app falls back to rather than losing
 *   somebody's order.
 *
 * A handoff code carries item CODES, not prices. The counter prices the order
 * from its own menu, so a stale price on a customer's phone can never decide
 * what is charged.
 */

import { AppError } from '../core/utils.js';
import { ONLINE_ORDER_STATUS } from '../config/app.config.js';
import { deviceId } from '../core/device.js';
import * as ordersRepo from '../repositories/onlineOrders.repo.js';
import * as cloud from './cloudSync.service.js';
import { syncNow, pushPending } from './sync.service.js';

const CHANNEL_NAME = 'tbc.orders';
const PING_KEY = 'tbc.orders.ping';

export { deviceId };

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

/* ----------------------------------------------------- shared database --- */

/**
 * Orders travel on the shared database like every other record, so there is no
 * separate poller here any more — sync.service brings them in and the queue
 * repaints from the repository's own change event.
 *
 * This remains as the "check right now" the Refresh button calls.
 */
export async function pullRemoteOrders() {
  if (!cloud.isCloudEnabled()) return 0;
  const result = await syncNow();
  return result?.orders || 0;
}

/** Kept for callers that used to start a poller of their own. */
export function startOrderSync() {
  return () => {};
}

export function stopOrderSync() {}

/* --------------------------------------------------------------- send --- */

/**
 * Place an order and get it to the counter.
 *
 * The order is stored first, so it exists even if the phone loses signal on the
 * next step, and then pushed straight away rather than waiting for the next
 * sync tick — a customer watching a spinner should not be waiting on a timer.
 */
export async function sendOrder(draft) {
  const order = await ordersRepo.placeOrder({ ...draft, deviceId: deviceId() });

  broadcast({ type: 'order', order, from: deviceId() });
  if (cloud.isCloudEnabled()) await pushPending();

  return order;
}

/** Tell everyone an order was accepted, rejected or billed. */
export async function announceStatus(order) {
  broadcast({ type: 'status', order, from: deviceId() });
  if (cloud.isCloudEnabled()) await pushPending();
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

/**
 * How an order reaches the counter, which decides what the customer is told.
 *
 * CLOUD    — it goes by itself, and the phone can follow what happens to it.
 * HANDOFF  — there is no shared database, so the phone shows a code instead.
 */
export function deliveryRoute() {
  return cloud.isCloudEnabled() ? 'CLOUD' : 'HANDOFF';
}

export { ONLINE_ORDER_STATUS };
