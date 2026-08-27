/**
 * The pricing engine. Pure functions, integer paise, no side effects.
 *
 * Order of operations (this is what an Indian cafe bill expects):
 *   1. line total   = unit price x quantity
 *   2. subtotal     = sum of line totals
 *   3. reward       = one item made free, taken off its own line. A loyalty
 *                     treat comes off before any discount, so a customer never
 *                     ends up paying a discounted price for something they were
 *                     told was free
 *   4. discount     = percent or flat, applied to what is left, then spread
 *                     across the lines in proportion so tax lands correctly
 *   5. tax          = per line on the discounted amount, at that item's own
 *                     rate (or the cafe default)
 *   6. round-off    = optional, to the nearest rupee, recorded separately
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
 * @param {{lineId?:string, itemId?:string, amount:number, label?:string}|null} reward
 *   a single item given free; see loyalty.service.js
 */
export function priceOrder(
  lines,
  settings,
  discount = { type: 'PERCENT', value: 0 },
  reward = null
) {
  const priced = lines.map((line) => ({
    ...line,
    lineTotal: Math.round(line.unitPrice * line.quantity),
  }));

  const subtotal = priced.reduce((total, line) => total + line.lineTotal, 0);

  // ---- reward ------------------------------------------------------------
  // The free item comes off the line it belongs to, never off the order as a
  // whole, so the tax on the rest of that line stays right.
  const rewardIndex = reward
    ? priced.findIndex((line) =>
        reward.lineId ? line.lineId === reward.lineId : line.itemId === reward.itemId
      )
    : -1;
  const rewardShares = priced.map(() => 0);
  let rewardAmount = 0;

  if (reward && rewardIndex >= 0) {
    const target = priced[rewardIndex];
    rewardAmount = Math.min(
      Math.max(0, Math.round(Number(reward.amount) || 0)),
      target.lineTotal
    );
    rewardShares[rewardIndex] = rewardAmount;
  }

  // ---- discount ----------------------------------------------------------
  // What a discount may be taken from: the order minus anything already free.
  const discountable = subtotal - rewardAmount;

  let discountAmount = 0;
  if (settings.discountEnabled && discount && discount.value > 0 && discountable > 0) {
    if (discount.type === 'FLAT') {
      discountAmount = Math.min(Math.round(discount.value), discountable);
    } else {
      const capped = Math.min(
        Number(discount.value) || 0,
        (Number(settings.maxDiscountPercent) || 100) * 100
      );
      discountAmount = Math.min(applyRate(discountable, capped), discountable);
    }
  }
  const shares = distribute(
    discountAmount,
    priced.map((line, index) => line.lineTotal - rewardShares[index])
  );

  // ---- tax ---------------------------------------------------------------
  const inclusive = Boolean(settings.taxEnabled && settings.priceIncludesTax);
  const items = priced.map((line, index) => {
    const lineReward = rewardShares[index];
    const lineDiscount = shares[index];
    const net = line.lineTotal - lineReward - lineDiscount;
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
      rewardAmount: lineReward,
      discountAmount: lineDiscount,
      taxableAmount: taxable,
      taxAmount,
      total: inclusive ? net : net + taxAmount,
    };
  });

  const taxAmount = items.reduce((total, line) => total + line.taxAmount, 0);

  // ---- totals ------------------------------------------------------------
  const beforeRounding = inclusive
    ? subtotal - rewardAmount - discountAmount
    : subtotal - rewardAmount - discountAmount + taxAmount;

  let roundOff = 0;
  let grandTotal = beforeRounding;
  if (settings.roundOffEnabled) {
    grandTotal = roundToRupee(beforeRounding);
    roundOff = grandTotal - beforeRounding;
  }

  return {
    items,
    subtotal,
    rewardAmount,
    rewardLabel: rewardAmount ? reward?.label || 'Reward' : '',
    rewardKind: rewardAmount ? reward?.kind || '' : '',
    rewardItemName: rewardAmount ? priced[rewardIndex]?.name || '' : '',
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
