/**
 * Turning an open cart into a permanent sale.
 *
 * A saved transaction is a SNAPSHOT. Item names, categories, unit prices, tax
 * rates and totals are copied into the record at the moment of payment. Nothing
 * in the app ever re-reads today's menu to redisplay yesterday's bill, so a
 * price change tomorrow leaves every past bill exactly as it was rung up.
 */

import { PAYMENT_METHODS, ORDER_SOURCES, TABLE_STATUS } from '../config/app.config.js';
import { AppError, businessDateKey, uid } from '../core/utils.js';
import { requireSignedIn } from '../core/session.js';
import { getSettings } from '../repositories/settings.repo.js';
import { commitTransaction } from '../repositories/transactions.repo.js';
import * as ordersRepo from '../repositories/onlineOrders.repo.js';
import * as tablesRepo from '../repositories/tables.repo.js';
import * as inventoryRepo from '../repositories/inventory.repo.js';
import * as customersRepo from '../repositories/customers.repo.js';
import { announceStatus } from './orderChannel.service.js';
import { nextOrderNumber, isCloudEnabled } from './cloudSync.service.js';
import * as cart from './cart.service.js';

export function isValidPaymentMethod(method) {
  return PAYMENT_METHODS.some((entry) => entry.id === method);
}

/**
 * Send what is on the counter to the kitchen and hand the till back empty.
 *
 * This is the other half of order management: an order does not have to be
 * paid for the moment it is taken. It goes on the board, the next customer gets
 * served, and it comes back to the counter when the table asks for the bill.
 *
 * An order recalled from the board and changed is updated in place rather than
 * duplicated — the board must never show the same coffee twice.
 *
 * @returns {Promise<object>} the saved order
 */
export async function sendToKitchen() {
  requireSignedIn();
  const priced = cart.getCart();

  if (!priced.lines.length) {
    throw new AppError('Add something to the order before sending it to the kitchen.', 'EMPTY_CART');
  }

  const draft = {
    lines: priced.lines.map((line) => ({
      itemId: line.itemId,
      code: line.itemId,
      name: line.name,
      category: line.category || '',
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      note: line.note || '',
    })),
    tableId: priced.tableId || '',
    tableName: priced.tableName || '',
    customerName: priced.customerName || '',
    customerId: priced.customerId || '',
    customerPhone: priced.customerPhone || '',
    note: priced.note || '',
  };

  const order = priced.onlineOrderId
    ? await ordersRepo.updateOrder(priced.onlineOrderId, draft)
    : await ordersRepo.createCounterOrder(draft);

  // A table with an order on it is not free, whatever it looked like before.
  if (order.tableId) {
    await tablesRepo.setStatus(order.tableId, TABLE_STATUS.ORDERED).catch(() => {});
  }

  cart.clearCart();
  return order;
}

/**
 * @param {{paymentMethod:string, amountTendered?:number|null}} payment
 * @returns {Promise<object>} the saved transaction
 */
export async function completeSale(payment) {
  const session = requireSignedIn();
  const settings = getSettings();
  const priced = cart.getCart();

  if (!priced.lines.length) {
    throw new AppError('The order is empty. Add an item before taking payment.', 'EMPTY_CART');
  }
  if (!isValidPaymentMethod(payment.paymentMethod)) {
    throw new AppError('Choose how the customer is paying.', 'VALIDATION');
  }
  if (
    payment.paymentMethod === 'CASH' &&
    payment.amountTendered !== null &&
    payment.amountTendered !== undefined &&
    payment.amountTendered < priced.grandTotal
  ) {
    throw new AppError('Cash received is less than the bill total.', 'SHORT_PAYMENT');
  }

  const now = new Date();
  const draft = {
    id: uid('txn'),
    createdAt: now.toISOString(),
    businessDate: businessDateKey(now, settings.dayRolloverHour),

    cashier: session.username,
    cashierName: session.displayName || session.username,
    paymentMethod: payment.paymentMethod,
    amountTendered:
      payment.paymentMethod === 'CASH' && Number.isInteger(payment.amountTendered)
        ? payment.amountTendered
        : null,
    changeDue:
      payment.paymentMethod === 'CASH' && Number.isInteger(payment.amountTendered)
        ? Math.max(0, payment.amountTendered - priced.grandTotal)
        : null,

    customerName: priced.customerName || '',
    // The regular this bill belongs to, when one was looked up at the counter.
    customerId: priced.customerId || '',
    customerPhone: priced.customerPhone || '',
    note: priced.note || '',

    // Where the order came from, and which table it belongs to. Both are copied
    // into the bill so a month-old receipt still says where it was served.
    tableId: priced.tableId || '',
    tableName: priced.tableName || '',
    orderSource: priced.source || ORDER_SOURCES.COUNTER,
    onlineOrderId: priced.onlineOrderId || '',

    // --- the snapshot ---
    items: priced.lines.map((line) => ({
      itemId: line.itemId,
      name: line.name,
      category: line.category,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      lineTotal: line.lineTotal,
      discountAmount: line.discountAmount,
      taxRate: line.taxRate,
      rewardAmount: line.rewardAmount || 0,
      taxableAmount: line.taxableAmount,
      taxAmount: line.taxAmount,
      total: line.total,
      note: line.note || '',
    })),
    subtotal: priced.subtotal,
    // A loyalty treat, copied into the bill so a reprint still shows what was
    // given away and why.
    rewardAmount: priced.rewardAmount || 0,
    rewardLabel: priced.rewardLabel || '',
    rewardKind: priced.rewardKind || '',
    rewardItemName: priced.rewardItemName || '',
    discountType: priced.discountType,
    discountValue: priced.discountValue,
    discountAmount: priced.discountAmount,
    taxLabel: priced.taxLabel,
    taxInclusive: priced.taxInclusive,
    taxableAmount: priced.taxableAmount,
    taxAmount: priced.taxAmount,
    roundOff: priced.roundOff,
    grandTotal: priced.grandTotal,
    itemCount: priced.itemCount,
    currency: settings.currencySymbol || '₹',

    // Cafe details are copied too, so reprinting an old bill shows the details
    // that were on it at the time.
    cafeName: settings.cafeName,
    cafeAddress: settings.address,
    cafePhone: settings.phone,
    gstin: settings.gstin,
  };

  const saved = await commitTransaction(draft, {
    orderPrefix: settings.orderPrefix,
    orderNumberPadding: settings.orderNumberPadding,
    businessDayStartNumber: settings.businessDayStartNumber,
    trackStock: Boolean(settings.stockTrackingEnabled),
    // With a shared database, bill numbers come from it, so two tills billing
    // at the same moment cannot both decide they are on bill 42.
    sharedNumbering: isCloudEnabled(),
    allocateNumber: isCloudEnabled() ? nextOrderNumber : null,
  });

  // Everything below here is tidying up after a sale that is already safely
  // stored. None of it may throw: a bill that exists must not look like a
  // failure because a table could not be marked free.
  try {
    // The sale deducted stock inside its own transaction, straight to storage.
    // Re-read it so the cached levels the screens and the low-stock badge draw
    // from match the shelf.
    if (settings.stockTrackingEnabled) await inventoryRepo.loadInventory();

    if (draft.onlineOrderId) {
      const closed = await ordersRepo.markBilled(draft.onlineOrderId, saved);
      // Let the customer's phone know their order turned into a bill.
      if (closed) await announceStatus(closed);
    }
    if (draft.tableId) {
      await tablesRepo.setStatus(draft.tableId, TABLE_STATUS.FREE);
    }

    // Write the visit down. A voided bill leaves it standing on purpose: the
    // customer did come in, whatever happened to the paperwork afterwards.
    if (draft.customerId) {
      await customersRepo.recordVisit({
        id: draft.customerId,
        businessDate: draft.businessDate,
        amount: saved.grandTotal,
        billId: saved.id,
      });
      if (priced.reward?.kind && saved.rewardAmount > 0) {
        await customersRepo.markRewardClaimed(draft.customerId, {
          kind: priced.reward.kind,
          businessDate: draft.businessDate,
        });
      }
    }
  } catch (error) {
    console.error('[TBC POS] the sale was saved, but tidying up afterwards failed', error);
  }

  // Only clear the counter once the sale is durably committed.
  cart.clearCart();
  return saved;
}
