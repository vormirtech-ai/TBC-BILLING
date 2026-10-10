#!/usr/bin/env node
/**
 * A quick manual poke at a running server. Not the test suite — that lives in
 * tests/ — just a way to see the API work end to end while building.
 *
 *   node tools/poke.mjs [port]
 */

const port = process.argv[2] || 8431;
const base = `http://127.0.0.1:${port}`;
let cookie = '';

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  for (const c of setCookie) cookie = c.split(';')[0];
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

const show = (label, r) => {
  const detail = r.json?.error ? ` ← ${r.json.error}` : '';
  console.log(`  ${String(r.status).padEnd(4)} ${label}${detail}`);
  return r;
};

const money = (p) => `₹${(p / 100).toFixed(2)}`;

console.log('\nHEALTH AND SIGN IN');
show('GET  /api/health', await call('GET', '/api/health'));
show('GET  /api/state (signed out)', await call('GET', '/api/state'));
show('GET  /api/session/staff', await call('GET', '/api/session/staff'));
show('POST /api/session (wrong pin)', await call('POST', '/api/session', { pin: '0000' }));
const signIn = show('POST /api/session (manager)', await call('POST', '/api/session', { pin: '1379' }));
console.log(`       signed in as ${signIn.json?.user?.name} (${signIn.json?.user?.role})`);

console.log('\nTHE WORKING SET');
const state = show('GET  /api/state', await call('GET', '/api/state'));
const s = state.json;
console.log(`       revision ${s.revision} · ${s.orders.length} tables open · ${s.settled.length} settled today`);
console.log(`       ${s.menu.length} dishes · ${s.reservations.length} bookings · ${s.tables.length} tables`);

console.log('\nTAKING AN ORDER');
const g2 = s.orders.find((o) => o.tableLabel === 'G2');
let r = show('POST add a dish to G2', await call('POST', `/api/orders/${g2.id}/lines`,
  { itemId: 't05', qty: 1, seat: 2, modifierIds: ['medium'] }));
const withLine = r.json.order;
const added = withLine.lines.at(-1);
console.log(`       ${added.name} · seat ${added.seat} · ${added.modifiers.map((m) => m.label).join(', ')} · ${money(added.unitPaise)}`);

r = show('POST fire the table', await call('POST', `/api/orders/${g2.id}/fire`, {}));
console.log(`       ${r.json.kots.length} dockets: ${r.json.kots.map((k) => `${k.station} ${k.code}`).join(' · ')}`);

console.log('\nTHE KITCHEN');
const kot = r.json.kots[0];
show('POST bump to READY', await call('POST', `/api/kots/${kot.id}/status`, { to: 'READY' }));
show('POST bump to SERVED', await call('POST', `/api/kots/${kot.id}/status`, { to: 'SERVED' }));
show('POST bump to nonsense', await call('POST', `/api/kots/${kot.id}/status`, { to: 'ELSEWHERE' }));

console.log('\nAUTHORISATION');
const t6 = s.orders.find((o) => o.tableLabel === '6');
const served = t6.lines.find((l) => l.status === 'SERVED');
show('POST void with no approval', await call('POST', `/api/orders/${t6.id}/lines/${served.id}/void`,
  { reason: 'Guest changed order' }));
show('POST void with a wrong PIN', await call('POST', `/api/orders/${t6.id}/lines/${served.id}/void`,
  { reason: 'Guest changed order', approverPin: '9999' }));
show('POST void with no reason', await call('POST', `/api/orders/${t6.id}/lines/${served.id}/void`,
  { approverPin: '1379' }));
r = show('POST void properly', await call('POST', `/api/orders/${t6.id}/lines/${served.id}/void`,
  { reason: 'Guest changed order', approverPin: '1379' }));
console.log(`       ${served.name} is now ${r.json.order.lines.find((l) => l.id === served.id).status}`);

console.log('\nSETTLING A BILL');
const t7 = s.orders.find((o) => o.tableLabel === '7');
const detail = (await call('GET', `/api/orders/${t7.id}`)).json;
console.log(`       table 7 comes to ${money(detail.totals.total)}`);
show('POST settle before paying', await call('POST', `/api/orders/${t7.id}/settle`));
show('POST print the bill', await call('POST', `/api/orders/${t7.id}/invoice`));
show('POST take payment', await call('POST', `/api/orders/${t7.id}/payments`,
  { method: 'CARD', paise: detail.totals.total, ref: 'Ref 998812' }));
r = show('POST settle', await call('POST', `/api/orders/${t7.id}/settle`));
console.log(`       ${r.json.order.invoice.code} settled by ${r.json.order.settledBy}`);

console.log('\nSPLITTING');
const r1 = s.orders.find((o) => o.tableLabel === 'Rose 1');
show('POST split Rose 1 by seat (no seats recorded)',
  await call('POST', `/api/orders/${r1.id}/split`, { mode: 'SEAT' }));
r = show('POST split table 6 by seat', await call('POST', `/api/orders/${t6.id}/split`, { mode: 'SEAT' }));
console.log(`       ${r.json.order.split.shares.map((x) => x.label).join(' · ')}`);
r = show('POST split Rose 1 four ways', await call('POST', `/api/orders/${r1.id}/split`, { mode: 'EQUAL', ways: 4 }));
console.log(`       ${r.json.order.split.shares.length} equal shares`);
show('POST split nonsense', await call('POST', `/api/orders/${r1.id}/split`, { mode: 'SIDEWAYS' }));

console.log('\nREPORTS');
const day = show('GET  /api/reports/day/today', await call('GET', `/api/reports/day/${s.businessDay}`));
const d = day.json;
console.log(`       ${d.totals.bills} bills · ${d.totals.covers} covers · ${money(d.totals.total)}`);
console.log(`       avg check ${money(d.totals.avgCheck)} · turn ${d.totals.avgTurnMin} min`);
console.log(`       tenders: ${d.tenders.map((t) => `${t.label} ${money(t.paise)}`).join(' · ')}`);
console.log(`       still open: ${d.stillOpen.length} tables`);
const range = show('GET  /api/reports (30 days)', await call('GET', '/api/reports'));
const total = range.json.days.reduce((n, x) => n + x.total, 0);
console.log(`       ${range.json.days.length} days · ${money(total)}`);

console.log('\nEXPORTS AND BACKUP');
const csv = show('GET  /api/export/sales.csv', await call('GET', `/api/export/sales.csv?from=${s.businessDay}&to=${s.businessDay}`));
console.log(`       ${csv.text.split('\r\n').length - 1} rows`);
show('GET  /api/export/gst.csv', await call('GET', `/api/export/gst.csv?from=${s.businessDay}&to=${s.businessDay}`));
show('POST /api/backup', await call('POST', '/api/backup'));

console.log('\nROLE LIMITS (as the kitchen)');
await call('DELETE', '/api/session');
await call('POST', '/api/session', { pin: '4693' });
show('GET  /api/state', await call('GET', '/api/state'));
show('POST /api/backup', await call('POST', '/api/backup'));
show('GET  /api/users', await call('GET', '/api/users'));
show('POST seat a table', await call('POST', '/api/tables/t1/seat', { covers: 2 }));

console.log('');
