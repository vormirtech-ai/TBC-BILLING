/**
 * Builds the state the demo opens on.
 *
 * A billing demo that starts on an empty restaurant is a demo of an empty
 * restaurant. This one opens in the middle of a Saturday service: dockets are
 * cooking, one has been sitting on the pass for a quarter of an hour, a table
 * is waiting to pay, and a captain is halfway through writing an order. Every
 * screen has something real on it from the first second.
 *
 * All timings are expressed as "minutes ago" and stamped onto the records
 * directly, so the kitchen report reads plausible prep times rather than the
 * artefacts of when the demo happened to be opened.
 */

import { DEMO_USERS, NUMBERING, KOT_STATUS } from '../config.js';
import { tableById } from './floor.seed.js';
import { MENU_ITEMS, itemById, MODIFIER_GROUPS } from './menu.seed.js';
import { createOrder, addLine, fireCourse } from '../domain/orders.js';
import { costOrder } from '../domain/pricing.js';
import { buildHistory, rng } from './history.js';
import { dayKey, uid } from '../core/format.js';

const MIN = 60000;
const manager = DEMO_USERS[0];
const captain = DEMO_USERS[1];

const mods = (groupId, ids) =>
  MODIFIER_GROUPS[groupId].options.filter((o) => ids.includes(o.id));

/* --------------------------------------------------------- builders --- */

/** Open a table. `agoMin` is how long the guests have been sitting down. */
function open(counter, spec) {
  const order = createOrder({
    number: counter.next(),
    table: tableById(spec.table),
    covers: spec.covers,
    guestName: spec.guest,
    user: spec.by || captain,
  });
  order.openedAt = Date.now() - spec.agoMin * MIN;
  order.notes = spec.notes || '';
  for (const [id, qty, seat, modifiers, notes] of spec.lines) {
    addLine(order, itemById(id), {
      qty, seat, modifiers: modifiers || [], notes: notes || '',
    });
  }
  for (const line of order.lines) line.addedAt = order.openedAt + MIN;
  return order;
}

/**
 * Fire a course and stamp the dockets it produced as having gone in `agoMin`
 * minutes ago. Returns them so the caller can bump each one individually.
 */
function fireAgo(order, courseId, user, agoMin) {
  const { kots } = fireCourse(order, courseId, user);
  const firedAt = Date.now() - agoMin * MIN;
  for (const kot of kots) {
    kot.firedAt = firedAt;
    for (const line of order.lines) {
      if (line.kotId === kot.id) line.firedAt = firedAt;
    }
  }
  return kots;
}

/**
 * Bump a docket the way a kitchen actually does — a plausible number of minutes
 * after it was fired, not "just now". The station performance report reads
 * these gaps, so seeding them carelessly would make the kitchen look broken.
 *
 * @param prepMin minutes on the stove before it reached the pass
 * @param runMin  minutes on the pass before a runner took it, or null to leave
 *                it sitting there — which is what turns the KDS card red
 */
function bump(order, kot, prepMin, runMin = 2) {
  if (!kot) return kot;
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
  return kot;
}

const at = (kots, station) => kots.find((k) => k.station === station);

/**
 * Bills that were settled earlier today.
 *
 * Without these the Today report opens on a row of zeros, which is both a poor
 * first impression and a false one: a restaurant showing a system at eight in
 * the evening has already done a lunch service. These are complete orders —
 * lines, dockets, payments and all — so the audit trail, the captain figures
 * and the kitchen timings all include them.
 */
function buildSettledToday(counter) {
  const random = rng(20260714);
  const pool = MENU_ITEMS.filter((i) => i.available !== false);
  const mezze = pool.filter((i) => i.category === 'mezze');
  const bigs = pool.filter((i) => ['tandoor', 'mains'].includes(i.category));
  const sides = pool.filter((i) => i.category === 'rice');
  const sweets = pool.filter((i) => i.category === 'dessert');
  const drinks = pool.filter((i) => ['bar', 'soft'].includes(i.category));
  const pick = (list) => list[Math.floor(random() * list.length)];
  const between = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));

  const names = ['Dsouza', 'Menon', 'Walk-in', 'Qureshi', 'Bose', 'Talwar',
    'Walk-in', 'Shroff', 'Nair', 'Kagti', 'Walk-in', 'Deshpande', 'Irani', 'Sen'];
  const seats = ['t1', 't2', 't4', 't5', 't8', 't10', 'g1', 'g3', 'g4', 'g6',
    'b1', 'b2', 'b5', 'r2'];
  const methods = ['CARD', 'CARD', 'UPI', 'UPI', 'CASH', 'CARD', 'UPI', 'ROOM',
    'CARD', 'UPI', 'CASH', 'CARD', 'UPI', 'VOUCHER'];

  const out = [];
  for (let i = 0; i < names.length; i += 1) {
    const covers = between(2, 6);
    // Spread the service back over about five and a half hours, so the trading
    // pattern chart has a curve to it rather than two or three slabs.
    const closedAgo = 330 - i * 22 + between(0, 9);
    const openedAgo = closedAgo + between(58, 105);

    const lines = [];
    const push = (item, qty) => item && lines.push([item.id, qty, 0, [], '']);
    for (let n = 0; n < Math.max(1, Math.round(covers / 1.7)); n += 1) push(pick(mezze), 1);
    for (let n = 0; n < covers; n += 1) if (random() < 0.9) push(pick(bigs), 1);
    push(pick(sides), Math.ceil(covers / 2));
    for (let n = 0; n < covers; n += 1) if (random() < 0.55) push(pick(sweets), 1);
    for (let n = 0; n < covers; n += 1) if (random() < 1.1) push(pick(drinks), 1);

    const order = open(counter, {
      table: seats[i], covers, guest: names[i], agoMin: openedAgo,
      by: random() < 0.5 ? captain : manager,
      lines,
    });

    // Fire everything, then bump it through at believable speeds.
    const kots = fireAgo(order, null, order.captainId === manager.id ? manager : captain,
      openedAgo - between(3, 7));
    for (const kot of kots) {
      const target = { BAR: 5, COLD: 8, TANDOOR: 15, HOT: 17, PASTRY: 10 }[kot.station] || 10;
      bump(order, kot, between(target - 3, target + 5), between(1, 4));
    }

    // A handful of bills carry the exceptions a manager wants to see reported.
    if (i === 3) {
      order.charges.discount = {
        mode: 'PCT', value: 10, reason: 'Loyalty / regular guest', approvedBy: manager.name,
      };
    }
    if (i === 7) {
      const line = order.lines.find((l) => l.status === KOT_STATUS.SERVED);
      if (line) {
        line.comp = true;
        line.compReason = 'Long wait';
        line.compBy = manager.name;
      }
    }
    if (i === 10) order.charges.serviceCharge = false;

    order.invoice = {
      number: 858 + i,
      code: `${NUMBERING.invoicePrefix}-${String(858 + i).padStart(4, '0')}`,
      at: Date.now() - (closedAgo + 3) * MIN,
      by: 'Devesh Kamat',
    };
    order.status = 'SETTLED';
    order.closedAt = Date.now() - closedAgo * MIN;
    order.payments = [{
      id: `pay_seed_${i}`,
      method: methods[i],
      paise: costOrder(order).total,
      at: order.closedAt,
      by: 'Devesh Kamat',
      ref: methods[i] === 'CARD' || methods[i] === 'UPI' ? `Ref ${700431 + i * 97}` : '',
    }];

    out.push(order);
  }
  // Newest first, the way the settled list reads.
  return out.sort((a, b) => b.closedAt - a.closedAt);
}

/* ------------------------------------------------------------ state --- */

export function buildInitialState() {
  let n = 141;
  const counter = { next: () => (n += 1) };
  const orders = [];

  /* --- Table 3 - four covers, starters away, mains still on the pad ------ */
  {
    const o = open(counter, {
      table: 't3', covers: 4, guest: 'Mr Iyer', agoMin: 24,
      lines: [
        ['m01', 1, 0], ['m02', 1, 0], ['m05', 1, 0],
        ['t01', 2, 1], ['n01', 1, 3], ['r01', 2, 0],
        ['b01', 2, 1], ['s03', 2, 3],
      ],
    });
    bump(o, at(fireAgo(o, 'BEVERAGE', captain, 21), 'BAR'), 4, 1);
    // Cold larder went in 18 minutes ago against an 8-minute target. This is
    // the first thing the kitchen display should be shouting about.
    fireAgo(o, 'STARTER', captain, 18);
    orders.push(o);
  }

  /* --- Table 6 - anniversary six, mains in, tandoor dying on the pass ---- */
  {
    const o = open(counter, {
      table: 't6', covers: 6, guest: 'Kapadia · anniversary', agoMin: 46,
      notes: 'Anniversary — candle with the dessert. No nuts for seat 4.',
      lines: [
        ['m10', 1, 0], ['m06', 1, 0], ['m03', 1, 0], ['m09', 1, 0],
        ['t02', 2, 1, mods('doneness', ['mrare'])],
        ['t05', 1, 2, mods('doneness', ['medium'])],
        ['n04', 1, 0, mods('portion', ['sharing'])],
        ['t07', 1, 4, [], 'No nuts — allergy'],
        ['r01', 2, 0], ['r04', 3, 0],
        ['b05', 4, 0], ['b02', 2, 0],
      ],
    });
    bump(o, at(fireAgo(o, 'BEVERAGE', captain, 43), 'BAR'), 5, 2);
    const starters = fireAgo(o, 'STARTER', captain, 40);
    bump(o, at(starters, 'COLD'), 7, 3);
    bump(o, at(starters, 'TANDOOR'), 9, 3);
    const mains = fireAgo(o, 'MAIN', captain, 26);
    // Plated eleven minutes ago and still sitting there. The room is one runner
    // short, and the kitchen display is the only thing that knows.
    bump(o, at(mains, 'TANDOOR'), 15, null);
    orders.push(o);
  }

  /* --- Table 7 - two covers, finished eating, will ask for the bill ------ */
  {
    const o = open(counter, {
      table: 't7', covers: 2, guest: 'Ms D’Souza', agoMin: 84,
      lines: [
        ['m02', 1, 0], ['t04', 1, 1], ['n02', 1, 2], ['r02', 1, 0],
        ['d03', 1, 0], ['b06', 2, 0], ['s04', 2, 0],
      ],
    });
    bump(o, at(fireAgo(o, 'BEVERAGE', captain, 81), 'BAR'), 4, 1);
    bump(o, at(fireAgo(o, 'STARTER', captain, 78), 'COLD'), 6, 2);
    const mains = fireAgo(o, 'MAIN', captain, 62);
    bump(o, at(mains, 'TANDOOR'), 14, 2);
    bump(o, at(mains, 'HOT'), 16, 3);
    bump(o, at(fireAgo(o, 'DESSERT', captain, 28), 'PASTRY'), 9, 2);
    orders.push(o);
  }

  /* --- Table 9 - corporate eight, bill printed, waiting to settle -------- */
  {
    const o = open(counter, {
      table: 't9', covers: 8, guest: 'Vantage Partners', agoMin: 118,
      lines: [
        ['m01', 2, 0], ['m04', 2, 0], ['m07', 2, 0], ['m08', 2, 0],
        ['t01', 3, 0], ['t03', 2, 0], ['t07', 2, 0], ['n03', 2, 0],
        ['r01', 3, 0], ['r04', 4, 0],
        ['d01', 2, 0], ['d04', 3, 0],
        ['b08', 6, 0], ['s06', 4, 0], ['s05', 5, 0],
      ],
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
    o.invoice = {
      number: 872,
      code: `${NUMBERING.invoicePrefix}-0872`,
      at: Date.now() - 5 * MIN,
      by: 'Devesh Kamat',
    };
    orders.push(o);
  }

  /* --- Terrace G2 - the captain is writing this at the table right now --- */
  {
    orders.push(open(counter, {
      table: 'g2', covers: 2, guest: 'Walk-in', agoMin: 6,
      lines: [['b01', 1, 1, mods('ice', ['up'])], ['b03', 1, 2], ['m09', 1, 0]],
    }));
  }

  /* --- Terrace G5 - mains cooking, dessert written but held back --------- */
  {
    const o = open(counter, {
      table: 'g5', covers: 5, guest: 'Sharma', agoMin: 38,
      lines: [
        ['m05', 1, 0], ['m01', 1, 0],
        ['t06', 1, 2], ['t01', 2, 3], ['n05', 1, 5], ['r03', 2, 0],
        ['d02', 3, 0], ['d05', 2, 0],
        ['s01', 3, 0], ['s02', 2, 0],
      ],
    });
    bump(o, at(fireAgo(o, 'BEVERAGE', captain, 35), 'BAR'), 5, 2);
    bump(o, at(fireAgo(o, 'STARTER', captain, 33), 'COLD'), 8, 2);
    // Mains went in twelve minutes ago and are still cooking. Dessert stays
    // held: nobody fires a dessert while the mains are on the grill.
    fireAgo(o, 'MAIN', captain, 12);
    orders.push(o);
  }

  /* --- Rose Room - private twelve, set menu, mains held for the call ----- */
  {
    const o = open(counter, {
      table: 'r1', covers: 12, guest: 'Mehta · engagement dinner', agoMin: 58,
      notes: 'Set menu. Fire the mains on the captain’s call only.',
      by: manager,
      lines: [
        ['m10', 2, 0], ['m01', 3, 0], ['m03', 3, 0], ['m06', 2, 0], ['m04', 3, 0],
        ['t02', 4, 0, mods('doneness', ['medium'])],
        ['n04', 2, 0], ['t07', 3, 0], ['r01', 4, 0], ['r04', 6, 0],
        ['d01', 4, 0], ['d03', 4, 0],
        ['b05', 8, 0], ['b07', 6, 0], ['s06', 6, 0],
      ],
    });
    bump(o, at(fireAgo(o, 'BEVERAGE', manager, 55), 'BAR'), 7, 3);
    bump(o, at(fireAgo(o, 'STARTER', manager, 50), 'COLD'), 12, 4);
    orders.push(o);
  }

  /* --- Bar B3 - two in, drinks and a mezze, all served ------------------- */
  {
    const o = open(counter, {
      table: 'b3', covers: 2, guest: 'Bar', agoMin: 28,
      lines: [['b01', 2, 0], ['b04', 1, 0], ['m01', 1, 0], ['m08', 1, 0]],
    });
    const kots = fireAgo(o, null, captain, 26);
    bump(o, at(kots, 'BAR'), 4, 1);
    bump(o, at(kots, 'COLD'), 7, 2);
    bump(o, at(kots, 'HOT'), 11, 2);
    orders.push(o);
  }

  const settled = buildSettledToday(counter);

  const today = new Date();
  return {
    schema: null, // stamped by the store
    bootedAt: Date.now(),
    businessDay: dayKey(today),
    session: null,
    orderSeq: n,
    invoiceSeq: 871 + settled.length,
    orders,
    settled,
    reservations: buildReservations(),
    /** Items taken off the menu tonight - the "86 board". */
    eightySix: [
      { itemId: 'b03', by: 'Farid Naqvi', at: Date.now() - 95 * MIN, note: 'Out of fresh egg white' },
    ],
    users: DEMO_USERS,
    /** Price and availability edits made in Settings, keyed by item id. */
    menuOverrides: {},
    activity: [
      { id: uid('a'), at: Date.now() - 5 * MIN, kind: 'BILL', by: 'Devesh Kamat', message: 'Bill printed for Table 9 · INV-0872' },
      { id: uid('a'), at: Date.now() - 61 * MIN, kind: 'VOID', by: 'Farid Naqvi', message: 'Voided 1 × Barg Fillet on Table 2 — guest changed order' },
      { id: uid('a'), at: Date.now() - 95 * MIN, kind: '86', by: 'Farid Naqvi', message: 'Saffron Sour marked 86 for the rest of service' },
    ],
    history: buildHistory(30, today),
  };
}

/**
 * The book.
 *
 * Times are relative to whenever the demo is opened rather than pinned to an
 * evening service, because a demo gets shown at eleven in the morning as often
 * as at eight at night, and a book full of bookings that were all two hours ago
 * makes the whole system look stale. The two parties already seated sit in the
 * past; everything else is still to walk in.
 */
function buildReservations() {
  const rows = [
    // [name, covers, minutes from now, table, status, note]
    ['Kapadia', 6, -46, 't6', 'SEATED', 'Anniversary — candle with dessert'],
    ['Mehta', 12, -58, 'r1', 'SEATED', 'Engagement dinner, set menu'],
    ['Ansari', 4, 20, 't5', 'CONFIRMED', 'Window table requested'],
    ['Dr Pinto', 2, 35, 't1', 'CONFIRMED', ''],
    ['Bhatia', 8, 50, 't10', 'CONFIRMED', 'One high chair'],
    ['Lobo', 2, 65, 'g1', 'CONFIRMED', 'Terrace, non-smoking'],
    ['Rao', 4, 80, 't2', 'CONFIRMED', 'Vegan — no dairy at all'],
    ['Fernandes', 2, 95, 'g6', 'CONFIRMED', ''],
  ];
  return rows.map(([name, covers, offsetMin, tableId, status, note], i) => {
    // Land each booking on a quarter hour, the way a book is actually kept.
    const at = new Date(Date.now() + offsetMin * MIN);
    at.setMinutes(Math.round(at.getMinutes() / 15) * 15, 0, 0);
    return {
      id: `res${i + 1}`,
      name,
      covers,
      at: at.getTime(),
      tableId,
      status,
      note,
      phone: `+91 98${20014477 + i * 13791}`,
    };
  });
}

export { MENU_ITEMS };
