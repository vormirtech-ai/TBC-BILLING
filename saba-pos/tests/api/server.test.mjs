/**
 * API tests.
 *
 * These run against a real server, on a real SQLite database, over real HTTP.
 * Nothing is mocked — a POS is a thing that takes money, and a test suite
 * that stubs out the database is a test suite that proves the stubs work.
 *
 * Each test gets a server of its own on a free port with an empty temporary
 * database, so they cannot contaminate each other and can be read in any
 * order. Starting one costs a few milliseconds, which is a fair price for
 * never having to wonder whether a failure is real.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test } from '../run.mjs';

/* ------------------------------------------------------------- harness --- */

let port = 9400 + Math.floor(Math.random() * 400);

/**
 * Start a server in this process with a throwaway database on a free port.
 *
 * One real server per test, started and stopped around it. The cost is a few
 * milliseconds; the gain is that a failure is never "did the last test leave
 * something behind".
 *
 * They run strictly one at a time — the server keeps a single database
 * connection, as a POS should — so `run()` executing suites in sequence is
 * what makes this safe.
 */
async function startServer({ demo = false, setupPin = '7391' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'saba-test-'));
  port += 1;

  const { start } = await import('../../server/main.js');
  const db = await import('../../server/db/index.js');
  const seed = await import('../../server/seed.js');

  const server = start({
    port,
    host: '127.0.0.1',
    dataDir: dir,
    setupPin,
    seedDemo: demo,
    logLevel: 'error',
    sessionHours: 14,
  });

  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  return {
    base: `http://127.0.0.1:${port}`,
    setupPin,
    async stop() {
      // The server's own shutdown, not a bare close: it hangs up idle
      // keep-alive sockets instead of waiting them out, and closes the
      // database. Using it here means the tests exercise the same path a
      // `systemctl stop` takes.
      await server.shutdown({ graceMs: 250 });
      try { db.closeDatabase(); } catch { /* already closed */ }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A client that keeps its own cookie, so several can share one server. */
function client(base) {
  let cookie = '';
  return async function call(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(cookie ? { cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const raw of res.headers.getSetCookie?.() || []) cookie = raw.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text, headers: res.headers };
  };
}

/** Run `fn` against a freshly started server, and always shut it down. */
async function withServer(options, fn) {
  const server = await startServer(options);
  try {
    await fn(server, client(server.base));
  } finally {
    await server.stop();
  }
}

/**
 * Sign a terminal in the way the lock screen does.
 *
 * Staff tap their name and then type their PIN, so a sign-in carries both.
 * That is what lets the server check exactly one password hash instead of
 * every member of staff's — the difference between an instant sign-in and a
 * two-second wait at the start of every shift.
 */
async function signIn(call, pin, name = 'Manager') {
  const roster = await call('GET', '/api/session/staff');
  const person = (roster.json?.staff || []).find((p) => p.name === name);
  return call('POST', '/api/session', { userId: person?.id, pin });
}

/* --------------------------------------------------------- the basics --- */

test('a fresh install answers, and refuses everything until you sign in', async (t) => {
  await withServer({}, async (server, call) => {
    const health = await call('GET', '/api/health');
    t.equal(health.status, 200);
    t.ok(health.json.ok);
    t.equal(health.json.app, 'Saba');

    for (const [method, path] of [
      ['GET', '/api/state'],
      ['POST', '/api/tables/t1/seat'],
      ['GET', '/api/reports'],
      ['GET', '/api/users'],
    ]) {
      const res = await call(method, path, method === 'GET' ? undefined : {});
      t.equal(res.status, 401, `${method} ${path} is refused signed out`);
    }
  });
});

test('the staff list never carries a PIN', async (t) => {
  await withServer({}, async (server, call) => {
    const res = await call('GET', '/api/session/staff');
    t.equal(res.status, 200);
    t.ok(res.json.staff.length >= 1);
    const serialised = JSON.stringify(res.json);
    t.notOk(/pin/i.test(serialised), 'no field mentioning a PIN');
    t.notOk(serialised.includes(server.setupPin), 'the PIN itself does not appear');
  });
});

test('signing in with the right PIN works, and a wrong one does not', async (t) => {
  await withServer({}, async (server, call) => {
    const bad = await signIn(call, '9999');
    t.equal(bad.status, 401);

    const good = await signIn(call, server.setupPin);
    t.equal(good.status, 200);
    t.equal(good.json.user.role, 'manager');

    const who = await call('GET', '/api/session');
    t.equal(who.status, 200);
    t.equal(who.json.user.role, 'manager');
  });
});

test('a sign-in has to say who it is for', async (t) => {
  await withServer({}, async (server, call) => {
    const nameless = await call('POST', '/api/session', { pin: server.setupPin });
    t.equal(nameless.status, 400, 'the right PIN alone is not a sign-in');

    // An id nobody holds is refused the same way a wrong PIN is, and takes
    // about as long, so a stopwatch cannot be used to enumerate accounts.
    const ghost = await call('POST', '/api/session',
      { userId: 'u_nobody', pin: server.setupPin });
    t.equal(ghost.status, 401, 'an unknown account looks exactly like a wrong PIN');
    t.notOk(/unknown|no such|exist/i.test(ghost.json?.error || ''),
      'and the message does not say which it was');
  });
});

test('a run of wrong PINs locks the terminal out', async (t) => {
  await withServer({}, async (server, call) => {
    let locked = false;
    for (let i = 0; i < 8; i += 1) {
      const res = await signIn(call, '9876');
      if (res.status === 429) { locked = true; break; }
    }
    t.ok(locked, 'a brute-force run is stopped');

    // And the lockout is real: the correct PIN is refused too, for now.
    const correct = await signIn(call, server.setupPin);
    t.equal(correct.status, 429, 'even the right PIN waits out the lockout');
  });
});

test('signing out really ends the session', async (t) => {
  await withServer({}, async (server, call) => {
    await signIn(call, server.setupPin);
    t.equal((await call('GET', '/api/state')).status, 200);
    t.equal((await call('DELETE', '/api/session')).status, 200);
    t.equal((await call('GET', '/api/state')).status, 401);
  });
});

/* -------------------------------------------------------- taking money --- */

test('a table can be seated, ordered, fired, billed and settled', async (t) => {
  await withServer({}, async (server, call) => {
    await signIn(call, server.setupPin);

    const state = (await call('GET', '/api/state')).json;
    t.equal(state.orders.length, 0, 'a fresh install has an empty floor');
    t.ok(state.menu.length > 10, 'the carte is loaded');

    const seated = await call('POST', '/api/tables/t1/seat', { covers: 2, guestName: 'Test' });
    t.equal(seated.status, 200);
    const id = seated.json.order.id;
    t.equal(seated.json.order.covers, 2);

    // The same table cannot be opened twice.
    const again = await call('POST', '/api/tables/t1/seat', { covers: 4 });
    t.equal(again.status, 409, 'a second party cannot be sat on an open table');

    const dish = state.menu.find((i) => i.category === 'mains' && i.available);
    const added = await call('POST', `/api/orders/${id}/lines`, {
      itemId: dish.id, qty: 2, seat: 1,
    });
    t.equal(added.status, 200);
    t.equal(added.json.order.lines.length, 1);
    t.equal(added.json.order.lines[0].qty, 2);
    t.equal(added.json.order.lines[0].unitPaise, dish.pricePaise,
      'the price comes from the server, not the request');

    const fired = await call('POST', `/api/orders/${id}/fire`, {});
    t.equal(fired.status, 200);
    t.equal(fired.json.kots.length, 1);
    t.equal(fired.json.order.lines[0].status, 'FIRED');

    // Settling before paying is refused, with the amount still owed.
    const early = await call('POST', `/api/orders/${id}/settle`);
    t.equal(early.status, 409);
    t.ok(/still/i.test(early.json.error), early.json.error);

    const totals = (await call('GET', `/api/orders/${id}`)).json.totals;
    t.ok(totals.total > 0);

    await call('POST', `/api/orders/${id}/payments`, {
      method: 'CARD', paise: totals.total,
    });
    const settled = await call('POST', `/api/orders/${id}/settle`);
    t.equal(settled.status, 200);
    t.equal(settled.json.order.status, 'SETTLED');
    t.ok(settled.json.order.invoice.code.startsWith('INV-'));

    // And the table is free again.
    const after = (await call('GET', '/api/state')).json;
    t.equal(after.orders.length, 0);
    t.equal(after.settled.length, 1);
  });
});

test('a client cannot invent its own prices', async (t) => {
  await withServer({}, async (server, call) => {
    await signIn(call, server.setupPin);
    const state = (await call('GET', '/api/state')).json;
    const dish = state.menu.find((i) => i.available);
    const { id } = (await call('POST', '/api/tables/t2/seat', { covers: 2 })).json.order;

    const added = await call('POST', `/api/orders/${id}/lines`, {
      itemId: dish.id,
      qty: 1,
      // Everything a hostile client might try to smuggle in.
      unitPaise: 1,
      pricePaise: 1,
      modifiers: [{ id: 'free', label: 'Free', deltaPaise: -999999 }],
      modifierIds: ['nonexistent-option'],
    });
    t.equal(added.status, 200);
    const line = added.json.order.lines[0];
    t.equal(line.unitPaise, dish.pricePaise, 'the catalogue price wins');
    t.equal(line.modifiers.length, 0, 'an unknown modifier is dropped, not priced');
  });
});

test('a restaurant sets its own service charge and tax, and the bill follows', async (t) => {
  await withServer({}, async (server, call) => {
    await signIn(call, server.setupPin);

    // 5% GST as one line, no service charge, no rounding: a perfectly
    // ordinary configuration that the shipped defaults are not.
    const saved = await call('PATCH', '/api/settings', {
      charges: {
        serviceChargePercent: 0,
        taxComponents: [{ id: 'GST', label: 'GST', bps: 500 }],
        roundOffEnabled: false,
        discountApprovalPercent: 10,
      },
    });
    t.equal(saved.status, 200);
    t.equal(saved.json.settings.charges.serviceChargeBps, 0);

    const state = (await call('GET', '/api/state')).json;
    const dish = state.menu.find((i) => i.available && i.pricePaise % 100 === 0);
    const { id } = (await call('POST', '/api/tables/t2/seat', { covers: 2 })).json.order;
    await call('POST', `/api/orders/${id}/lines`, { itemId: dish.id, qty: 2 });

    const totals = (await call('GET', `/api/orders/${id}`)).json.totals;
    const net = dish.pricePaise * 2;
    t.equal(totals.serviceCharge, 0, 'no service charge is added');
    t.equal(totals.taxes.length, 1, 'one tax line');
    t.equal(totals.taxes[0].label, 'GST');
    t.equal(totals.taxTotal, Math.round(net * 0.05), 'taxed at the rate the owner set');
    t.equal(totals.total, net + Math.round(net * 0.05), 'and that is what is payable');

    // The new threshold is enforced too: 12% now needs a manager.
    const over = await call('PATCH', `/api/orders/${id}/charges`,
      { discount: { mode: 'PCT', value: 12, reason: 'Regular' } });
    t.equal(over.status, 403, 'a discount above the new threshold needs approval');
  });
});

test('a tariff that would be a typo is refused', async (t) => {
  await withServer({}, async (server, call) => {
    await signIn(call, server.setupPin);

    for (const [charges, why] of [
      [{ serviceChargePercent: 250 }, 'a service charge of 250%'],
      [{ taxComponents: [{ label: 'GST', bps: 90000 }] }, 'tax at 900%'],
      [{ taxComponents: [{ label: '', bps: 500 }] }, 'a tax line with no name'],
      [{ taxComponents: [{ label: 'GST', bps: 500 }, { label: 'GST', bps: 500 }] },
        'two tax lines with one name'],
      [{ discountApprovalPercent: -5 }, 'a negative approval threshold'],
    ]) {
      const res = await call('PATCH', '/api/settings', { charges });
      t.equal(res.status, 400, `${why} is refused`);
    }

    // And nothing was stored: the rates are still the ones we started with.
    const now = (await call('GET', '/api/settings')).json.settings.charges;
    t.equal(now.serviceChargeBps, 1000);
    t.equal(now.taxComponents.length, 2);
  });
});

test('quantities are clamped to something a kitchen could cook', async (t) => {
  await withServer({}, async (server, call) => {
    await signIn(call, server.setupPin);
    const state = (await call('GET', '/api/state')).json;
    const dish = state.menu.find((i) => i.available);
    const { id } = (await call('POST', '/api/tables/t3/seat', { covers: 2 })).json.order;

    const huge = await call('POST', `/api/orders/${id}/lines`, {
      itemId: dish.id, qty: 100000,
    });
    t.ok(huge.json.order.lines[0].qty <= 99, 'an absurd quantity is clamped');

    const negative = await call('POST', `/api/orders/${id}/lines`, {
      itemId: dish.id, qty: -5, seat: 2,
    });
    t.ok(negative.json.order.lines.every((l) => l.qty >= 1), 'no negative quantities');
  });
});

test('a restaurant puts its own dishes on the carte, and takes them off', async (t) => {
  await withServer({}, async (server, call) => {
    await signIn(call, server.setupPin);

    const made = await call('POST', '/api/menu', {
      name: 'Lamb Shank Harissa',
      category: 'mains',
      station: 'HOT',
      course: 'MAIN',
      pricePaise: 92000,
      costPaise: 28000,
      description: 'Braised eight hours',
      diet: 'NON_VEG',
    });
    t.equal(made.status, 201);
    const dish = made.json.item;
    t.equal(dish.name, 'Lamb Shank Harissa');
    t.equal(dish.pricePaise, 92000);
    t.ok(dish.available, 'and it is orderable straight away');

    // It is on the carte every terminal reads.
    const onCarte = (await call('GET', '/api/state')).json.menu.find((i) => i.id === dish.id);
    t.ok(onCarte, 'the new dish reaches the working set');

    // A second dish of the same name gets its own id rather than overwriting.
    const twin = await call('POST', '/api/menu', {
      name: 'Lamb Shank Harissa', category: 'mains', station: 'HOT', course: 'MAIN',
      pricePaise: 92000,
    });
    t.equal(twin.status, 201);
    t.notOk(twin.json.item.id === dish.id, 'two dishes never share an id');

    // Somewhere it cannot be cooked is refused.
    const nowhere = await call('POST', '/api/menu', {
      name: 'Nowhere', category: 'mains', station: 'MARS', course: 'MAIN', pricePaise: 100,
    });
    t.equal(nowhere.status, 400);

    // Sell one, then take the dish off the menu.
    const { id } = (await call('POST', '/api/tables/t4/seat', { covers: 2 })).json.order;
    await call('POST', `/api/orders/${id}/lines`, { itemId: dish.id, qty: 1 });

    const retired = await call('PATCH', `/api/menu/${dish.id}`, { active: false });
    t.equal(retired.status, 200);
    t.notOk(retired.json.item.available, 'it is no longer orderable');

    // But the order that already has it still knows what was eaten and what
    // it cost, which is the whole reason a dish is retired and not deleted.
    const order = (await call('GET', `/api/orders/${id}`)).json.order;
    t.equal(order.lines[0].name, 'Lamb Shank Harissa');
    t.equal(order.lines[0].unitPaise, 92000);

    // And it cannot be ordered again.
    const again = await call('POST', `/api/orders/${id}/lines`, { itemId: dish.id, qty: 1 });
    t.ok(again.status >= 400, 'a dish off the menu cannot be rung up');
  });
});

test('an 86 dish cannot be ordered anywhere in the building', async (t) => {
  await withServer({}, async (server, call) => {
    await signIn(call, server.setupPin);
    const state = (await call('GET', '/api/state')).json;
    const dish = state.menu.find((i) => i.available);
    const { id } = (await call('POST', '/api/tables/t4/seat', { covers: 2 })).json.order;

    const off = await call('POST', `/api/menu/${dish.id}/eighty-six`, {
      on: true, note: 'Ran out',
    });
    t.equal(off.status, 200);
    t.ok(off.json.item.eightySixed);

    const refused = await call('POST', `/api/orders/${id}/lines`, { itemId: dish.id, qty: 1 });
    t.equal(refused.status, 409);
    t.ok(/86/.test(refused.json.error), refused.json.error);

    await call('POST', `/api/menu/${dish.id}/eighty-six`, { on: false });
    const allowed = await call('POST', `/api/orders/${id}/lines`, { itemId: dish.id, qty: 1 });
    t.equal(allowed.status, 200, 'and it is orderable again once it is back on');
  });
});

/* -------------------------------------------------------- authorisation --- */

test('a void needs a manager PIN and a reason, and both are recorded', async (t) => {
  await withServer({}, async (server, call) => {
    await signIn(call, server.setupPin);
    const state = (await call('GET', '/api/state')).json;
    const dish = state.menu.find((i) => i.available);
    const { id } = (await call('POST', '/api/tables/t5/seat', { covers: 2 })).json.order;
    const lineId = (await call('POST', `/api/orders/${id}/lines`,
      { itemId: dish.id, qty: 1 })).json.order.lines[0].id;
    await call('POST', `/api/orders/${id}/fire`, {});

    const noPin = await call('POST', `/api/orders/${id}/lines/${lineId}/void`,
      { reason: 'Guest changed order' });
    t.equal(noPin.status, 403, 'no approval, no void');

    const wrongPin = await call('POST', `/api/orders/${id}/lines/${lineId}/void`,
      { reason: 'Guest changed order', approverPin: '0001' });
    t.equal(wrongPin.status, 401, 'a wrong PIN is not an approval');

    const noReason = await call('POST', `/api/orders/${id}/lines/${lineId}/void`,
      { approverPin: server.setupPin });
    t.equal(noReason.status, 400, 'a void without a reason is a hole in the figures');

    const done = await call('POST', `/api/orders/${id}/lines/${lineId}/void`,
      { reason: 'Guest changed order', approverPin: server.setupPin });
    t.equal(done.status, 200);
    const voided = done.json.order.lines.find((l) => l.id === lineId);
    t.equal(voided.status, 'VOID');
    t.equal(voided.voidReason, 'Guest changed order');
    t.equal(voided.voidBy, 'Manager', 'the approver is named, not the person who asked');

    const audit = (await call('GET', '/api/audit')).json.entries;
    const entry = audit.find((a) => a.kind === 'VOID');
    t.ok(entry, 'the void is in the audit log');
    t.equal(entry.actor, 'Manager');
  });
});

test('a heavy discount needs approval; a light one does not', async (t) => {
  await withServer({}, async (server, call) => {
    await signIn(call, server.setupPin);
    const state = (await call('GET', '/api/state')).json;
    const dish = state.menu.find((i) => i.available);
    const { id } = (await call('POST', '/api/tables/t6/seat', { covers: 2 })).json.order;
    await call('POST', `/api/orders/${id}/lines`, { itemId: dish.id, qty: 4 });

    const small = await call('PATCH', `/api/orders/${id}/charges`, {
      discount: { mode: 'PCT', value: 10, reason: 'Regular guest' },
    });
    t.equal(small.status, 200, 'a manager can give 10% without a second PIN');

    const big = await call('PATCH', `/api/orders/${id}/charges`, {
      discount: { mode: 'PCT', value: 50, reason: 'Because' },
    });
    t.equal(big.status, 403, '50% needs approving');

    const approved = await call('PATCH', `/api/orders/${id}/charges`, {
      discount: { mode: 'PCT', value: 50, reason: 'Service recovery' },
      approverPin: server.setupPin,
    });
    t.equal(approved.status, 200);
    t.equal(approved.json.order.charges.discount.value, 50);
  });
});

test('a discount can never take a bill below nothing', async (t) => {
  await withServer({}, async (server, call) => {
    await signIn(call, server.setupPin);
    const state = (await call('GET', '/api/state')).json;
    const dish = state.menu.find((i) => i.available);
    const { id } = (await call('POST', '/api/tables/t7/seat', { covers: 2 })).json.order;
    await call('POST', `/api/orders/${id}/lines`, { itemId: dish.id, qty: 1 });

    await call('PATCH', `/api/orders/${id}/charges`, {
      discount: { mode: 'FLAT', value: 9999999, reason: 'Service recovery' },
      approverPin: server.setupPin,
    });
    const totals = (await call('GET', `/api/orders/${id}`)).json.totals;
    t.ok(totals.total >= 0, `total was ${totals.total}`);
    t.equal(totals.discounted, 0);
  });
});

/* ----------------------------------------------------------- the room --- */

test('a restaurant lays out its own room', async (t) => {
  await withServer({}, async (server, call) => {
    await signIn(call, server.setupPin);

    const before = (await call('GET', '/api/state')).json;
    t.ok(before.tables.length > 1, 'the worked example comes with a room');
    t.ok(before.sections.length > 1, 'in more than one part');

    // A room of its own, with two tables in it.
    const saved = await call('PATCH', '/api/settings', {
      floorplan: {
        sections: [{ id: 'veranda', label: 'The Veranda', short: 'Veranda', note: 'Six covers' }],
        tables: [
          { id: 'v1', label: '1', sectionId: 'veranda', seats: 2, x: 20, y: 20 },
          { id: 'v2', label: '2', sectionId: 'veranda', seats: 4, x: 60, y: 20, shape: 'long' },
        ],
      },
    });
    t.equal(saved.status, 200);

    const after = (await call('GET', '/api/state')).json;
    t.equal(after.tables.length, 2, 'the room is the one the restaurant set');
    t.equal(after.sections[0].label, 'The Veranda');

    // And it is a real floor: the new tables can be seated.
    const seated = await call('POST', '/api/tables/v2/seat', { covers: 4 });
    t.equal(seated.status, 200);
    t.equal(seated.json.order.tableLabel, '2');

    // A table with people at it cannot be taken away under them.
    const strand = await call('PATCH', '/api/settings', {
      floorplan: {
        sections: [{ id: 'veranda', label: 'The Veranda' }],
        tables: [{ id: 'v1', label: '1', sectionId: 'veranda', seats: 2 }],
      },
    });
    t.equal(strand.status, 409, 'the occupied table stays on the plan');
    t.equal((await call('GET', '/api/state')).json.tables.length, 2, 'and nothing changed');
  });
});

test('a floor plan that makes no sense is refused', async (t) => {
  await withServer({}, async (server, call) => {
    await signIn(call, server.setupPin);

    for (const [floorplan, why] of [
      [{ sections: [], tables: [] }, 'a restaurant with no rooms'],
      [{ sections: [{ label: 'Hall' }], tables: [{ label: '1', sectionId: 'nowhere', seats: 2 }] },
        'a table in a room that does not exist'],
      [{ sections: [{ label: 'Hall' }], tables: [{ label: '1', sectionId: 'hall', seats: 0 }] },
        'a table nobody can sit at'],
      [{ sections: [{ label: 'Hall' }], tables: [{ label: '', sectionId: 'hall', seats: 2 }] },
        'a table with no number'],
      [{ sections: [{ label: 'Hall' }, { label: 'Hall' }], tables: [] },
        'two rooms with one name'],
    ]) {
      const res = await call('PATCH', '/api/settings', { floorplan });
      t.ok(res.status === 400 || res.status === 409, `${why} is refused`);
    }
  });
});

/* ---------------------------------------------------------------- roles --- */

test('each role can reach exactly what it should', async (t) => {
  await withServer({}, async (server, call) => {
    await signIn(call, server.setupPin);
    await call('POST', '/api/users', { name: 'Kitchen', role: 'kitchen', pin: '8261' });
    await call('POST', '/api/users', { name: 'Captain', role: 'captain', pin: '8372' });
    await call('POST', '/api/users', { name: 'Cashier', role: 'cashier', pin: '8483' });

    const kitchen = client(server.base);
    await signIn(kitchen, '8261', 'Kitchen');
    t.equal((await kitchen('GET', '/api/state')).status, 200, 'the pass reads the room');
    t.equal((await kitchen('POST', '/api/tables/t8/seat', { covers: 2 })).status, 403,
      'the kitchen cannot seat a table');
    t.equal((await kitchen('GET', '/api/users')).status, 403,
      'the kitchen cannot manage staff');
    t.equal((await kitchen('POST', '/api/backup')).status, 403,
      'the kitchen cannot take a backup');
    t.equal((await kitchen('GET', '/api/reports')).status, 403,
      'the kitchen cannot read the takings');

    const captain = client(server.base);
    await signIn(captain, '8372', 'Captain');
    t.equal((await captain('POST', '/api/tables/t9/seat', { covers: 2 })).status, 200,
      'a captain seats tables');
    t.equal((await captain('GET', '/api/reports')).status, 403,
      'a captain does not see the takings');
    t.equal((await captain('GET', '/api/users')).status, 403);

    const cashier = client(server.base);
    await signIn(cashier, '8483', 'Cashier');
    t.equal((await cashier('GET', '/api/reports')).status, 200, 'a cashier reads reports');
    t.equal((await cashier('GET', '/api/export/sales.csv')).status, 200,
      'and can export them');
    t.equal((await cashier('POST', '/api/users', { name: 'X', role: 'manager', pin: '1928' })).status,
      403, 'but cannot create a manager');
  });
});

test('a cashier cannot promote themselves by editing their own account', async (t) => {
  await withServer({}, async (server, call) => {
    await signIn(call, server.setupPin);
    const made = await call('POST', '/api/users', { name: 'Cash', role: 'cashier', pin: '8594' });
    const cashierId = made.json.user.id;

    const cashier = client(server.base);
    await signIn(cashier, '8594', 'Cash');
    const attempt = await cashier('PATCH', `/api/users/${cashierId}`, { role: 'manager' });
    t.equal(attempt.status, 403);
  });
});

test('the last manager cannot be demoted or switched off', async (t) => {
  await withServer({}, async (server, call) => {
    await signIn(call, server.setupPin);
    const me = (await call('GET', '/api/session')).json.user;

    const demote = await call('PATCH', `/api/users/${me.id}`, { role: 'cashier' });
    t.equal(demote.status, 409, 'that would lock everybody out of Setup');

    const disable = await call('PATCH', `/api/users/${me.id}`, { active: false });
    t.equal(disable.status, 409);
  });
});

test('two people cannot share a PIN', async (t) => {
  await withServer({}, async (server, call) => {
    await signIn(call, server.setupPin);
    const first = await call('POST', '/api/users', { name: 'A', role: 'captain', pin: '8605' });
    t.equal(first.status, 200);
    const clash = await call('POST', '/api/users', { name: 'B', role: 'captain', pin: '8605' });
    t.equal(clash.status, 409, 'because staff sign in by PIN alone');
  });
});

test('a guessable PIN is refused', async (t) => {
  await withServer({}, async (server, call) => {
    await signIn(call, server.setupPin);
    for (const pin of ['1111', '0000', '1234', '4321', '12', 'abcd']) {
      const res = await call('POST', '/api/users', { name: 'X', role: 'captain', pin });
      t.equal(res.status, 400, `${pin} is refused`);
    }
  });
});

/* ------------------------------------------------------------- the day --- */

test('the day report reconciles the drawer', async (t) => {
  await withServer({}, async (server, call) => {
    await signIn(call, server.setupPin);
    const state = (await call('GET', '/api/state')).json;
    const dish = state.menu.find((i) => i.available);

    await call('POST', '/api/shift/open', { floatPaise: 200000 }); // ₹2,000 float

    // One bill paid in cash, one on a card.
    for (const [table, method] of [['t1', 'CASH'], ['t2', 'CARD']]) {
      const { id } = (await call('POST', `/api/tables/${table}/seat`, { covers: 2 })).json.order;
      await call('POST', `/api/orders/${id}/lines`, { itemId: dish.id, qty: 2 });
      const totals = (await call('GET', `/api/orders/${id}`)).json.totals;
      await call('POST', `/api/orders/${id}/payments`, { method, paise: totals.total });
      await call('POST', `/api/orders/${id}/settle`);
    }

    const day = (await call('GET', `/api/reports/day/${state.businessDay}`)).json;
    t.equal(day.totals.bills, 2);
    t.equal(day.totals.covers, 4);

    const cashTender = day.tenders.find((x) => x.method === 'CASH');
    const cardTender = day.tenders.find((x) => x.method === 'CARD');
    t.ok(cashTender.countsToDrawer, 'cash is in the drawer');
    t.notOk(cardTender.countsToDrawer, 'a card payment is not');

    t.equal(day.cash.floatPaise, 200000);
    t.equal(day.cash.takenPaise, cashTender.paise, 'only the cash counts toward the drawer');
    t.equal(day.cash.expectedPaise, 200000 + cashTender.paise);
    t.equal(day.cash.countedPaise, null, 'nothing counted yet');

    // Count it two hundred rupees light and check the variance is stated.
    const short = day.cash.expectedPaise - 20000;
    await call('POST', '/api/shift/close', { countedPaise: short, note: 'Two notes missing' });

    const closed = (await call('GET', `/api/reports/day/${state.businessDay}`)).json;
    t.equal(closed.cash.countedPaise, short);
    t.equal(closed.cash.variancePaise, -20000, 'short by exactly two hundred rupees');
  });
});

test('every settled bill appears in the sales export, and it adds up', async (t) => {
  await withServer({}, async (server, call) => {
    await signIn(call, server.setupPin);
    const state = (await call('GET', '/api/state')).json;
    const dish = state.menu.find((i) => i.available);

    let expected = 0;
    for (const table of ['t1', 't2', 't3']) {
      const { id } = (await call('POST', `/api/tables/${table}/seat`, { covers: 2 })).json.order;
      await call('POST', `/api/orders/${id}/lines`, { itemId: dish.id, qty: 2 });
      const totals = (await call('GET', `/api/orders/${id}`)).json.totals;
      expected += totals.total;
      await call('POST', `/api/orders/${id}/payments`, { method: 'UPI', paise: totals.total });
      await call('POST', `/api/orders/${id}/settle`);
    }

    const csv = await call('GET', `/api/export/sales.csv?from=${state.businessDay}&to=${state.businessDay}`);
    t.equal(csv.status, 200);
    const rows = csv.text.trim().split('\r\n');
    t.equal(rows.length, 4, 'a header and three bills');
    t.ok(rows[0].includes('Invoice'), 'the header names its columns');

    // The Total column, summed, must match what the till took.
    const header = rows[0].replace('\ufeff', '').split(',');
    const totalColumn = header.indexOf('Total');
    const summed = rows.slice(1)
      .reduce((n, row) => n + Math.round(Number(row.split(',')[totalColumn]) * 100), 0);
    t.equal(summed, expected, 'the export reconciles to the day report');

    const gst = await call('GET', `/api/export/gst.csv?from=${state.businessDay}&to=${state.businessDay}`);
    t.equal(gst.status, 200);
    t.ok(gst.text.includes('CGST'), 'the GST export names its components');
  });
});

/* --------------------------------------------------------- consistency --- */

test('the revision moves on every change, so terminals know to catch up', async (t) => {
  await withServer({}, async (server, call) => {
    await signIn(call, server.setupPin);
    const before = (await call('GET', '/api/health')).json.revision;
    await call('POST', '/api/tables/t1/seat', { covers: 2 });
    const after = (await call('GET', '/api/health')).json.revision;
    t.ok(after > before, `revision went ${before} -> ${after}`);
  });
});

test('a settled bill is closed to further changes', async (t) => {
  await withServer({}, async (server, call) => {
    await signIn(call, server.setupPin);
    const state = (await call('GET', '/api/state')).json;
    const dish = state.menu.find((i) => i.available);
    const { id } = (await call('POST', '/api/tables/t1/seat', { covers: 2 })).json.order;
    await call('POST', `/api/orders/${id}/lines`, { itemId: dish.id, qty: 1 });
    const totals = (await call('GET', `/api/orders/${id}`)).json.totals;
    await call('POST', `/api/orders/${id}/payments`, { method: 'CASH', paise: totals.total });
    await call('POST', `/api/orders/${id}/settle`);

    const late = await call('POST', `/api/orders/${id}/lines`, { itemId: dish.id, qty: 1 });
    t.equal(late.status, 409, 'nothing goes onto a bill that has been paid');

    const twice = await call('POST', `/api/orders/${id}/settle`);
    t.equal(twice.status, 409, 'and it cannot be settled again');
  });
});

test('printing a bill twice does not take a second invoice number', async (t) => {
  await withServer({}, async (server, call) => {
    await signIn(call, server.setupPin);
    const state = (await call('GET', '/api/state')).json;
    const dish = state.menu.find((i) => i.available);
    const { id } = (await call('POST', '/api/tables/t1/seat', { covers: 2 })).json.order;
    await call('POST', `/api/orders/${id}/lines`, { itemId: dish.id, qty: 1 });

    const first = await call('POST', `/api/orders/${id}/invoice`);
    const second = await call('POST', `/api/orders/${id}/invoice`);
    t.equal(first.json.order.invoice.code, second.json.order.invoice.code);
  });
});

test('two terminals settling the same table at once produce one bill', async (t) => {
  await withServer({}, async (server, call) => {
    await signIn(call, server.setupPin);
    const state = (await call('GET', '/api/state')).json;
    const dish = state.menu.find((i) => i.available);
    const { id } = (await call('POST', '/api/tables/t1/seat', { covers: 2 })).json.order;
    await call('POST', `/api/orders/${id}/lines`, { itemId: dish.id, qty: 1 });
    const totals = (await call('GET', `/api/orders/${id}`)).json.totals;
    await call('POST', `/api/orders/${id}/payments`, { method: 'CASH', paise: totals.total });

    // Two cashiers hitting Close at the same moment.
    const a = client(server.base);
    const b = client(server.base);
    await signIn(a, server.setupPin);
    await signIn(b, server.setupPin);

    const [one, two] = await Promise.all([
      a('POST', `/api/orders/${id}/settle`),
      b('POST', `/api/orders/${id}/settle`),
    ]);
    const statuses = [one.status, two.status].sort();
    t.deepEqual(statuses, [200, 409], 'exactly one of them wins');
  });
});

test('invoice numbers are unique even under concurrent billing', async (t) => {
  await withServer({}, async (server, call) => {
    await signIn(call, server.setupPin);
    const state = (await call('GET', '/api/state')).json;
    const dish = state.menu.find((i) => i.available);

    const ids = [];
    for (const table of ['t1', 't2', 't3', 't4', 't5', 't6']) {
      const { id } = (await call('POST', `/api/tables/${table}/seat`, { covers: 2 })).json.order;
      await call('POST', `/api/orders/${id}/lines`, { itemId: dish.id, qty: 1 });
      ids.push(id);
    }

    // Six terminals print six bills simultaneously.
    const results = await Promise.all(ids.map((id) => {
      const terminal = client(server.base);
      return signIn(terminal, server.setupPin)
        .then(() => terminal('POST', `/api/orders/${id}/invoice`));
    }));

    const codes = results.map((r) => r.json.order.invoice.code);
    t.equal(new Set(codes).size, codes.length, `duplicates in ${codes.join(', ')}`);
  });
});

/* -------------------------------------------------------- the live link --- */

test('a terminal is told the revision over the event stream', async (t) => {
  await withServer({}, async (server, call) => {
    await signIn(call, server.setupPin);

    // Grab the cookie the client is holding by replaying a request.
    const probe = await fetch(`${server.base}/api/session/staff`);
    t.equal(probe.status, 200);

    // Open the stream with the same session, read the greeting, then make a
    // change and read the broadcast that follows.
    const jar = await call('GET', '/api/session');
    t.equal(jar.status, 200);

    const controller = new AbortController();
    const stream = await fetch(`${server.base}/api/events`, {
      headers: { cookie: await cookieFor(server, call) },
      signal: controller.signal,
    });
    t.equal(stream.status, 200);
    t.ok(stream.headers.get('content-type').includes('text/event-stream'));

    const reader = stream.body.getReader();
    const decoder = new TextDecoder();
    const readFrame = async () => {
      const { value } = await reader.read();
      return decoder.decode(value);
    };

    const hello = await readFrame();
    t.ok(hello.includes('retry:') || hello.includes('hello'), 'the stream opens with a greeting');

    await call('POST', '/api/tables/t1/seat', { covers: 2 });

    let sawRevision = false;
    for (let i = 0; i < 4 && !sawRevision; i += 1) {
      const frame = await Promise.race([
        readFrame(),
        new Promise((r) => setTimeout(() => r(''), 2500)),
      ]);
      if (frame.includes('event: revision')) sawRevision = true;
    }
    controller.abort();
    t.ok(sawRevision, 'a change is broadcast to the terminals');
  });
});

/** Sign in on a bare fetch so the raw cookie is available for the stream. */
async function cookieFor(server, call) {
  const roster = await call('GET', '/api/session/staff');
  const manager = roster.json.staff.find((p) => p.name === 'Manager');
  const res = await fetch(`${server.base}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: manager.id, pin: server.setupPin }),
  });
  return (res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
}

/* -------------------------------------------------------------- safety --- */

test('the app is served, and nothing outside it is', async (t) => {
  await withServer({}, async (server) => {
    const page = await fetch(`${server.base}/`);
    t.equal(page.status, 200);
    t.ok((await page.text()).includes('<title>Saba'));

    // Every shape of path traversal a scanner will try.
    for (const path of [
      '/../package.json',
      '/..%2fpackage.json',
      '/%2e%2e/package.json',
      '/assets/../../server/auth.js',
      '/../../etc/passwd',
    ]) {
      const res = await fetch(server.base + path, { redirect: 'manual' });
      const body = await res.text();
      t.notOk(/scryptSync|"name": "saba-pos"|root:x:/.test(body),
        `${path} did not escape the app directory`);
    }
  });
});

test('a cross-site write is refused', async (t) => {
  await withServer({}, async (server, call) => {
    await signIn(call, server.setupPin);
    const cookie = await cookieFor(server, call);

    const res = await fetch(`${server.base}/api/tables/t1/seat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
        origin: 'https://somewhere-else.example',
      },
      body: JSON.stringify({ covers: 2 }),
    });
    t.equal(res.status, 403, 'a form on another site cannot open a table');
  });
});

test('a demonstration install comes up with a room already in service', async (t) => {
  await withServer({ demo: true }, async (server, call) => {
    await signIn(call, server.setupPin);
    const state = (await call('GET', '/api/state')).json;

    t.ok(state.orders.length >= 6, `${state.orders.length} tables open`);
    t.ok(state.settled.length >= 10, `${state.settled.length} bills settled today`);
    t.ok(state.reservations.length >= 4, 'the book has bookings in it');

    const stages = new Set(state.orders.map((o) => {
      const live = o.lines.filter((l) => l.status !== 'VOID');
      if (!live.length) return 'SEATED';
      if (live.every((l) => l.status === 'HELD')) return 'SEATED';
      if (live.some((l) => ['HELD', 'FIRED'].includes(l.status))) return 'ORDERED';
      if (live.every((l) => l.status === 'SERVED')) return 'SERVED';
      return 'ORDERED';
    }));
    t.ok(stages.size >= 2, `the room is in several states: ${[...stages].join(', ')}`);

    const report = (await call('GET', '/api/reports')).json;
    t.ok(report.days.length >= 28, 'a month of trading sits behind it');
    const takings = report.days.reduce((n, d) => n + d.total, 0);
    t.ok(takings > 0, 'and it adds up to money');
  });
});

test('a live install refuses to wipe its own trading data', async (t) => {
  await withServer({ demo: false }, async (server, call) => {
    await signIn(call, server.setupPin);
    const res = await call('POST', '/api/demo/reset');
    t.equal(res.status, 403);
    t.ok(/live install/i.test(res.json.error), res.json.error);
  });
});

test('a backup is a real database that can be read back', async (t) => {
  await withServer({}, async (server, call) => {
    await signIn(call, server.setupPin);
    await call('POST', '/api/tables/t1/seat', { covers: 3, guestName: 'Backed up' });

    const cookie = await cookieFor(server, call);
    const res = await fetch(`${server.base}/api/backup/download`, { headers: { cookie } });
    t.equal(res.status, 200);
    const bytes = Buffer.from(await res.arrayBuffer());
    t.ok(bytes.length > 1000, `only ${bytes.length} bytes`);
    t.equal(bytes.subarray(0, 15).toString(), 'SQLite format 3',
      'it really is a database file');

    // And it carries the order we just created.
    const { mkdtempSync: mk, writeFileSync } = await import('node:fs');
    const dir = mk(join(tmpdir(), 'saba-restore-'));
    const path = join(dir, 'copy.db');
    writeFileSync(path, bytes);
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(path, { readOnly: true });
    const row = db.prepare('SELECT count(*) AS n FROM orders').get();
    db.close();
    rmSync(dir, { recursive: true, force: true });
    t.equal(row.n, 1, 'the backup contains the table that was open');
  });
});
