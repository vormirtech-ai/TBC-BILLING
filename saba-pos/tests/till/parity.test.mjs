/**
 * The demonstration and the product must agree.
 *
 * The published demonstration runs the whole application against a till that
 * lives in the browser tab. A client clicks a link, is shown a bill, and
 * decides to buy on the strength of it — so if that bill differed by a single
 * paisa from the one their own restaurant would print, the demonstration
 * would be a lie dressed up as a feature.
 *
 * These tests run the same work through both and insist on the same answers.
 * The browser till is plain ES modules over the shared domain layer, so it
 * imports into Node unchanged and can be driven here exactly as a browser
 * drives it.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test } from '../run.mjs';

import { handle } from '../../app/src/net/till/index.js';
import { seedDemo } from '../../app/src/net/till/seed.js';
import * as tillStore from '../../app/src/net/till/store.js';
import { costOrder, useCharges } from '../../app/src/shared/pricing.js';
import { useFloorPlan } from '../../app/src/shared/floorplan.js';
import { buildWorkedExample } from '../../app/src/shared/worked-example.js';

let port = 9800 + Math.floor(Math.random() * 300);

/* ------------------------------------------------------- the two tills --- */

/** The real thing: a server, a database, HTTP. */
async function realTill() {
  const dir = mkdtempSync(join(tmpdir(), 'saba-parity-'));
  port += 1;

  const { start } = await import('../../server/main.js');
  const db = await import('../../server/db/index.js');
  const server = start({
    port, host: '127.0.0.1', dataDir: dir, setupPin: '7391',
    seedDemo: false, logLevel: 'error',
  });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  const base = `http://127.0.0.1:${port}`;
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(cookie ? { cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const raw of res.headers.getSetCookie?.() || []) cookie = raw.split(';')[0];
    return { status: res.status, json: await res.json().catch(() => null) };
  };

  const roster = await call('GET', '/api/session/staff');
  const manager = roster.json.staff.find((p) => p.name === 'Manager');
  await call('POST', '/api/session', { userId: manager.id, pin: '7391' });

  return {
    name: 'server',
    call,
    async stop() {
      await server.shutdown({ graceMs: 250 });
      try { db.closeDatabase(); } catch { /* already closed */ }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** The demonstration: the same module the published page loads. */
async function browserTill() {
  seedDemo();
  // Start from an empty floor so the two are comparing like with like.
  tillStore.db.orders = new Map();
  tillStore.db.reservations = new Map();
  tillStore.db.counters = { order: 0, invoice: 0 };
  tillStore.db.session = tillStore.db.users
    .map((u) => ({ id: u.id, name: u.name, role: u.role, initials: u.initials, active: true }))
    .find((u) => u.role === 'manager');

  const call = async (method, path, body) => {
    const res = handle(path, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };

  return { name: 'browser till', call, async stop() { /* nothing to close */ } };
}

/**
 * Drive one service through a till and report what it charged.
 *
 * Deliberately uses the awkward parts — a modifier, a comped line, a
 * discount needing approval, service charge removed, a part payment — because
 * those are where two implementations drift first.
 */
async function runService(till, { keepServiceCharge = true } = {}) {
  const state = (await till.call('GET', '/api/state')).json;
  const dishes = state.menu.filter((i) => i.available);
  const starter = dishes.find((i) => i.course === 'STARTER');
  const main = dishes.find((i) => i.course === 'MAIN' && i.modifierGroups?.length);
  const drink = dishes.find((i) => i.course === 'BEVERAGE');

  const seated = await till.call('POST', '/api/tables/t6/seat', { covers: 4, guestName: 'Parity' });
  const id = seated.json.order.id;

  await till.call('POST', `/api/orders/${id}/lines`, { itemId: starter.id, qty: 3, seat: 1 });
  // Both a free modifier and one that moves the price, since a modifier the
  // two sides priced differently is exactly the kind of drift to catch.
  await till.call('POST', `/api/orders/${id}/lines`, {
    itemId: main.id, qty: 2, seat: 2, modifierIds: ['mrare', 'sharing'],
  });
  await till.call('POST', `/api/orders/${id}/lines`, { itemId: drink.id, qty: 4 });
  await till.call('POST', `/api/orders/${id}/fire`, { course: 'STARTER' });

  // Comp the starter, then take 20% off — both need a manager's PIN.
  const before = (await till.call('GET', `/api/orders/${id}`)).json.order;
  const compLine = before.lines.find((l) => l.itemId === starter.id);
  await till.call('POST', `/api/orders/${id}/lines/${compLine.id}/comp`, {
    reason: 'Long wait', approverPin: till.name === 'server' ? '7391' : '1379',
  });
  await till.call('PATCH', `/api/orders/${id}/charges`, {
    discount: { mode: 'PCT', value: 20, reason: 'Regular guest' },
    approverPin: till.name === 'server' ? '7391' : '1379',
  });
  // One run keeps the service charge, the other drops it: a till that got the
  // service-charge rate wrong would otherwise hide behind a bill that has none.
  await till.call('PATCH', `/api/orders/${id}/charges`, {
    serviceCharge: keepServiceCharge, tip: 50000,
  });

  const { totals, order } = (await till.call('GET', `/api/orders/${id}`)).json;

  // Pay it off in two goes and settle.
  await till.call('POST', `/api/orders/${id}/payments`, { method: 'CASH', paise: 100000 });
  await till.call('POST', `/api/orders/${id}/payments`, {
    method: 'CARD', paise: totals.total - 100000,
  });
  const settled = await till.call('POST', `/api/orders/${id}/settle`);

  return {
    totals: {
      gross: totals.gross,
      comps: totals.comps,
      netItems: totals.netItems,
      discount: totals.discount,
      discounted: totals.discounted,
      serviceCharge: totals.serviceCharge,
      taxable: totals.taxable,
      taxes: totals.taxes.map((t) => ({ id: t.id, bps: t.bps, paise: t.paise })),
      taxTotal: totals.taxTotal,
      tip: totals.tip,
      roundOff: totals.roundOff,
      total: totals.total,
    },
    lines: order.lines.map((l) => ({
      name: l.name, qty: l.qty, unitPaise: l.unitPaise, comp: !!l.comp,
      modifiers: (l.modifiers || []).map((m) => `${m.label}:${m.deltaPaise}`),
    })),
    settledStatus: settled.status,
    invoice: !!settled.json?.order?.invoice,
  };
}

/* --------------------------------------------------------------- tests --- */

test('the demonstration bills a table exactly as the product does', async (t) => {
  const server = await realTill();
  let withCharge;
  let withoutCharge;
  try {
    withCharge = await runService(server, { keepServiceCharge: true });
    withoutCharge = await runService(server, { keepServiceCharge: false });
  } finally {
    await server.stop();
  }

  const browser = await browserTill();
  const demoWithCharge = await runService(browser, { keepServiceCharge: true });
  const demoWithoutCharge = await runService(browser, { keepServiceCharge: false });
  await browser.stop();

  t.equal(withCharge.settledStatus, 200, 'the server settled the bill');
  t.equal(demoWithCharge.settledStatus, 200, 'so did the demonstration');
  t.ok(withCharge.invoice && demoWithCharge.invoice, 'both raised an invoice number');

  t.deepEqual(demoWithCharge.lines, withCharge.lines,
    'the same dishes at the same prices, modifiers included');
  t.deepEqual(demoWithCharge.totals, withCharge.totals,
    'and every figure on the bill agrees to the paise');
  t.deepEqual(demoWithoutCharge.totals, withoutCharge.totals,
    'including on a bill the guest had the service charge taken off');

  // The figures have to be real ones, or the comparison proves nothing.
  t.ok(withCharge.totals.total > 0, 'the bill came to something');
  t.ok(withCharge.totals.serviceCharge > 0, 'the service charge was actually applied');
  t.ok(withCharge.totals.taxTotal > 0, 'and so was the tax');
  t.ok(withCharge.totals.comps > 0, 'the comped line was taken off');
  t.ok(withCharge.totals.discount > 0, 'and the discount was given');
  t.equal(withoutCharge.totals.serviceCharge, 0, 'the other bill carried none');
  t.ok(withCharge.totals.total !== withoutCharge.totals.total,
    'so the two runs are genuinely different bills');
});

test('the worked example is the same restaurant on both', async (t) => {
  const today = '2026-03-14';
  const users = {
    manager: { id: 'u_m', name: 'Manager', role: 'manager' },
    captain: { id: 'u_c', name: 'Alina Rahman', role: 'captain' },
    cashier: { id: 'u_x', name: 'Devesh Kamat', role: 'cashier' },
  };

  // The generator is shared, so building it twice must produce one restaurant.
  // Only the ids differ, because those are random by design.
  useCharges(null);
  useFloorPlan(null);
  const a = buildWorkedExample({ today, users, uid: () => 'id' });
  const b = buildWorkedExample({ today, users, uid: () => 'id' });

  const settledTotal = (example) => example.orders
    .filter((o) => o.status === 'SETTLED' && o.businessDay < today)
    .reduce((n, o) => n + costOrder(o).total, 0);

  t.equal(settledTotal(b), settledTotal(a),
    'a month of trading adds to the same figure every time it is built');
  t.ok(settledTotal(a) > 0, 'and that figure is not nothing');
  t.equal(b.counters.invoice, a.counters.invoice, 'the same bills were raised');
  t.equal(b.orders.length, a.orders.length, 'the same number of tables');

  const histA = a.orders.filter((o) => o.businessDay < today).map((o) => costOrder(o).total);
  const histB = b.orders.filter((o) => o.businessDay < today).map((o) => costOrder(o).total);
  t.deepEqual(histB, histA, 'bill for bill, the history is identical');
});

test('the demonstration refuses what the product refuses', async (t) => {
  const browser = await browserTill();

  const { id } = (await browser.call('POST', '/api/tables/t1/seat', { covers: 2 })).json.order;
  const state = (await browser.call('GET', '/api/state')).json;
  const dish = state.menu.find((i) => i.available);
  await browser.call('POST', `/api/orders/${id}/lines`, { itemId: dish.id, qty: 1 });

  // A heavy discount without a manager.
  const unapproved = await browser.call('PATCH', `/api/orders/${id}/charges`, {
    discount: { mode: 'PCT', value: 40, reason: 'Because' },
  });
  t.equal(unapproved.status, 403, 'a heavy discount still needs approval');

  // A wrong approver PIN.
  const wrongPin = await browser.call('PATCH', `/api/orders/${id}/charges`, {
    discount: { mode: 'PCT', value: 40, reason: 'Because' }, approverPin: '0000',
  });
  t.equal(wrongPin.status, 403, 'and the PIN has to be a real one');

  // Settling with nothing paid.
  const unpaid = await browser.call('POST', `/api/orders/${id}/settle`);
  t.equal(unpaid.status, 409, 'an unpaid bill cannot be settled');

  // Seating an occupied table.
  const taken = await browser.call('POST', '/api/tables/t1/seat', { covers: 2 });
  t.equal(taken.status, 409, 'a table cannot be seated twice');

  // A dish that is 86.
  await browser.call('POST', `/api/menu/${dish.id}/eighty-six`, { on: true });
  const off = await browser.call('POST', `/api/orders/${id}/lines`, { itemId: dish.id, qty: 1 });
  t.equal(off.status, 409, 'an 86 dish cannot be rung up');

  await browser.stop();
});

test('a role cannot reach past its screens in the demonstration either', async (t) => {
  const browser = await browserTill();

  const asRole = (role) => {
    const row = tillStore.db.users.find((u) => u.role === role);
    tillStore.db.session = {
      id: row.id, name: row.name, role: row.role, initials: row.initials, active: true,
    };
  };

  asRole('kitchen');
  t.equal((await browser.call('GET', '/api/state')).status, 200, 'the pass reads the room');
  t.equal((await browser.call('POST', '/api/tables/t8/seat', { covers: 2 })).status, 403,
    'the kitchen cannot seat a table');
  t.equal((await browser.call('GET', '/api/reports')).status, 403,
    'the kitchen cannot read the takings');
  t.equal((await browser.call('GET', '/api/users')).status, 403,
    'the kitchen cannot manage staff');

  asRole('captain');
  t.equal((await browser.call('POST', '/api/tables/t9/seat', { covers: 2 })).status, 200,
    'a captain seats tables');
  t.equal((await browser.call('GET', '/api/reports')).status, 403,
    'a captain does not see the takings');

  asRole('cashier');
  t.equal((await browser.call('GET', '/api/reports')).status, 200, 'a cashier reads reports');
  t.equal((await browser.call('POST', '/api/users', { name: 'X', role: 'manager', pin: '1928' })).status,
    403, 'but cannot create a manager');

  await browser.stop();
});

test('signed out, the demonstration gives nothing away', async (t) => {
  const browser = await browserTill();
  tillStore.db.session = null;

  for (const [method, path] of [
    ['GET', '/api/state'],
    ['GET', '/api/reports'],
    ['GET', '/api/users'],
    ['POST', '/api/tables/t1/seat'],
  ]) {
    const res = await browser.call(method, path, method === 'GET' ? undefined : {});
    t.equal(res.status, 401, `${method} ${path} is refused signed out`);
  }

  // The roster is open, as on the real till — names and roles, never a PIN.
  const roster = await browser.call('GET', '/api/session/staff');
  t.equal(roster.status, 200);
  t.notOk(/pin/i.test(JSON.stringify(roster.json)), 'no field mentioning a PIN');

  await browser.stop();
});
