/**
 * First run.
 *
 * An empty database is filled with the three things a restaurant cannot open
 * without: the carte, one manager account, and the default charge rules.
 *
 * With SABA_SEED_DEMO=1 it also builds a worked example — a month of trading
 * and a room mid-service — so a sales demonstration opens on something real
 * rather than on an empty floor plan. A restaurant's own first day leaves it
 * off and starts clean.
 */

import { randomUUID } from 'node:crypto';

import { one, run, tx, nextCounter, bumpRevision } from './db/index.js';
import { config } from './config.js';
import { log } from './log.js';
import * as store from './store.js';
import * as auth from './auth.js';

import { MENU_ITEMS, MODIFIER_GROUPS, itemById } from '../app/src/shared/catalogue.js';
import { SECTIONS, TABLES, tableById } from '../app/src/shared/floorplan.js';
import {
  RESTAURANT, CHARGES, STATIONS, DAY_ROLLOVER_HOUR, NUMBERING, KOT_STATUS,
} from '../app/src/shared/config.js';
import { businessDay, shiftDay, serial } from '../app/src/shared/format.js';
import { costOrder } from '../app/src/shared/pricing.js';
import {
  createOrder, addLine, fireCourse,
} from '../app/src/shared/orders.js';

const MIN = 60_000;

/* ----------------------------------------------------------- entry --- */

export function ensureSeeded() {
  store.registerModifierGroups(MODIFIER_GROUPS);

  const menuCount = one('SELECT count(*) AS n FROM menu_items').n;
  if (menuCount === 0) {
    seedMenu();
    seedSettings();
  }

  const userCount = one('SELECT count(*) AS n FROM users').n;
  if (userCount === 0) seedFirstUsers();

  const orderCount = one('SELECT count(*) AS n FROM orders').n;
  if (orderCount === 0 && config.seedDemo) seedDemo();
}

/* ------------------------------------------------------------ menu --- */

function seedMenu() {
  tx(() => {
    MENU_ITEMS.forEach((item, index) => {
      store.upsertMenuItem({ ...item, sort: index, active: true });
    });
  });
  log.info('carte loaded', { dishes: MENU_ITEMS.length });
}

function seedSettings() {
  tx(() => {
    store.setSetting('restaurant', RESTAURANT);
    store.setSetting('charges', CHARGES);
    store.setSetting('stations', STATIONS);
    store.setSetting('printing', { billFormat: 'A4', watermark: true });
    store.setSetting('floorplan', { sections: SECTIONS, tables: TABLES });
  });
}

/* ----------------------------------------------------------- users --- */

/**
 * The first manager.
 *
 * SABA_SETUP_PIN sets it; otherwise one is generated and printed to the log
 * exactly once. It is never a fixed default — a POS that ships with 1234 on
 * every install is a POS with no access control at all.
 */
function seedFirstUsers() {
  const pin = config.setupPin || generatePin();

  auth.createUser({ name: 'Manager', role: 'manager', pin });

  if (config.seedDemo) {
    // The worked example needs somebody on the floor and somebody at the pass.
    auth.createUser({ name: 'Alina Rahman', role: 'captain', pin: '2471' });
    auth.createUser({ name: 'Devesh Kamat', role: 'cashier', pin: '3582' });
    auth.createUser({ name: 'Kitchen Pass', role: 'kitchen', pin: '4693' });
  }

  log.warn('─'.repeat(64));
  log.warn('  FIRST RUN — the manager PIN for this install is:  ' + pin);
  log.warn('  Sign in with it, then add your staff under Setup → People.');
  log.warn('  It is shown once. Change it from Setup after signing in.');
  if (config.seedDemo) {
    log.warn('  Demo accounts: captain 2471 · cashier 3582 · kitchen 4693');
  }
  log.warn('─'.repeat(64));
}

function generatePin() {
  // Rejection-sampled so the generated PIN is never one the validator would
  // refuse a human for choosing.
  for (;;) {
    const pin = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    try { return auth.validatePin(pin); } catch { /* try another */ }
  }
}

/* ------------------------------------------------------------ demo --- */

/** mulberry32 — the same figures on every machine, every time. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedDemo() {
  log.info('building the worked example…');
  const started = Date.now();
  const manager = auth.listUsers().find((u) => u.role === 'manager');
  const captain = auth.listUsers().find((u) => u.role === 'captain') || manager;
  const cashier = auth.listUsers().find((u) => u.role === 'cashier') || manager;

  tx(() => {
    seedHistory(30, { captain, cashier });
    seedTodayTrading({ captain, cashier });
    seedLiveService({ captain, manager });
    seedBook();
    store.setEightySix('b03', true, { actor: manager.name, note: 'Out of fresh egg white' });
    bumpRevision();
  });

  log.info('worked example ready', { ms: Date.now() - started });
}

/* --- building blocks ----------------------------------------------- */

const pick = (random, list) => list[Math.floor(random() * list.length)];
const between = (random, lo, hi) => lo + Math.floor(random() * (hi - lo + 1));

const CATS = {
  mezze: MENU_ITEMS.filter((i) => i.category === 'mezze'),
  bigs: MENU_ITEMS.filter((i) => ['tandoor', 'mains'].includes(i.category)),
  sides: MENU_ITEMS.filter((i) => i.category === 'rice'),
  sweets: MENU_ITEMS.filter((i) => i.category === 'dessert'),
  drinks: MENU_ITEMS.filter((i) => ['bar', 'soft'].includes(i.category)),
};

/** Signature dishes carry the room, so they are ordered disproportionately. */
function weightedItem(random, pool) {
  const item = pick(random, pool);
  if (item.signature && random() < 0.45) return item;
  if (!item.signature && random() < 0.22) {
    const signatures = pool.filter((i) => i.signature);
    if (signatures.length) return pick(random, signatures);
  }
  return item;
}

/**
 * One complete settled bill: lines, dockets with believable prep times,
 * payment, invoice number.
 */
function makeSettledOrder({ random, openedAt, tableId, covers, guest, captain, cashier, day }) {
  const table = tableById(tableId);
  const number = nextCounter('order', 1);
  const order = createOrder({
    number, table, covers, guestName: guest, user: captain,
  });
  order.businessDay = day;
  order.openedAt = openedAt;

  const add = (item, qty) => item && addLine(order, item, { qty, seat: null });
  for (let i = 0; i < Math.max(1, Math.round(covers / 1.7)); i += 1) {
    add(weightedItem(random, CATS.mezze), 1);
  }
  for (let i = 0; i < covers; i += 1) {
    if (random() < 0.9) add(weightedItem(random, CATS.bigs), 1);
  }
  add(pick(random, CATS.sides), Math.ceil(covers / 2));
  for (let i = 0; i < covers; i += 1) {
    if (random() < 0.58) add(pick(random, CATS.sweets), 1);
  }
  for (let i = 0; i < covers; i += 1) {
    if (random() < 1.1) add(weightedItem(random, CATS.drinks), 1);
  }
  for (const line of order.lines) line.addedAt = openedAt + MIN;

  // Fire everything a few minutes in, then bump each docket at a speed that
  // station would plausibly manage.
  const firedAt = openedAt + between(random, 3, 8) * MIN;
  const { kots } = fireCourse(order, null, captain);
  const targets = { BAR: 5, COLD: 8, TANDOOR: 15, HOT: 17, PASTRY: 10 };
  let lastServed = firedAt;
  for (const kot of kots) {
    kot.firedAt = firedAt;
    const prep = between(random, (targets[kot.station] || 10) - 3, (targets[kot.station] || 10) + 5);
    kot.readyAt = firedAt + prep * MIN;
    kot.servedAt = kot.readyAt + between(random, 1, 4) * MIN;
    kot.status = KOT_STATUS.SERVED;
    lastServed = Math.max(lastServed, kot.servedAt);
    for (const line of order.lines) {
      if (line.kotId !== kot.id) continue;
      line.firedAt = kot.firedAt;
      line.readyAt = kot.readyAt;
      line.servedAt = kot.servedAt;
      line.status = KOT_STATUS.SERVED;
    }
  }

  // About one bill in nine carries a discount, and one in twenty a comp.
  if (random() < 0.11) {
    order.charges.discount = {
      mode: 'PCT',
      value: pick(random, [5, 10, 10, 15, 20]),
      reason: pick(random, ['Loyalty / regular guest', 'Service recovery', 'Set menu pricing']),
      approvedBy: 'Manager',
    };
  }
  if (random() < 0.05) {
    const line = order.lines.find((l) => l.status === KOT_STATUS.SERVED);
    if (line) {
      line.comp = true;
      line.compReason = 'Long wait';
      line.compBy = 'Manager';
    }
  }
  if (random() < 0.06) order.charges.serviceCharge = false;
  if (random() < 0.3) {
    order.charges.tipPaise = Math.round(costOrder(order).taxable
      * between(random, 2, 8) / 100 / 100) * 100;
  }

  const closedAt = lastServed + between(random, 12, 40) * MIN;
  const invoiceNo = nextCounter('invoice', 1);
  order.invoice = {
    number: invoiceNo,
    code: serial(NUMBERING.invoicePrefix, invoiceNo, NUMBERING.padding),
    at: closedAt - 4 * MIN,
    by: cashier.name,
  };
  order.status = 'SETTLED';
  order.closedAt = closedAt;
  order.settledBy = cashier.name;

  const total = costOrder(order).total;
  const method = weightedPayment(random);
  order.payments = [{
    id: `pay_${randomUUID().slice(0, 12)}`,
    method,
    paise: total,
    ref: method === 'CARD' || method === 'UPI' ? `Ref ${between(random, 100000, 999999)}` : '',
    shareId: null,
    at: closedAt,
    by: cashier.name,
  }];

  return order;
}

const PAYMENT_MIX = [['CARD', 0.46], ['UPI', 0.34], ['CASH', 0.12], ['ROOM', 0.05], ['VOUCHER', 0.03]];

function weightedPayment(random) {
  let roll = random();
  for (const [method, share] of PAYMENT_MIX) {
    roll -= share;
    if (roll <= 0) return method;
  }
  return 'CARD';
}

function insertOrder(order) {
  const totals = costOrder(order);
  run(
    'INSERT INTO orders (id, number, code, business_day, table_id, status, invoice_no,'
    + ' opened_at, closed_at, total_paise, covers, doc, updated_at)'
    + ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    order.id, order.number, order.code, order.businessDay, order.tableId,
    order.status, order.invoice?.number ?? null, order.openedAt, order.closedAt ?? null,
    totals.total, order.covers, JSON.stringify(order), Date.now()
  );
}

/* --- thirty days behind us ------------------------------------------ */

// Friday and Saturday run far busier than a Tuesday; the room fills in two
// waves. A report built on an even spread looks fake to anyone who has run a
// restaurant.
const DAY_WEIGHT = [1.15, 0.62, 0.72, 0.84, 0.96, 1.42, 1.48]; // Sun … Sat
const SERVICE_HOURS = [12, 13, 13, 14, 19, 20, 20, 21, 21, 21, 22, 22, 23];

const GUESTS = ['Iyer', 'Kapadia', 'D’Souza', 'Mehta', 'Walk-in', 'Sharma', 'Ansari',
  'Pinto', 'Bhatia', 'Lobo', 'Rao', 'Fernandes', 'Qureshi', 'Bose', 'Talwar',
  'Shroff', 'Nair', 'Kagti', 'Deshpande', 'Irani', 'Sen', 'Menon', 'Walk-in'];

function seedHistory(days, { captain, cashier }) {
  const today = store.today();
  const seats = [...Array(24).keys()];
  let written = 0;

  for (let back = days; back >= 1; back -= 1) {
    const day = shiftDay(today, -back);
    const date = new Date(`${day}T12:00:00`);
    const random = rng(Number(day.replace(/-/g, '')));
    const target = Math.round(between(random, 22, 34) * DAY_WEIGHT[date.getDay()]);

    for (let i = 0; i < target; i += 1) {
      const hour = pick(random, SERVICE_HOURS);
      const openedAt = new Date(`${day}T12:00:00`).setHours(hour, between(random, 0, 59), 0, 0);
      const table = TABLES[seats[i % seats.length] % TABLES.length];
      insertOrder(makeSettledOrder({
        random,
        openedAt,
        tableId: table.id,
        covers: Math.max(2, between(random, 2, 2) + between(random, 0, 4)),
        guest: pick(random, GUESTS),
        captain,
        cashier,
        day,
      }));
      written += 1;
    }
  }
  log.info('trading history written', { days, bills: written });
}

/* --- earlier today --------------------------------------------------- */

function seedTodayTrading({ captain, cashier }) {
  const day = store.today();
  const random = rng(Number(day.replace(/-/g, '')) + 7);
  const free = TABLES.filter(
    (t) => !['t3', 't6', 't7', 't9', 'g2', 'g5', 'r1', 'b3'].includes(t.id)
  );

  // Spread the bills already settled today back from now — but never past the
  // start of the business day. Opened at nine in the morning the example
  // would otherwise claim a peak trading hour of four a.m., which is the sort
  // of detail that loses a room's confidence in everything else on screen.
  const dayStart = new Date();
  dayStart.setHours(DAY_ROLLOVER_HOUR, 0, 0, 0);
  if (dayStart.getTime() > Date.now()) dayStart.setDate(dayStart.getDate() - 1);

  const window = Math.min(5.5 * 60, Math.max(45, (Date.now() - dayStart.getTime()) / MIN - 20));
  const count = 14;

  for (let i = 0; i < count; i += 1) {
    // Newest first, walking backwards across the window.
    const closedAgo = 20 + (window * i) / count + between(random, 0, 8);
    const sat = between(random, 55, 100);
    insertOrder(makeSettledOrder({
      random,
      openedAt: Date.now() - (closedAgo + sat) * MIN,
      tableId: free[i % free.length].id,
      covers: between(random, 2, 6),
      guest: pick(random, GUESTS),
      captain,
      cashier,
      day,
    }));
  }
  log.info("today's earlier service written", { bills: count, windowMinutes: Math.round(window) });
}

/* --- the room, right now --------------------------------------------- */

/**
 * Eight tables mid-meal, each at a different point, so every screen has
 * something real on it the moment the system is opened.
 */
function seedLiveService({ captain, manager }) {
  const day = store.today();
  const mods = (groupId, ids) =>
    MODIFIER_GROUPS[groupId].options.filter((o) => ids.includes(o.id));

  const open = (spec) => {
    const number = nextCounter('order', 1);
    const order = createOrder({
      number,
      table: tableById(spec.table),
      covers: spec.covers,
      guestName: spec.guest,
      user: spec.by || captain,
    });
    order.businessDay = day;
    order.openedAt = Date.now() - spec.agoMin * MIN;
    order.notes = spec.notes || '';
    for (const [id, qty, seat, modifiers, notes] of spec.lines) {
      addLine(order, itemById(id), {
        qty, seat, modifiers: modifiers || [], notes: notes || '',
      });
    }
    for (const line of order.lines) line.addedAt = order.openedAt + MIN;
    return order;
  };

  const fireAgo = (order, course, user, agoMin) => {
    const { kots } = fireCourse(order, course, user);
    const at = Date.now() - agoMin * MIN;
    for (const kot of kots) {
      kot.firedAt = at;
      for (const line of order.lines) if (line.kotId === kot.id) line.firedAt = at;
    }
    return kots;
  };

  /** prepMin on the stove; runMin on the pass, or null to leave it sitting. */
  const bump = (order, kot, prepMin, runMin = 2) => {
    if (!kot) return;
    kot.status = KOT_STATUS.READY;
    kot.readyAt = kot.firedAt + prepMin * MIN;
    kot.servedAt = null;
    if (runMin != null) {
      kot.status = KOT_STATUS.SERVED;
      kot.servedAt = kot.readyAt + runMin * MIN;
    }
    for (const line of order.lines) {
      if (line.kotId !== kot.id) continue;
      line.status = kot.status;
      line.readyAt = kot.readyAt;
      line.servedAt = kot.servedAt;
    }
  };
  const at = (kots, station) => kots.find((k) => k.station === station);

  /* Table 3 — starters away, mains still on the pad. */
  {
    const o = open({
      table: 't3', covers: 4, guest: 'Mr Iyer', agoMin: 24,
      lines: [['m01', 1, 0], ['m02', 1, 0], ['m05', 1, 0], ['t01', 2, 1],
        ['n01', 1, 3], ['r01', 2, 0], ['b01', 2, 1], ['s03', 2, 3]],
    });
    bump(o, at(fireAgo(o, 'BEVERAGE', captain, 21), 'BAR'), 4, 1);
    fireAgo(o, 'STARTER', captain, 18);   // 18 min against an 8-minute target
    insertOrder(o);
  }

  /* Table 6 — anniversary six, mains in, tandoor dying on the pass. */
  {
    const o = open({
      table: 't6', covers: 6, guest: 'Kapadia · anniversary', agoMin: 46,
      notes: 'Anniversary — candle with the dessert. No nuts for seat 4.',
      lines: [['m10', 1, 0], ['m06', 1, 0], ['m03', 1, 0], ['m09', 1, 0],
        ['t02', 2, 1, mods('doneness', ['mrare'])],
        ['t05', 1, 2, mods('doneness', ['medium'])],
        ['n04', 1, 0, mods('portion', ['sharing'])],
        ['t07', 1, 4, [], 'No nuts — allergy'],
        ['r01', 2, 0], ['r04', 3, 0], ['b05', 4, 0], ['b02', 2, 0]],
    });
    bump(o, at(fireAgo(o, 'BEVERAGE', captain, 43), 'BAR'), 5, 2);
    const starters = fireAgo(o, 'STARTER', captain, 40);
    bump(o, at(starters, 'COLD'), 7, 3);
    bump(o, at(starters, 'TANDOOR'), 9, 3);
    const mains = fireAgo(o, 'MAIN', captain, 26);
    bump(o, at(mains, 'TANDOOR'), 15, null);   // plated 11 minutes ago, nobody came
    insertOrder(o);
  }

  /* Table 7 — finished eating, will ask for the bill. */
  {
    const o = open({
      table: 't7', covers: 2, guest: 'Ms D’Souza', agoMin: 84,
      lines: [['m02', 1, 0], ['t04', 1, 1], ['n02', 1, 2], ['r02', 1, 0],
        ['d03', 1, 0], ['b06', 2, 0], ['s04', 2, 0]],
    });
    bump(o, at(fireAgo(o, 'BEVERAGE', captain, 81), 'BAR'), 4, 1);
    bump(o, at(fireAgo(o, 'STARTER', captain, 78), 'COLD'), 6, 2);
    const mains = fireAgo(o, 'MAIN', captain, 62);
    bump(o, at(mains, 'TANDOOR'), 14, 2);
    bump(o, at(mains, 'HOT'), 16, 3);
    bump(o, at(fireAgo(o, 'DESSERT', captain, 28), 'PASTRY'), 9, 2);
    insertOrder(o);
  }

  /* Table 9 — corporate eight, bill printed, waiting to settle. */
  {
    const o = open({
      table: 't9', covers: 8, guest: 'Vantage Partners', agoMin: 118,
      lines: [['m01', 2, 0], ['m04', 2, 0], ['m07', 2, 0], ['m08', 2, 0],
        ['t01', 3, 0], ['t03', 2, 0], ['t07', 2, 0], ['n03', 2, 0],
        ['r01', 3, 0], ['r04', 4, 0], ['d01', 2, 0], ['d04', 3, 0],
        ['b08', 6, 0], ['s06', 4, 0], ['s05', 5, 0]],
    });
    bump(o, at(fireAgo(o, 'BEVERAGE', captain, 115), 'BAR'), 6, 2);
    const starters = fireAgo(o, 'STARTER', captain, 112);
    bump(o, at(starters, 'COLD'), 9, 3);
    bump(o, at(starters, 'HOT'), 12, 3);
    bump(o, at(starters, 'TANDOOR'), 11, 2);
    const mains = fireAgo(o, 'MAIN', captain, 88);
    bump(o, at(mains, 'TANDOOR'), 17, 4);
    bump(o, at(mains, 'HOT'), 21, 3);
    bump(o, at(fireAgo(o, 'DESSERT', captain, 34), 'PASTRY'), 11, 2);
    const invoiceNo = nextCounter('invoice', 1);
    o.invoice = {
      number: invoiceNo,
      code: serial(NUMBERING.invoicePrefix, invoiceNo, NUMBERING.padding),
      at: Date.now() - 5 * MIN,
      by: 'Devesh Kamat',
    };
    insertOrder(o);
  }

  /* Terrace G2 — the captain is writing this at the table right now. */
  insertOrder(open({
    table: 'g2', covers: 2, guest: 'Walk-in', agoMin: 6,
    lines: [['b01', 1, 1, mods('ice', ['up'])], ['b03', 1, 2], ['m09', 1, 0]],
  }));

  /* Terrace G5 — mains cooking, dessert written but held back. */
  {
    const o = open({
      table: 'g5', covers: 5, guest: 'Sharma', agoMin: 38,
      lines: [['m05', 1, 0], ['m01', 1, 0], ['t06', 1, 2], ['t01', 2, 3],
        ['n05', 1, 5], ['r03', 2, 0], ['d02', 3, 0], ['d05', 2, 0],
        ['s01', 3, 0], ['s02', 2, 0]],
    });
    bump(o, at(fireAgo(o, 'BEVERAGE', captain, 35), 'BAR'), 5, 2);
    bump(o, at(fireAgo(o, 'STARTER', captain, 33), 'COLD'), 8, 2);
    fireAgo(o, 'MAIN', captain, 12);
    insertOrder(o);
  }

  /* The Rose Room — private twelve, set menu, mains held for the call. */
  {
    const o = open({
      table: 'r1', covers: 12, guest: 'Mehta · engagement dinner', agoMin: 58,
      notes: 'Set menu. Fire the mains on the captain’s call only.',
      by: manager,
      lines: [['m10', 2, 0], ['m01', 3, 0], ['m03', 3, 0], ['m06', 2, 0], ['m04', 3, 0],
        ['t02', 4, 0, mods('doneness', ['medium'])], ['n04', 2, 0], ['t07', 3, 0],
        ['r01', 4, 0], ['r04', 6, 0], ['d01', 4, 0], ['d03', 4, 0],
        ['b05', 8, 0], ['b07', 6, 0], ['s06', 6, 0]],
    });
    bump(o, at(fireAgo(o, 'BEVERAGE', manager, 55), 'BAR'), 7, 3);
    bump(o, at(fireAgo(o, 'STARTER', manager, 50), 'COLD'), 12, 4);
    insertOrder(o);
  }

  /* Bar B3 — two in, drinks and a mezze, all served. */
  {
    const o = open({
      table: 'b3', covers: 2, guest: 'Bar', agoMin: 28,
      lines: [['b01', 2, 0], ['b04', 1, 0], ['m01', 1, 0], ['m08', 1, 0]],
    });
    const kots = fireAgo(o, null, captain, 26);
    bump(o, at(kots, 'BAR'), 4, 1);
    bump(o, at(kots, 'COLD'), 7, 2);
    bump(o, at(kots, 'HOT'), 11, 2);
    insertOrder(o);
  }

  log.info('live service written', { tables: 8 });
}

/* --- tonight's book --------------------------------------------------- */

function seedBook() {
  const rows = [
    ['Kapadia', 6, -46, 't6', 'SEATED', 'Anniversary — candle with dessert'],
    ['Mehta', 12, -58, 'r1', 'SEATED', 'Engagement dinner, set menu'],
    ['Ansari', 4, 20, 't5', 'CONFIRMED', 'Window table requested'],
    ['Dr Pinto', 2, 35, 't1', 'CONFIRMED', ''],
    ['Bhatia', 8, 50, 't10', 'CONFIRMED', 'One high chair'],
    ['Lobo', 2, 65, 'g1', 'CONFIRMED', 'Terrace, non-smoking'],
    ['Rao', 4, 80, 't2', 'CONFIRMED', 'Vegan — no dairy at all'],
    ['Fernandes', 2, 95, 'g6', 'CONFIRMED', ''],
  ];
  const system = { name: 'System' };
  rows.forEach(([name, covers, offsetMin, tableId, status, note], i) => {
    const when = new Date(Date.now() + offsetMin * MIN);
    when.setMinutes(Math.round(when.getMinutes() / 15) * 15, 0, 0);
    store.saveReservation({
      name, covers, at: when.getTime(), tableId, status, note,
      phone: `+91 98${20014477 + i * 13791}`,
    }, system);
  });
}

/* ------------------------------------------------------------- reset --- */

/**
 * Wipe every order, booking and audit entry and rebuild the worked example.
 *
 * Staff accounts and the carte survive, because a demonstration that forgets
 * its own sign-in PINs halfway through is worse than one that does not reset.
 * The API refuses to call this unless the server was started in demo mode.
 */
export function resetDemo() {
  tx(() => {
    run('DELETE FROM orders');
    run('DELETE FROM reservations');
    run('DELETE FROM audit');
    run('DELETE FROM shifts');
    run('DELETE FROM eighty_six');
    run("DELETE FROM counters WHERE name IN ('order', 'invoice')");
    bumpRevision();
  });
  seedDemo();
}
