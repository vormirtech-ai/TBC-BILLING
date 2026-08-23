/**
 * Stock quantities.
 *
 * Same discipline as money.js, for the same reason. A cappuccino takes 18 g of
 * coffee and 150 ml of milk; deduct that four hundred times a week in floating
 * point and the stock figure quietly drifts away from the shelf. So every
 * quantity in the app is an INTEGER NUMBER OF THOUSANDTHS of the item's own
 * unit — 250 g is 250000, 1.5 kg is 1500 — and conversion happens only at the
 * edges, where a human types or reads a number.
 */

/** How many integer steps make up one whole unit. */
export const QUANTITY_SCALE = 1000;

/** Parse a typed amount ("1.5", "250") into thousandths. Null if unusable. */
export function parseQuantity(input) {
  if (input === null || input === undefined) return null;
  const text = String(input).trim().replace(/,/g, '');
  if (text === '') return null;
  if (!/^\d*(\.\d{0,3})?$/.test(text)) return null;

  const [whole, fraction = ''] = text.split('.');
  const value = Number(whole || '0') * QUANTITY_SCALE + Number((fraction + '000').slice(0, 3));
  if (!Number.isSafeInteger(value)) return null;
  return value;
}

/** The same, but allowing a leading minus — used for stock corrections. */
export function parseSignedQuantity(input) {
  const text = String(input ?? '').trim();
  if (text.startsWith('-')) {
    const magnitude = parseQuantity(text.slice(1));
    return magnitude === null ? null : -magnitude;
  }
  return parseQuantity(text);
}

/** Convert a trusted decimal number (seed data, imports) to thousandths. */
export function toQuantity(value) {
  return Math.round(Number(value) * QUANTITY_SCALE);
}

export function quantityToNumber(quantity) {
  return Math.round(Number(quantity) || 0) / QUANTITY_SCALE;
}

/** "1.5", "250", "0.75" — trailing zeros trimmed so the shelf reads naturally. */
export function formatQuantity(quantity) {
  const value = quantityToNumber(quantity);
  const text = value.toFixed(3);
  return text.replace(/\.?0+$/, '') || '0';
}

/** "250 g", "1.5 kg" — the form used in tables and on stock cards. */
export function formatQuantityWithUnit(quantity, unit) {
  return `${formatQuantity(quantity)} ${unit || ''}`.trim();
}

/**
 * Ingredient used by `quantity` sold portions.
 * Kept integral: multiply first, and never divide.
 */
export function multiplyQuantity(perPortion, portions) {
  return Math.round(Number(perPortion) || 0) * Math.round(Number(portions) || 0);
}
