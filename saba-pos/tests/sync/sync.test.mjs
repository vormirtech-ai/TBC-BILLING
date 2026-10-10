/**
 * The cloud copy.
 *
 * A restaurant trusts this with its takings, so the tests are about the
 * things that would actually hurt: a bill that never arrives, a bill that
 * arrives twice as two bills, a PIN hash escaping the building, a price
 * edited in two places ending up as the wrong one, and a sync failure
 * stopping service.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test } from '../run.mjs';
import { startFakeSupabase } from './fake-supabase.mjs';

let port = 9900 + Math.floor(Math.random() * 300);

/** A till with a cloud project behind it. */
async function withTill(options, fn) {
  const cloud = await startFakeSupabase();
  const dir = mkdtempSync(join(tmpdir(), 'saba-sync-'));
  port += 1;

  const { start } = await import('../../server/main.js');
  const db = await import('../../server/db/index.js');
  const sync = await import('../../server/sync/index.js');

  const server = start({
    port, host: '127.0.0.1', dataDir: dir, setupPin: '7391',
    seedDemo: options.demo === true, logLevel: 'error',
    supabaseUrl: cloud.url, supabaseKey: cloud.key, syncMinutes: 60,
  });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  let cookie = '';
  const call = async (method, path, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
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

  try {
    await fn({ call, cloud, sync, db });
  } finally {
    sync.stop();
    await server.shutdown({ graceMs: 250 });
    try { db.closeDatabase(); } catch { /* already closed */ }
    await cloud.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------- pushing --- */

test('a settled bill reaches the cloud, with the figures that were printed', async (t) => {
  await withTill({}, async ({ call, cloud, sync }) => {
    const state = (await call('GET', '/api/state')).json;
    const dish = state.menu.find((i) => i.available);
    const { id } = (await call('POST', '/api/tables/t1/seat', { covers: 2 })).json.order;
    await call('POST', `/api/orders/${id}/lines`, { itemId: dish.id, qty: 3 });
    const totals = (await call('GET', `/api/orders/${id}`)).json.totals;
    await call('POST', `/api/orders/${id}/payments`, { method: 'CASH', paise: totals.total });
    await call('POST', `/api/orders/${id}/settle`);

    const result = await sync.runOnce({ reason: 'test' });
    t.ok(result.ok, `the sync succeeded — ${result.error || ''}`);

    const [row] = cloud.rows('orders');
    t.ok(row, 'the bill is in the cloud');
    t.equal(row.id, id);
    t.equal(row.status, 'SETTLED');
    t.equal(row.total_paise, totals.total, 'for the amount the guest paid');

    // The document went as JSON, not as a string nobody can query.
    t.equal(typeof row.doc, 'object', 'the order document is real JSON');
    t.equal(row.doc.lines.length, 1);

    // And the arithmetic came with it, computed by the same function that
    // printed the bill rather than re-derived in SQL.
    t.ok(row.totals, 'the totals travelled too');
    t.equal(row.totals.total, totals.total);
    t.equal(row.totals.taxTotal, totals.taxTotal);
    t.deepEqual(row.totals.taxes.map((x) => x.paise), totals.taxes.map((x) => x.paise),
      'each tax component matches the printed bill');
  });
});

test('a PIN never leaves the till', async (t) => {
  await withTill({}, async ({ call, cloud, sync }) => {
    await call('POST', '/api/users', { name: 'Kitchen', role: 'kitchen', pin: '8261' });
    await sync.runOnce({ reason: 'test' });

    const users = cloud.rows('users');
    t.ok(users.length >= 2, 'staff reached the cloud');

    const serialised = JSON.stringify(users);
    t.notOk(/pin_hash|pin_salt/.test(serialised), 'no PIN column was sent');
    t.notOk(serialised.includes('8261'), 'and certainly not the PIN itself');
    for (const user of users) {
      t.ok(user.name && user.role, 'but the name and role did');
    }

    // Nothing anywhere in the whole conversation carried PIN material.
    const everything = JSON.stringify(
      Object.fromEntries(['orders', 'users', 'audit', 'settings', 'menu_items']
        .map((name) => [name, cloud.rows(name)]))
    );
    t.notOk(/pin_hash|pin_salt/.test(everything), 'nor did any other table');
  });
});

test('syncing twice does not bill the restaurant twice', async (t) => {
  await withTill({ demo: true }, async ({ cloud, sync }) => {
    const first = await sync.runOnce({ reason: 'test' });
    t.ok(first.ok);
    const after = cloud.count('orders');
    t.ok(after > 100, `a month of trading went up (${after} bills)`);

    const second = await sync.runOnce({ reason: 'test' });
    t.ok(second.ok);
    t.equal(cloud.count('orders'), after, 'the second pass added nothing');
    t.notOk(second.pushed.orders, 'because there was nothing new to send');
  });
});

test('only what changed goes up', async (t) => {
  await withTill({}, async ({ call, cloud, sync }) => {
    await sync.runOnce({ reason: 'first' });
    const before = cloud.count('orders');

    const state = (await call('GET', '/api/state')).json;
    const dish = state.menu.find((i) => i.available);
    const { id } = (await call('POST', '/api/tables/t4/seat', { covers: 2 })).json.order;
    await call('POST', `/api/orders/${id}/lines`, { itemId: dish.id, qty: 1 });

    const result = await sync.runOnce({ reason: 'second' });
    t.equal(result.pushed.orders, 1, 'one new bill, not the whole history');
    t.equal(cloud.count('orders'), before + 1);
  });
});

test('a cancelled booking is cancelled in the cloud too', async (t) => {
  await withTill({}, async ({ call, cloud, sync }) => {
    const made = await call('POST', '/api/reservations', {
      name: 'Mehta', covers: 4, at: Date.now() + 3600_000,
    });
    t.equal(made.status, 200);
    const bookingId = made.json.reservation.id;

    await sync.runOnce({ reason: 'test' });
    t.equal(cloud.count('reservations'), 1);
    t.equal(cloud.rows('reservations')[0].deleted_at, null, 'and it is live');

    await call('DELETE', `/api/reservations/${bookingId}`);
    await sync.runOnce({ reason: 'test' });

    const row = cloud.rows('reservations')[0];
    t.ok(row.deleted_at, 'the cloud learns the booking is gone');
    // A row that was simply deleted locally could never have told the cloud.
    t.equal(cloud.count('reservations'), 1, 'the record is kept, not erased');
  });
});

/* ------------------------------------------------------------- pulling --- */

test('a price changed in the cloud reaches the till', async (t) => {
  await withTill({}, async ({ call, cloud, sync }) => {
    await sync.runOnce({ reason: 'first' });

    const before = (await call('GET', '/api/state')).json.menu.find((i) => i.available);
    const remote = cloud.rows('menu_items').find((r) => r.id === before.id);
    t.ok(remote, 'the dish is in the cloud');

    // The owner edits the price in the Supabase table editor.
    cloud.put('menu_items', {
      ...remote,
      doc: { ...remote.doc, pricePaise: 123400 },
      updated_at: remote.updated_at + 60_000,
    });

    const result = await sync.runOnce({ reason: 'second' });
    t.ok(result.ok, result.error || '');
    t.equal(result.pulled.menu_items, 1, 'one dish came back down');

    const after = (await call('GET', '/api/state')).json.menu.find((i) => i.id === before.id);
    t.equal(after.pricePaise, 123400, 'and the till is charging the new price');
  });
});

test('the till wins when both sides changed the same thing', async (t) => {
  await withTill({}, async ({ call, cloud, sync }) => {
    await sync.runOnce({ reason: 'first' });

    const dish = (await call('GET', '/api/state')).json.menu.find((i) => i.available);
    const remote = cloud.rows('menu_items').find((r) => r.id === dish.id);

    // The cloud says 999.00, stamped a minute ago.
    cloud.put('menu_items', {
      ...remote,
      doc: { ...remote.doc, pricePaise: 99900 },
      updated_at: Date.now() - 60_000,
    });
    // The till says 555.00, stamped just now — it is the later edit.
    await call('PATCH', `/api/menu/${dish.id}`, { pricePaise: 55500 });

    await sync.runOnce({ reason: 'second' });

    const after = (await call('GET', '/api/state')).json.menu.find((i) => i.id === dish.id);
    t.equal(after.pricePaise, 55500, 'the later edit wins, and it was the till');
    t.equal(cloud.rows('menu_items').find((r) => r.id === dish.id).doc.pricePaise, 55500,
      'and the cloud is corrected on the way out');
  });
});

test('a bill edited in the cloud is ignored — the till owns what happened', async (t) => {
  await withTill({}, async ({ call, cloud, sync }) => {
    const state = (await call('GET', '/api/state')).json;
    const dish = state.menu.find((i) => i.available);
    const { id } = (await call('POST', '/api/tables/t2/seat', { covers: 2 })).json.order;
    await call('POST', `/api/orders/${id}/lines`, { itemId: dish.id, qty: 1 });
    await sync.runOnce({ reason: 'first' });

    const real = (await call('GET', `/api/orders/${id}`)).json.totals.total;

    // Somebody rewrites the bill in Supabase.
    cloud.put('orders', {
      ...cloud.rows('orders')[0], total_paise: 1, updated_at: Date.now() + 600_000,
    });
    await sync.runOnce({ reason: 'second' });

    const after = (await call('GET', `/api/orders/${id}`)).json.totals.total;
    t.equal(after, real, 'the till is unmoved');
    t.notOk(Object.keys((await sync.runOnce({ reason: 'third' })).pulled).includes('orders'),
      'orders are never pulled at all');
  });
});

/* ---------------------------------------------------------- when it is --- */
/* ------------------------------------------------------------- broken --- */

test('no internet is not an incident, and the restaurant keeps trading', async (t) => {
  await withTill({}, async ({ call, cloud, sync }) => {
    cloud.goOffline();

    const state = (await call('GET', '/api/state')).json;
    const dish = state.menu.find((i) => i.available);
    const seated = await call('POST', '/api/tables/t5/seat', { covers: 2 });
    t.equal(seated.status, 200, 'a table can still be seated with the cloud down');
    await call('POST', `/api/orders/${seated.json.order.id}/lines`, { itemId: dish.id, qty: 2 });

    const failed = await sync.runOnce({ reason: 'test' });
    t.notOk(failed.ok, 'the sync failed');
    t.ok(/reach|answer/i.test(failed.error), `and said so plainly: ${failed.error}`);
    t.ok(sync.status().lastError?.retryable, 'and marked it worth trying again');

    // Nothing was lost: it all goes up when the line comes back.
    cloud.comeBack();
    const recovered = await sync.runOnce({ reason: 'test' });
    t.ok(recovered.ok, `the sync recovered — ${recovered.error || ''}`);
    t.ok(cloud.count('orders') >= 1, 'and the bill arrived');
    t.equal(sync.status().lastError, null, 'the error is cleared once it works');
  });
});

test('a wrong key is reported as a wrong key, not retried forever', async (t) => {
  const cloud = await startFakeSupabase({ key: 'the-real-key' });
  const dir = mkdtempSync(join(tmpdir(), 'saba-sync-'));
  port += 1;

  const { start } = await import('../../server/main.js');
  const db = await import('../../server/db/index.js');
  const sync = await import('../../server/sync/index.js');

  const server = start({
    port, host: '127.0.0.1', dataDir: dir, setupPin: '7391', logLevel: 'error',
    supabaseUrl: cloud.url, supabaseKey: 'the-wrong-key', syncMinutes: 60,
  });
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const result = await sync.runOnce({ reason: 'test' });
    t.notOk(result.ok);
    t.ok(/key/i.test(result.error), `names the problem: ${result.error}`);
    t.notOk(sync.status().lastError.retryable, 'and does not pretend it will pass');
    t.notOk(JSON.stringify(sync.status()).includes('the-wrong-key'), 'the key is not in the status');
  } finally {
    sync.stop();
    await server.shutdown({ graceMs: 250 });
    try { db.closeDatabase(); } catch { /* closed */ }
    await cloud.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('with no project configured, the sync stays out of the way', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'saba-sync-'));
  port += 1;

  const { start } = await import('../../server/main.js');
  const db = await import('../../server/db/index.js');
  const sync = await import('../../server/sync/index.js');

  const server = start({
    port, host: '127.0.0.1', dataDir: dir, setupPin: '7391', logLevel: 'error',
    supabaseUrl: '', supabaseKey: '', syncMinutes: 60,
  });
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    t.notOk(sync.isConfigured(), 'it knows there is nothing to sync to');
    t.notOk(sync.start(), 'and does not start a loop');
    const result = await sync.runOnce({ reason: 'test' });
    t.equal(result.skipped, 'not configured');

    const status = sync.status();
    t.notOk(status.configured);
    t.equal(status.pending, 0, 'and nothing is reported as waiting');
  } finally {
    await server.shutdown({ graceMs: 250 });
    try { db.closeDatabase(); } catch { /* closed */ }
    rmSync(dir, { recursive: true, force: true });
  }
});

/* --------------------------------------------------------------- reach --- */

test('only a manager can see or trigger the sync', async (t) => {
  await withTill({}, async ({ call, cloud }) => {
    t.equal((await call('GET', '/api/sync')).status, 200, 'a manager can read it');
    t.notOk(JSON.stringify((await call('GET', '/api/sync')).json).includes(cloud.key),
      'and the key is never in the reply');

    await call('POST', '/api/users', { name: 'Cash', role: 'cashier', pin: '8594' });

    const cashier = async (method, path, body) => {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: { 'content-type': 'application/json', cookie: cashierCookie },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return res.status;
    };
    let cashierCookie = '';
    const signIn = await fetch(`http://127.0.0.1:${port}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: (await call('GET', '/api/users')).json.users.find((u) => u.role === 'cashier').id,
        pin: '8594',
      }),
    });
    cashierCookie = (signIn.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');

    t.equal(await cashier('GET', '/api/sync'), 403, 'a cashier cannot');
    t.equal(await cashier('POST', '/api/sync'), 403, 'nor set one running');
  });
});
