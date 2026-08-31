/**
 * Bill arithmetic. Pure functions over plain objects — no DOM, no store — so
 * every figure on this page is reproducible and testable (see tests/).
 *
 * The order of operations is the part that people get wrong, and it is the part
 * an auditor checks first:
 *
 *   gross            Σ (unit + modifiers) × qty, voids excluded
 *   − comps          lines the house is giving away, shown but not charged
 *   = net items
 *   − discount       bill-level, on net items only
 *   = discounted
 *   + service charge on the discounted amount
 *   = taxable
 *   + CGST + SGST    each on the taxable amount, never compounded on each other
 *   + tip            after tax; a tip is never taxed
 *   ± round-off      to the nearest rupee
 *   = total
 *
 * Every intermediate figure is whole paise, so the printed lines always add up
 * to the printed total.
 */

import { CHARGES } from '../config.js';
import { pct, roundToRupee, sum, splitEvenly } from '../core/money.js';

/** What one line actually costs, modifiers included. */
export function lineGross(line) {
  const unit = line.unitPaise + sum((line.modifiers || []).map((m) => m.deltaPaise || 0));
  return unit * line.qty;
}

/** Unit price with modifiers folded in — what the bill shows per item. */
export function lineUnit(line) {
  return line.unitPaise + sum((line.modifiers || []).map((m) => m.deltaPaise || 0));
}

export const isBillable = (line) => line.status !== 'VOID';

/**
 * Bill-level discount in paise. A percentage discount is taken on the net item
 * value; a flat discount is capped at it so a bill can never go negative.
 */
export function discountAmount(netItems, discount) {
  if (!discount || discount.mode === 'NONE' || !discount.value) return 0;
  if (discount.mode === 'PCT') {
    const capped = Math.min(Number(discount.value), CHARGES.maxDiscountPercent);
    return pct(netItems, Math.round(capped * 100));
  }
  return Math.min(Math.round(Number(discount.value) * 100), netItems);
}

/**
 * Cost the whole bill.
 *
 * @param {object} order
 * @param {object} [opts]
 * @param {string[]} [opts.lineIds] cost only these lines — used by split bills,
 *        where each share is a genuine bill in its own right and carries its own
 *        proportional service charge and tax.
 * @returns a totals object every screen and the printed bill share.
 */
export function costOrder(order, opts = {}) {
  const charges = order.charges || {};
  const pool = order.lines.filter(isBillable);
  const lines = opts.lineIds ? pool.filter((l) => opts.lineIds.includes(l.id)) : pool;

  const gross = sum(lines.map(lineGross));
  const comps = sum(lines.filter((l) => l.comp).map(lineGross));
  const netItems = gross - comps;

  // A split share carries the same proportion of the bill discount that it
  // carries of the items, so three shares of one discounted bill still add to
  // the one discounted total.
  const wholeNet = sum(pool.map(lineGross)) - sum(pool.filter((l) => l.comp).map(lineGross));
  const wholeDiscount = discountAmount(wholeNet, charges.discount);
  const discount = opts.lineIds && wholeNet > 0
    ? Math.round((wholeDiscount * netItems) / wholeNet)
    : wholeDiscount;

  const discounted = Math.max(0, netItems - discount);

  const serviceCharge = charges.serviceCharge === false
    ? 0
    : pct(discounted, CHARGES.serviceChargeBps);

  const taxable = discounted + serviceCharge;
  const taxes = CHARGES.taxComponents.map((component) => ({
    id: component.id,
    label: component.label,
    bps: component.bps,
    paise: pct(taxable, component.bps),
  }));
  const taxTotal = sum(taxes.map((t) => t.paise));

  const tip = opts.lineIds ? 0 : (charges.tipPaise || 0);
  const beforeRounding = taxable + taxTotal + tip;
  const { rounded, delta } = CHARGES.roundOffEnabled
    ? roundToRupee(beforeRounding)
    : { rounded: beforeRounding, delta: 0 };

  const paid = sum((order.payments || [])
    .filter((p) => !opts.lineIds || p.shareId === opts.shareId)
    .map((p) => p.paise));

  return {
    itemCount: sum(lines.map((l) => l.qty)),
    gross,
    comps,
    netItems,
    discount,
    discounted,
    serviceCharge,
    serviceChargeApplied: charges.serviceCharge !== false,
    taxable,
    taxes,
    taxTotal,
    tip,
    roundOff: delta,
    total: rounded,
    paid,
    balance: rounded - paid,
    lines,
  };
}

/* ---------------------------------------------------------------- splits --- */

/**
 * Split a bill into shares. Three ways, because guests ask for all three:
 *
 *  'EQUAL' — n ways down the middle. Only the money is split; the items stay
 *            on one list, because nobody wants "0.33 of a lamb shank" printed.
 *  'SEAT'  — one share per seat number, from the seat each item was ordered
 *            against. This is why seat numbering exists in the order screen.
 *  'ITEM'  — the captain assigns lines to shares by hand.
 */
export function buildSplit(order, mode, config = {}) {
  const lines = order.lines.filter(isBillable);

  if (mode === 'EQUAL') {
    const ways = Math.max(2, Number(config.ways) || 2);
    const totals = splitEvenly(costOrder(order).total, ways);
    return {
      mode,
      shares: totals.map((paise, i) => ({
        id: `s${i + 1}`,
        label: `Guest ${i + 1}`,
        lineIds: [],
        fixedTotal: paise,
      })),
    };
  }

  if (mode === 'SEAT') {
    const bySeat = new Map();
    for (const line of lines) {
      const seat = line.seat || 0;
      if (!bySeat.has(seat)) bySeat.set(seat, []);
      bySeat.get(seat).push(line.id);
    }
    const seats = [...bySeat.keys()].sort((a, b) => a - b);
    return {
      mode,
      shares: seats.map((seat) => ({
        id: `seat${seat}`,
        label: seat ? `Seat ${seat}` : 'Table (shared)',
        lineIds: bySeat.get(seat),
      })),
    };
  }

  // ITEM: start with everything on share 1 and let the captain drag lines off.
  const ways = Math.max(2, Number(config.ways) || 2);
  return {
    mode,
    shares: Array.from({ length: ways }, (_, i) => ({
      id: `s${i + 1}`,
      label: `Share ${i + 1}`,
      lineIds: i === 0 ? lines.map((l) => l.id) : [],
    })),
  };
}

/** Cost every share of a split, so the settle screen can show them side by side. */
export function costSplit(order, split) {
  return split.shares.map((share) => {
    if (share.fixedTotal != null) {
      const paid = sum((order.payments || [])
        .filter((p) => p.shareId === share.id).map((p) => p.paise));
      return {
        share,
        totals: { total: share.fixedTotal, paid, balance: share.fixedTotal - paid, lines: [] },
      };
    }
    return {
      share,
      totals: costOrder(order, { lineIds: share.lineIds, shareId: share.id }),
    };
  });
}
