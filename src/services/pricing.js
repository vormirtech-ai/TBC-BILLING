/**
 * The pricing engine. Pure functions, integer paise, no side effects.
 *
 * Order of operations (this is what an Indian cafe bill expects):
 *   1. line total   = unit price x quantity
 *   2. subtotal     = sum of line totals
 *   3. discount     = percent or flat, applied to the subtotal, then spread
 *                     across the lines in proportion so tax lands correctly
 *   4. tax          = per line on the discounted amount, at that item's own
 *                     rate (or the cafe default)
 *   5. round-off    = optional, to the nearest rupee, recorded separately
 *
 * Every amount that comes out of here is an integer, and the parts always add
 * up to the grand total exactly.
 */

import { applyRate, distribute, roundToRupee } from '../core/money.js';

export function effectiveTaxRate(line, settings) {
  if (!settings.taxEnabled) return 0;
  const own = line.taxRate;
  if (own === null || own === undefined || own === '') return Number(settings.defaultTaxRate) || 0;
  return Number(own) || 0;
}

/**
 * @param {{unitPrice:number, quantity:number, taxRate:number|null}[]} lines
 * @param {object} settings
 * @param {{type:'PERCENT'|'FLAT', value:number}} discount  value = basis points for PERCENT, paise for FLAT
 */
export function priceOrder(lines, settings, discount = { type: 'PERCENT', value: 0 }) {
  const priced = lines.map((line) => ({
    ...line,
    lineTotal: Math.round(line.unitPrice * line.quantity),
  }));

  const subtotal = priced.reduce((total, line) => total + line.lineTotal, 0);

  // ---- discount ----------------------------------------------------------
  let discountAmount = 0;
  if (settings.discountEnabled && discount && discount.value > 0 && subtotal > 0) {
    if (discount.type === 'FLAT') {
      discountAmount = Math.min(Math.round(discount.value), subtotal);
    } else {
      const capped = Math.min(
        Number(discount.value) || 0,
        (Number(settings.maxDiscountPercent) || 100) * 100
      );
      discountAmount = Math.min(applyRate(subtotal, capped), subtotal);
    }
  }
  const shares = distribute(
    discountAmount,
    priced.map((line) => line.lineTotal)
  );

  // ---- tax ---------------------------------------------------------------
  const inclusive = Boolean(settings.taxEnabled && settings.priceIncludesTax);
  const items = priced.map((line, index) => {
    const lineDiscount = shares[index];
    const net = line.lineTotal - lineDiscount;
    const rate = effectiveTaxRate(line, settings);

    let taxAmount = 0;
    let taxable = net;
    if (rate > 0) {
      if (inclusive) {
        taxable = Math.round((net * 10000) / (10000 + rate));
        taxAmount = net - taxable;
      } else {
        taxAmount = applyRate(net, rate);
      }
    }

    return {
      ...line,
      taxRate: rate,
      discountAmount: lineDiscount,
      taxableAmount: taxable,
      taxAmount,
      total: inclusive ? net : net + taxAmount,
    };
  });

  const taxAmount = items.reduce((total, line) => total + line.taxAmount, 0);

  // ---- totals ------------------------------------------------------------
  const beforeRounding = inclusive
    ? subtotal - discountAmount
    : subtotal - discountAmount + taxAmount;

  let roundOff = 0;
  let grandTotal = beforeRounding;
  if (settings.roundOffEnabled) {
    grandTotal = roundToRupee(beforeRounding);
    roundOff = grandTotal - beforeRounding;
  }

  return {
    items,
    subtotal,
    discountType: discount?.type || 'PERCENT',
    discountValue: Number(discount?.value) || 0,
    discountAmount,
    taxLabel: settings.taxLabel || 'Tax',
    taxInclusive: inclusive,
    taxableAmount: items.reduce((total, line) => total + line.taxableAmount, 0),
    taxAmount,
    roundOff,
    grandTotal,
    itemCount: items.reduce((total, line) => total + line.quantity, 0),
    lineCount: items.length,
  };
}
