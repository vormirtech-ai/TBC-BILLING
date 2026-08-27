/**
 * Turning a customer's order into an order at the counter.
 *
 * However an order arrives — live from the shared backend, from another tab, or
 * typed in from a handoff code — it goes through here, and the same rule
 * applies to all three: THE COUNTER PRICES THE ORDER.
 *
 * Item codes are resolved against this device's own menu and the price is taken
 * from there. A customer's phone might be showing a menu published last week; it
 * is not allowed to decide what anybody is charged. If an item cannot be
 * matched at all it is reported rather than silently dropped, because a missing
 * line is a cup of coffee somebody is waiting for.
 */

import { AppError } from '../core/utils.js';
import { ONLINE_ORDER_STATUS, TABLE_STATUS } from '../config/app.config.js';
import { getItemByCode, getMenu } from '../repositories/menu.repo.js';
import * as tablesRepo from '../repositories/tables.repo.js';
import * as ordersRepo from '../repositories/onlineOrders.repo.js';
import * as customersRepo from '../repositories/customers.repo.js';
import * as cart from './cart.service.js';
import { decodeHandoff, announceStatus, deviceId } from './orderChannel.service.js';

/**
 * Match one ordered line to something on this device's menu.
 * Falls back to an exact name match, which rescues an item whose category was
 * renamed since the customer's menu was published.
 */
function resolveLine(line) {
  const byCode = getItemByCode(line.code);
  if (byCode) return byCode;

  if (line.name) {
    const target = String(line.name).trim().toLowerCase();
    return getMenu().find((item) => item.name.trim().toLowerCase() === target) || null;
  }
  return null;
}

/**
 * @param {{code:string, name?:string, quantity:number, note?:string}[]} lines
 * @returns {{resolved:Array, unknown:Array, unavailable:Array}}
 */
export function resolveLines(lines) {
  const resolved = [];
  const unknown = [];
  const unavailable = [];

  for (const line of lines) {
    const item = resolveLine(line);
    if (!item) {
      unknown.push({ code: line.code, name: line.name || line.code, quantity: line.quantity });
      continue;
    }
    if (!item.available) {
      unavailable.push({ code: line.code, name: item.name, quantity: line.quantity });
      continue;
    }
    resolved.push({
      itemId: item.id,
      code: item.code,
      name: item.name,
      category: item.category,
      unitPrice: item.price, // the counter's price, not the customer's
      quantity: line.quantity,
      taxRate: item.taxRate ?? null,
      note: line.note || '',
    });
  }

  return { resolved, unknown, unavailable };
}

/**
 * Load an order from the queue onto the counter, ready to take payment.
 *
 * @param {object} order  an online order record
 * @returns {Promise<{cart:object, unknown:Array, unavailable:Array, table:object|null}>}
 */
export async function loadOrderIntoCart(order) {
  if (!order) throw new AppError('That order is no longer in the queue.', 'NOT_FOUND');
  if (order.status === ONLINE_ORDER_STATUS.BILLED) {
    throw new AppError(`Order ${order.code} has already been billed.`, 'ALREADY_BILLED');
  }

  const { resolved, unknown, unavailable } = resolveLines(order.lines);
  if (!resolved.length) {
    throw new AppError(
      'None of the items on that order are on this menu. Take it at the counter instead.',
      'NOTHING_TO_BILL'
    );
  }

  const table = order.tableId
    ? tablesRepo.getTable(order.tableId)
    : await tablesRepo.findByToken(order.tableToken);

  const loaded = cart.loadOnlineOrder({ ...order, lines: resolved }, table);
  if (table) await tablesRepo.setStatus(table.id, TABLE_STATUS.ORDERED);

  // A customer who gave their number on their phone is asking to be counted.
  // Look them up, and add them to the book if this is their first time, so the
  // visit lands on a record rather than on nothing.
  const customer = await attachCustomer(order);

  return { cart: loaded, unknown, unavailable, table, customer };
}

/**
 * Put the customer behind this order on the counter with it.
 *
 * Fails soft in every direction: an order must always reach the till, whatever
 * happens to the phone number attached to it.
 */
async function attachCustomer(order) {
  const phone = String(order.customerPhone || '');
  if (order.customerId) {
    const known = customersRepo.getCustomer(order.customerId);
    if (known) {
      cart.setCustomer(known);
      return known;
    }
  }
  if (!customersRepo.isValidPhone(phone)) return null;

  try {
    const existing = await customersRepo.findByPhone(phone);
    const customer =
      existing || (await customersRepo.saveCustomer({ phone, name: order.customerName || '' }));
    cart.setCustomer(customer);
    return customer;
  } catch (error) {
    console.error('[TBC POS] could not attach the customer to this order', error);
    return null;
  }
}

/**
 * Accept an order and put it on the counter in one step — the normal action
 * when a member of staff looks at the queue and says "yes, make that".
 */
export async function acceptAndLoad(orderId) {
  const accepted = await ordersRepo.acceptOrder(orderId);
  await announceStatus(accepted);
  const result = await loadOrderIntoCart(accepted);
  return { order: accepted, ...result };
}

/**
 * Bring an order that is already being made back to the counter to be paid for.
 *
 * Nothing about its state changes: it is on the board as ready or served, and
 * it stays that way until a bill exists for it.
 */
export async function recallOrder(orderId) {
  const order = await ordersRepo.getOrder(orderId);
  if (!order) throw new AppError('That order is no longer in the queue.', 'NOT_FOUND');
  const result = await loadOrderIntoCart(order);
  return { order, ...result };
}

export async function rejectAndAnnounce(orderId, reason) {
  const rejected = await ordersRepo.rejectOrder(orderId, reason);
  await announceStatus(rejected);
  return rejected;
}

/**
 * Take an order in from a handoff code — scanned off a customer's phone or
 * typed in. The order joins the queue as a normal record first, so it shows up
 * in the day's list like any other, and is then loaded onto the counter.
 */
export async function importHandoff(text) {
  const decoded = decodeHandoff(text);
  const { resolved, unknown, unavailable } = resolveLines(decoded.lines);

  if (!resolved.length) {
    throw new AppError(
      'None of the items in that code are on this menu. Check the menu is up to date.',
      'NOTHING_TO_BILL'
    );
  }

  const table = await tablesRepo.findByToken(decoded.tableToken);

  // A code can be handed over twice — the customer shows it again, or a second
  // cashier scans it. Reuse the existing order rather than duplicating it.
  const existing = decoded.code ? await ordersRepo.findByCode(decoded.code) : null;
  if (existing) {
    if (existing.status === ONLINE_ORDER_STATUS.BILLED) {
      throw new AppError(`Order ${existing.code} has already been billed.`, 'ALREADY_BILLED');
    }
    const result = await loadOrderIntoCart(existing);
    return { order: existing, reused: true, ...result };
  }

  const order = await ordersRepo.placeOrder({
    code: decoded.code || undefined,
    tableId: table?.id || '',
    tableToken: decoded.tableToken,
    tableName: table?.name || '',
    lines: resolved,
    customerName: decoded.customerName,
    note: decoded.note,
    deviceId: deviceId(),
  });

  const accepted = await ordersRepo.acceptOrder(order.id);
  const result = await loadOrderIntoCart(accepted);

  return { order: accepted, reused: false, ...result, unknown, unavailable };
}
