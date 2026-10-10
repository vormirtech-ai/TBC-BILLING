/**
 * Money is held as whole paise (integers) everywhere in this app, and only ever
 * becomes a decimal string at the moment it is drawn on screen or on paper.
 *
 * This is not pedantry. A bill that adds 0.1 + 0.2 in floating point and then
 * rounds at the end can disagree with the printed line items by a rupee, and a
 * guest who spots that stops trusting the whole system.
 */

/** 1250.5 (rupees) -> 125050 (paise). */
export const toPaise = (rupees) => Math.round(Number(rupees || 0) * 100);

/** 125050 -> 1250.5 */
export const toRupees = (paise) => Math.round(paise || 0) / 100;

/** Percentage in basis points: pct(50000, 1000) === 5000 (10% of ₹500). */
export const pct = (paise, bps) => Math.round((paise * bps) / 10000);

/** Sum with no float drift. */
export const sum = (values) => values.reduce((total, v) => total + (v || 0), 0);

/** Nearest whole rupee, and how far it moved. Used for the round-off line. */
export function roundToRupee(paise) {
  const rounded = Math.round(paise / 100) * 100;
  return { rounded, delta: rounded - paise };
}

/**
 * Split `paise` into `parts` shares that add back to exactly `paise`. The
 * remainder is spread one paisa at a time over the earliest shares rather than
 * dumped on the last one, so an equal split of ₹100 across 3 guests reads
 * 33.34 / 33.33 / 33.33 and never 33.33 / 33.33 / 33.34.
 */
export function splitEvenly(paise, parts) {
  if (parts < 1) return [];
  const base = Math.floor(paise / parts);
  const remainder = paise - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

let formatter = null;
function numberFormat(locale) {
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat(locale, {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
      });
    } catch {
      formatter = { format: (n) => Number(n).toFixed(2) };
    }
  }
  return formatter;
}

/** 125050 -> "1,250.50" (no symbol; callers place the symbol themselves). */
export function amount(paise, locale = 'en-IN') {
  const value = toRupees(Math.abs(paise || 0));
  return (paise < 0 ? '-' : '') + numberFormat(locale).format(value);
}

/** 125050 -> "₹1,250.50" */
export const money = (paise, symbol = '₹', locale = 'en-IN') =>
  `${paise < 0 ? '-' : ''}${symbol}${amount(Math.abs(paise || 0), locale)}`;

/**
 * Whole rupees, grouped: 1310594 -> "₹13,106". Dashboard tiles use this — two
 * decimal places on a six-figure number is noise, and the paise belong on a
 * bill where somebody is going to hand over the money.
 */
export function money0(paise, symbol = '₹', locale = 'en-IN') {
  const rupees = Math.round((paise || 0) / 100);
  let grouped;
  try {
    grouped = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.abs(rupees));
  } catch {
    grouped = String(Math.abs(rupees));
  }
  return `${rupees < 0 ? '-' : ''}${symbol}${grouped}`;
}

/** Compact form for dashboard tiles: 1284500 -> "₹12.8K". */
export function compactMoney(paise, symbol = '₹') {
  const rupees = toRupees(paise);
  if (Math.abs(rupees) >= 1e7) return `${symbol}${(rupees / 1e7).toFixed(2)}Cr`;
  if (Math.abs(rupees) >= 1e5) return `${symbol}${(rupees / 1e5).toFixed(2)}L`;
  if (Math.abs(rupees) >= 1000) return `${symbol}${(rupees / 1000).toFixed(1)}K`;
  return `${symbol}${Math.round(rupees)}`;
}
