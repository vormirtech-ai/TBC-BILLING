/**
 * Bill arithmetic.
 *
 * These are the figures a guest checks and an auditor asks about, so they are
 * asserted against hand-worked numbers rather than against whatever the code
 * happens to produce.
 */

import { test } from './run.mjs';
import { costOrder, discountAmount, buildSplit, costSplit, lineGross, lineUnit }
  from '../src/domain/pricing.js';
import { toPaise, splitEvenly, roundToRupee, pct } from '../src/core/money.js';

const line = (over = {}) => ({
  id: over.id || 'l1',
  itemId: 'x',
  name: 'Dish',
  course: over.course || 'MAIN',
  seat: over.seat ?? null,
  qty: over.qty ?? 1,
  unitPaise: over.unitPaise ?? 100000, // ₹1,000
  modifiers: over.modifiers || [],
  status: over.status || 'SERVED',
  comp: over.comp || false,
  compReason: '',
  notes: '',
});

const order = (lines, charges = {}) => ({
  id: 'o1',
  lines,
  payments: [],
  charges: {
    serviceCharge: true,
    discount: { mode: 'NONE', value: 0 },
    tipPaise: 0,
    ...charges,
  },
});

/* ------------------------------------------------------------- money --- */

test('paise conversion survives the values a menu actually uses', (t) => {
  t.equal(toPaise(1250.5), 125050);
  t.equal(toPaise('480'), 48000);
  t.equal(toPaise(0.1) + toPaise(0.2), toPaise(0.3), '0.1 + 0.2 is exact in paise');
});

test('an even split adds back to exactly what went in', (t) => {
  const parts = splitEvenly(10000, 3);
  t.deepEqual(parts, [3334, 3333, 3333]);
  t.equal(parts.reduce((a, b) => a + b, 0), 10000);

  for (const [total, ways] of [[100001, 7], [1, 3], [999999, 11], [0, 4]]) {
    const shares = splitEvenly(total, ways);
    t.equal(shares.reduce((a, b) => a + b, 0), total, `${total} over ${ways} ways`);
  }
});

test('round-off reports the direction it moved', (t) => {
  t.deepEqual(roundToRupee(125049), { rounded: 125000, delta: -49 });
  t.deepEqual(roundToRupee(125051), { rounded: 125100, delta: 49 });
  t.deepEqual(roundToRupee(125000), { rounded: 125000, delta: 0 });
});

/* -------------------------------------------------------------- bill --- */

test('a plain bill applies service charge, then tax, then rounds', (t) => {
  // Two dishes at ₹1,000 = ₹2,000
  //   service charge 10%      =   ₹200  -> ₹2,200
  //   CGST 2.5% + SGST 2.5%   =   ₹110  -> ₹2,310
  const totals = costOrder(order([line({ qty: 2 })]));
  t.equal(totals.gross, 200000);
  t.equal(totals.serviceCharge, 20000);
  t.equal(totals.taxable, 220000);
  t.equal(totals.taxes.length, 2);
  t.equal(totals.taxTotal, 11000);
  t.equal(totals.total, 231000);
  t.equal(totals.roundOff, 0);
});

test('modifiers are part of the unit price, not a separate line', (t) => {
  const withTruffle = line({
    modifiers: [{ id: 'truffle', label: 'Shaved truffle', deltaPaise: 65000 }],
    qty: 2,
  });
  t.equal(lineUnit(withTruffle), 165000);
  t.equal(lineGross(withTruffle), 330000);
});

test('tax is never charged on tax', (t) => {
  const totals = costOrder(order([line()]));
  // Both components are struck on the same taxable value, not compounded.
  const [cgst, sgst] = totals.taxes;
  t.equal(cgst.paise, sgst.paise);
  t.equal(cgst.paise, pct(totals.taxable, 250));
});

test('a comped dish is shown but not charged', (t) => {
  const totals = costOrder(order([line({ id: 'a' }), line({ id: 'b', comp: true })]));
  t.equal(totals.gross, 200000, 'both dishes still appear in the gross');
  t.equal(totals.comps, 100000);
  t.equal(totals.netItems, 100000, 'only one is charged for');
  t.equal(totals.serviceCharge, 10000, 'service charge follows the charged value');
});

test('a voided dish leaves the bill entirely', (t) => {
  const totals = costOrder(order([line({ id: 'a' }), line({ id: 'b', status: 'VOID' })]));
  t.equal(totals.gross, 100000);
  t.equal(totals.lines.length, 1);
});

test('a percentage discount comes off before service charge and tax', (t) => {
  // ₹2,000 less 10% = ₹1,800; service 10% = ₹180; tax 5% of ₹1,980 = ₹99
  const totals = costOrder(order([line({ qty: 2 })], {
    discount: { mode: 'PCT', value: 10 },
  }));
  t.equal(totals.discount, 20000);
  t.equal(totals.discounted, 180000);
  t.equal(totals.serviceCharge, 18000);
  t.equal(totals.taxTotal, 9900);
  t.equal(totals.total, 207900);
});

test('a flat discount can never take a bill below zero', (t) => {
  const totals = costOrder(order([line()], { discount: { mode: 'FLAT', value: 99999 } }));
  t.equal(totals.discount, 100000, 'capped at the value of the food');
  t.equal(totals.discounted, 0);
  t.equal(totals.total, 0);
});

test('removing the service charge removes it from the tax base too', (t) => {
  const totals = costOrder(order([line()], { serviceCharge: false }));
  t.equal(totals.serviceCharge, 0);
  t.equal(totals.taxable, 100000);
  t.equal(totals.taxTotal, 5000);
});

test('a tip is added after tax and is never taxed', (t) => {
  const plain = costOrder(order([line()]));
  const tipped = costOrder(order([line()], { tipPaise: 50000 }));
  t.equal(tipped.taxTotal, plain.taxTotal, 'the tax did not move');
  t.equal(tipped.total, plain.total + 50000);
});

test('the printed lines always add up to the printed total', (t) => {
  // An awkward set of prices, chosen because they do not divide cleanly.
  const lines = [
    line({ id: 'a', unitPaise: 48333, qty: 3 }),
    line({ id: 'b', unitPaise: 12799, qty: 1 }),
    line({ id: 'c', unitPaise: 7777, qty: 7 }),
  ];
  const totals = costOrder(order(lines, { discount: { mode: 'PCT', value: 7.5 } }));
  const rebuilt = totals.discounted
    + totals.serviceCharge
    + totals.taxTotal
    + totals.tip
    + totals.roundOff;
  t.equal(rebuilt, totals.total, 'every printed line sums to the total');
  t.equal(totals.gross, lines.reduce((n, l) => n + lineGross(l), 0));
});

/* ------------------------------------------------------------ splits --- */

test('an even split adds back to the one bill', (t) => {
  const source = order([line({ qty: 3 })]);
  const split = buildSplit(source, 'EQUAL', { ways: 3 });
  const shares = costSplit(source, split);
  t.equal(shares.length, 3);
  t.equal(
    shares.reduce((n, s) => n + s.totals.total, 0),
    costOrder(source).total,
    'three shares equal one bill'
  );
});

test('a seat split puts each dish on the seat that ordered it', (t) => {
  const source = order([
    line({ id: 'a', seat: 1, unitPaise: 100000 }),
    line({ id: 'b', seat: 2, unitPaise: 200000 }),
    line({ id: 'c', seat: null, unitPaise: 60000 }), // shared mezze
  ]);
  const split = buildSplit(source, 'SEAT');
  t.equal(split.shares.length, 3, 'two seats plus the shared table line');
  const shares = costSplit(source, split);
  const bySeat = Object.fromEntries(shares.map((s) => [s.share.label, s.totals.gross]));
  t.equal(bySeat['Seat 1'], 100000);
  t.equal(bySeat['Seat 2'], 200000);
  t.equal(bySeat['Table (shared)'], 60000);
});

test('a split share carries its own proportion of the bill discount', (t) => {
  const source = order([
    line({ id: 'a', seat: 1, unitPaise: 100000 }),
    line({ id: 'b', seat: 2, unitPaise: 100000 }),
  ], { discount: { mode: 'PCT', value: 20 } });

  const split = buildSplit(source, 'SEAT');
  const shares = costSplit(source, split);
  for (const { totals } of shares) {
    t.equal(totals.discount, 20000, 'each seat carries half the ₹400 discount');
  }
  t.equal(
    shares.reduce((n, s) => n + s.totals.total, 0),
    costOrder(source).total,
    'the shares still add to the discounted bill'
  );
});

test('discountAmount honours the configured ceiling', (t) => {
  t.equal(discountAmount(100000, { mode: 'PCT', value: 150 }), 100000, 'capped at 100%');
  t.equal(discountAmount(100000, { mode: 'NONE', value: 50 }), 0);
  t.equal(discountAmount(100000, { mode: 'PCT', value: 0 }), 0);
});
