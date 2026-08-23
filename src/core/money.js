/**
 * Money handling.
 *
 * Every amount in this application is an INTEGER NUMBER OF PAISE. Nothing is
 * ever stored or added as a floating-point rupee value, because 0.1 + 0.2 is
 * not 0.3 and a till that drifts by a paisa a day is a till nobody trusts.
 * Convert at the edges (input parsing / display) and stay integral in between.
 */

/** Parse a user-entered rupee amount into paise. Returns null if unusable. */
export function parseRupeesToPaise(input) {
  if (input === null || input === undefined) return null;
  const text = String(input).trim().replace(/[₹,\s]/g, '');
  if (text === '') return null;
  if (!/^\d*(\.\d{0,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const paise = Number(whole || '0') * 100 + Number((fraction + '00').slice(0, 2));
  if (!Number.isSafeInteger(paise)) return null;
  return paise;
}

/** Convert whole/decimal rupees (a trusted number, e.g. seed data) to paise. */
export function rupeesToPaise(rupees) {
  return Math.round(Number(rupees) * 100);
}

export function paiseToRupees(paise) {
  return Math.round(paise) / 100;
}

const INR = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "₹1,234.50" — symbol comes from settings so a different currency still works. */
export function formatMoney(paise, symbol = '₹') {
  const value = Math.round(Number(paise) || 0);
  const sign = value < 0 ? '-' : '';
  return `${sign}${symbol}${INR.format(Math.abs(value) / 100)}`;
}

/** "1,234.50" with no symbol — for tables and inputs. */
export function formatAmount(paise) {
  return INR.format((Math.round(Number(paise) || 0)) / 100);
}

/** Percentage stored as basis points: 500 -> "5%", 250 -> "2.5%". */
export function formatRate(basisPoints) {
  const percent = (Number(basisPoints) || 0) / 100;
  return `${Number(percent.toFixed(2))}%`;
}

export function parsePercentToBasisPoints(input) {
  const value = Number(String(input).trim());
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return Math.round(value * 100);
}

/** Apply a basis-point rate to a paise amount, rounding half-up. */
export function applyRate(paise, basisPoints) {
  return Math.round((paise * basisPoints) / 10000);
}

/**
 * Split `total` paise across `weights` so the parts sum EXACTLY to `total`.
 * Used to spread an order-level discount over lines without losing a paisa.
 */
export function distribute(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total === 0) return weights.map(() => 0);

  const parts = weights.map((w) => Math.floor((total * w) / sum));
  let remainder = total - parts.reduce((a, b) => a + b, 0);

  // Hand out the leftover paise to the largest lines first — deterministic and
  // matches what a human would do when splitting a bill.
  const order = weights
    .map((w, i) => ({ i, w }))
    .sort((a, b) => b.w - a.w || a.i - b.i);

  let cursor = 0;
  while (remainder > 0 && order.length) {
    parts[order[cursor % order.length].i] += 1;
    remainder -= 1;
    cursor += 1;
  }
  return parts;
}

/** Round a paise amount to the nearest whole rupee (for cash round-off). */
export function roundToRupee(paise) {
  return Math.round(paise / 100) * 100;
}
