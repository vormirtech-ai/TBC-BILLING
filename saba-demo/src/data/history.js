/**
 * Thirty days of trading behind today, so the reports have something to say the
 * moment the demo opens.
 *
 * Two decisions worth knowing about:
 *
 *  1. The numbers come from a seeded generator, not Math.random. The same day
 *     always produces the same covers and the same top sellers, so a figure a
 *     client notices in the morning is still there in the afternoon.
 *
 *  2. History is rebuilt at boot rather than saved. It is derived data — 30
 *     days of full orders would be most of a megabyte of local storage for
 *     something that never changes.
 */

import { MENU_ITEMS } from './menu.seed.js';
import { CHARGES } from '../config.js';
import { pct, roundToRupee } from '../core/money.js';
import { dayKey } from '../core/format.js';

/** mulberry32 — small, fast, and identical on every machine. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (random, list) => list[Math.floor(random() * list.length)];
const between = (random, lo, hi) => lo + Math.floor(random() * (hi - lo + 1));

/**
 * Service is not flat. Friday and Saturday run about 45% busier than a Tuesday,
 * and the room fills in two waves — an early sitting around 7 and the main one
 * at 9. A report built on an even spread looks fake to anyone who has run a
 * restaurant.
 */
const DAY_WEIGHT = [1.15, 0.62, 0.72, 0.84, 0.96, 1.42, 1.48]; // Sun … Sat
const HOUR_WEIGHT = {
  12: 0.5, 13: 0.9, 14: 0.6, 15: 0.2,
  19: 0.8, 20: 1.3, 21: 1.5, 22: 1.1, 23: 0.4,
};

const PAYMENT_MIX = [
  ['CARD', 0.46], ['UPI', 0.34], ['CASH', 0.12], ['ROOM', 0.05], ['VOUCHER', 0.03],
];

function weightedPayment(random) {
  let roll = random();
  for (const [method, share] of PAYMENT_MIX) {
    roll -= share;
    if (roll <= 0) return method;
  }
  return 'CARD';
}

/** Fine dining sells differently: signatures carry the room. */
function weightedItem(random, pool) {
  const item = pick(random, pool);
  if (item.signature && random() < 0.45) return item;
  if (!item.signature && random() < 0.22) return pick(random, pool.filter((i) => i.signature));
  return item;
}

function buildCheck(random, at, covers) {
  const mezze = MENU_ITEMS.filter((i) => i.category === 'mezze');
  const bigs = MENU_ITEMS.filter((i) => ['tandoor', 'mains'].includes(i.category));
  const sides = MENU_ITEMS.filter((i) => i.category === 'rice');
  const sweets = MENU_ITEMS.filter((i) => i.category === 'dessert');
  const drinks = MENU_ITEMS.filter((i) => ['bar', 'soft'].includes(i.category));

  const lines = [];
  const push = (item, qty) => {
    if (!item) return;
    const found = lines.find((l) => l.itemId === item.id);
    if (found) found.qty += qty;
    else lines.push({ itemId: item.id, name: item.name, category: item.category, qty, unitPaise: item.pricePaise });
  };

  for (let i = 0; i < Math.max(1, Math.round(covers / 1.6)); i += 1) push(weightedItem(random, mezze), 1);
  for (let i = 0; i < covers; i += 1) if (random() < 0.88) push(weightedItem(random, bigs), 1);
  for (let i = 0; i < Math.ceil(covers / 2); i += 1) push(pick(random, sides), 1);
  for (let i = 0; i < covers; i += 1) if (random() < 0.62) push(pick(random, sweets), 1);
  for (let i = 0; i < covers; i += 1) if (random() < 1.15) push(weightedItem(random, drinks), 1);

  const gross = lines.reduce((n, l) => n + l.unitPaise * l.qty, 0);
  // Roughly one bill in nine carries a discount — loyalty, a set menu, or a
  // manager putting something right.
  const discount = random() < 0.11 ? pct(gross, between(random, 500, 2000)) : 0;
  const discounted = gross - discount;
  const serviceCharge = random() < 0.94 ? pct(discounted, CHARGES.serviceChargeBps) : 0;
  const taxable = discounted + serviceCharge;
  const taxTotal = CHARGES.taxComponents.reduce((n, c) => n + pct(taxable, c.bps), 0);
  const tip = random() < 0.35 ? pct(taxable, between(random, 200, 800)) : 0;
  const { rounded } = roundToRupee(taxable + taxTotal + tip);

  return {
    at,
    covers,
    lines,
    gross,
    discount,
    serviceCharge,
    taxTotal,
    tip,
    total: rounded,
    net: discounted,
    method: weightedPayment(random),
    /** Table turn, in minutes — fine dining sits far longer than a cafe. */
    durationMin: between(random, 62, 145),
    voided: random() < 0.045,
  };
}

/**
 * @param {number} days how far back to generate
 * @param {Date}   today the day to end on (exclusive — today is live trading)
 * @returns {Array<{ day, weekday, checks, covers, net, total }>}
 */
export function buildHistory(days = 30, today = new Date()) {
  const out = [];
  for (let back = days; back >= 1; back -= 1) {
    const date = new Date(today);
    date.setDate(date.getDate() - back);
    date.setHours(0, 0, 0, 0);

    const random = rng(Number(dayKey(date).replace(/-/g, '')));
    const weight = DAY_WEIGHT[date.getDay()];
    const target = Math.round(between(random, 22, 34) * weight);

    const checks = [];
    const hours = Object.keys(HOUR_WEIGHT).map(Number);
    for (let i = 0; i < target; i += 1) {
      let hour = pick(random, hours);
      // Reject-sample so the busy hours actually get the traffic.
      if (random() > HOUR_WEIGHT[hour] / 1.5) hour = pick(random, [20, 21, 21, 22]);
      const at = new Date(date);
      at.setHours(hour, between(random, 0, 59));
      const covers = between(random, 2, 2) + between(random, 0, 4);
      checks.push(buildCheck(random, at.getTime(), Math.max(2, covers)));
    }

    checks.sort((a, b) => a.at - b.at);
    const live = checks.filter((c) => !c.voided);
    out.push({
      day: dayKey(date),
      at: date.getTime(),
      weekday: date.getDay(),
      checks,
      covers: live.reduce((n, c) => n + c.covers, 0),
      net: live.reduce((n, c) => n + c.net, 0),
      total: live.reduce((n, c) => n + c.total, 0),
    });
  }
  return out;
}
