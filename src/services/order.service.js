/**
 * Turning an open cart into a permanent sale.
 *
 * A saved transaction is a SNAPSHOT. Item names, categories, unit prices, tax
 * rates and totals are copied into the record at the moment of payment. Nothing
 * in the app ever re-reads today's menu to redisplay yesterday's bill, so a
 * price change tomorrow leaves every past bill exactly as it was rung up.
 */

import { PAYMENT_METHODS } from '../config/app.config.js';
import { AppError, businessDateKey, uid } from '../core/utils.js';
import { requireSignedIn } from '../core/session.js';
import { getSettings } from '../repositories/settings.repo.js';
import { commitTransaction } from '../repositories/transactions.repo.js';
import * as cart from './cart.service.js';

export function isValidPaymentMethod(method) {
  return PAYMENT_METHODS.some((entry) => entry.id === method);
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
    note: priced.note || '',

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
      taxableAmount: line.taxableAmount,
      taxAmount: line.taxAmount,
      total: line.total,
      note: line.note || '',
    })),
    subtotal: priced.subtotal,
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
  });

  // Only clear the counter once the sale is durably committed.
  cart.clearCart();
  return saved;
}
