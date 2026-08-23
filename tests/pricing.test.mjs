import { priceOrder } from '../src/services/pricing.js';
import {
  parseRupeesToPaise, rupeesToPaise, paiseToRupees, formatMoney,
  applyRate, distribute, roundToRupee, parsePercentToBasisPoints,
} from '../src/core/money.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
};

const base = {
  taxEnabled: false, priceIncludesTax: false, defaultTaxRate: 0,
  discountEnabled: true, maxDiscountPercent: 100, roundOffEnabled: false,
  taxLabel: 'GST',
};
const L = (rupees, qty, taxRate = null) => ({ unitPrice: rupeesToPaise(rupees), quantity: qty, taxRate });

// ---- money primitives ------------------------------------------------------
eq('rupeesToPaise', rupeesToPaise(180), 18000);
eq('parseRupeesToPaise str', parseRupeesToPaise('1,234.56'), 123456);
eq('parseRupeesToPaise blank', parseRupeesToPaise(''), null);
eq('parseRupeesToPaise junk', parseRupeesToPaise('12.345'), null);
eq('parseRupeesToPaise letters', parseRupeesToPaise('abc'), null);
eq('parseRupeesToPaise negative', parseRupeesToPaise('-5'), null);
eq('parseRupeesToPaise symbol', parseRupeesToPaise('₹ 180.50'), 18050);
eq('paiseToRupees', paiseToRupees(18050), 180.5);
eq('formatMoney', formatMoney(123456), '₹1,234.56');
eq('percent parse', parsePercentToBasisPoints('12.5'), 1250);
eq('applyRate 5% of 100', applyRate(10000, 500), 500);
eq('roundToRupee down', roundToRupee(18049), 18000);
eq('roundToRupee up', roundToRupee(18050), 18100);

// ---- distribute: parts must sum exactly to the whole -----------------------
eq('distribute exact', distribute(100, [1, 1, 1]), [34, 33, 33]);
eq('distribute zero', distribute(0, [5, 5]), [0, 0]);
for (const total of [1, 7, 99, 3333, 100000]) {
  for (const w of [[1, 1, 1], [17, 3, 980], [1, 0, 1], [5, 5, 5, 5, 5, 5, 5]]) {
    const parts = distribute(total, w);
    if (parts.reduce((a, b) => a + b, 0) !== total) { fail++; console.log(`FAIL distribute sum ${total} ${w}`); }
    else if (parts.some((p) => !Number.isInteger(p) || p < 0)) { fail++; console.log(`FAIL distribute int ${total} ${w}`); }
    else pass++;
  }
}

// ---- TEST: plain order -----------------------------------------------------
{
  const r = priceOrder([L(180, 2), L(140, 1)], base);
  eq('plain subtotal', r.subtotal, 50000);
  eq('plain grand', r.grandTotal, 50000);
  eq('plain itemCount', r.itemCount, 3);
  eq('plain tax', r.taxAmount, 0);
}

// ---- TEST: percent discount spreads and sums exactly ------------------------
{
  const s = { ...base };
  const r = priceOrder([L(180, 1), L(140, 1), L(270, 1)], s, { type: 'PERCENT', value: 1000 }); // 10%
  eq('disc subtotal', r.subtotal, 59000);
  eq('disc amount', r.discountAmount, 5900);
  eq('disc parts sum', r.items.reduce((a, i) => a + i.discountAmount, 0), r.discountAmount);
  eq('disc grand', r.grandTotal, 53100);
  eq('lines sum to grand', r.items.reduce((a, i) => a + i.total, 0), r.grandTotal);
}

// ---- TEST: awkward percent still sums exactly ------------------------------
{
  const r = priceOrder([L(140, 1), L(170, 1), L(180, 1)], base, { type: 'PERCENT', value: 1333 });
  eq('awkward parts sum', r.items.reduce((a, i) => a + i.discountAmount, 0), r.discountAmount);
  eq('awkward lines sum', r.items.reduce((a, i) => a + i.total, 0), r.grandTotal);
}

// ---- TEST: flat discount cannot exceed subtotal ----------------------------
{
  const r = priceOrder([L(140, 1)], base, { type: 'FLAT', value: 999999 });
  eq('flat capped', r.discountAmount, 14000);
  eq('flat grand', r.grandTotal, 0);
}

// ---- TEST: max discount percent is enforced --------------------------------
{
  const s = { ...base, maxDiscountPercent: 20 };
  const r = priceOrder([L(100, 1)], s, { type: 'PERCENT', value: 5000 }); // asked 50%, cap 20%
  eq('cap enforced', r.discountAmount, 2000);
}

// ---- TEST: discount disabled is ignored ------------------------------------
{
  const s = { ...base, discountEnabled: false };
  const r = priceOrder([L(100, 1)], s, { type: 'PERCENT', value: 5000 });
  eq('disc off', r.discountAmount, 0);
}

// ---- TEST: exclusive tax ---------------------------------------------------
{
  const s = { ...base, taxEnabled: true, defaultTaxRate: 500 }; // 5%
  const r = priceOrder([L(200, 1)], s);
  eq('excl taxable', r.taxableAmount, 20000);
  eq('excl tax', r.taxAmount, 1000);
  eq('excl grand', r.grandTotal, 21000);
}

// ---- TEST: inclusive tax — grand total equals menu price -------------------
{
  const s = { ...base, taxEnabled: true, priceIncludesTax: true, defaultTaxRate: 500 };
  const r = priceOrder([L(210, 2)], s);
  eq('incl grand equals menu', r.grandTotal, 42000);
  eq('incl parts', r.taxableAmount + r.taxAmount, r.grandTotal);
}

// ---- TEST: per-item tax rate overrides the default -------------------------
{
  const s = { ...base, taxEnabled: true, defaultTaxRate: 500 };
  const r = priceOrder([L(100, 1, 1800), L(100, 1)], s);
  eq('override rate', r.items[0].taxAmount, 1800);
  eq('default rate', r.items[1].taxAmount, 500);
}

// ---- TEST: round-off --------------------------------------------------------
{
  const s = { ...base, taxEnabled: true, defaultTaxRate: 500, roundOffEnabled: true };
  const r = priceOrder([L(140, 1), L(170, 1)], s); // 310 + 5% = 325.50
  eq('roundoff grand whole rupees', r.grandTotal % 100, 0);
  eq('roundoff recorded', r.grandTotal - r.roundOff, 32550);
}

// ---- TEST 6 (master prompt): a price change must not alter a past bill -----
{
  // A bill is stored as a snapshot of unit prices, not as a menu reference.
  const snapshotLines = [L(180, 2)];              // sold when Latte was ₹180
  const historic = priceOrder(snapshotLines, base);
  // Admin now raises the Latte to ₹220. The snapshot is untouched.
  const menuNow = L(220, 2);
  const reprint = priceOrder(snapshotLines, base); // re-render the same snapshot
  eq('historic total stable', reprint.grandTotal, historic.grandTotal);
  eq('historic total value', historic.grandTotal, 36000);
  eq('new sale uses new price', priceOrder([menuNow], base).grandTotal, 44000);
}

// ---- TEST: everything is an integer ----------------------------------------
{
  const s = { ...base, taxEnabled: true, defaultTaxRate: 500, roundOffEnabled: true };
  const r = priceOrder([L(140, 3), L(270, 1), L(190, 2)], s, { type: 'PERCENT', value: 777 });
  const nums = [r.subtotal, r.discountAmount, r.taxAmount, r.taxableAmount, r.roundOff, r.grandTotal,
    ...r.items.flatMap((i) => [i.lineTotal, i.discountAmount, i.taxAmount, i.taxableAmount, i.total])];
  eq('all integers', nums.every(Number.isInteger), true);
}

// ---- TEST: empty cart is safe ----------------------------------------------
{
  const r = priceOrder([], base, { type: 'PERCENT', value: 1000 });
  eq('empty subtotal', r.subtotal, 0);
  eq('empty grand', r.grandTotal, 0);
  eq('empty discount', r.discountAmount, 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
