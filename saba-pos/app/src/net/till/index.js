/**
 * A till, in the tab.
 *
 * Answers exactly the paths the real server answers, so `net/api.js` cannot
 * tell the difference and nothing above it — not one view, not the shell, not
 * the printed bill — is aware this build has no server behind it.
 *
 * It exists for the published demonstration, where there is nowhere to run a
 * server and nothing a stranger should be trusted with. It is not a product:
 * the data lives in this tab and goes when the tab does, there is no real
 * authentication, and two browsers share nothing. Everything it computes,
 * though, it computes with the product's own code.
 */

import { ROLE_ABILITIES, ROLE_ROUTES, APP, VOID_REASONS } from '../../shared/config.js';
import { costOrder, buildSplit, charges } from '../../shared/pricing.js';
import { buildDayReport, buildRangeReport } from '../../shared/takings.js';
import { shiftDay } from '../../shared/format.js';
import { mayOpen } from '../../shared/config.js';

import * as till from './store.js';
import { TillError, badRequest, notFound, conflict, forbidden } from './store.js';
import { seedDemo } from './seed.js';

/* ------------------------------------------------------------- routing --- */

const routes = [];
const on = (method, pattern, handler, opts = {}) => {
  const names = [];
  const regex = new RegExp(`^${pattern.replace(/:([a-zA-Z]+)/g, (_, name) => {
    names.push(name);
    return '([^/]+)';
  })}$`);
  routes.push({ method, regex, names, handler, open: !!opts.open, ...opts });
};

function match(method, pathname) {
  let pathExists = false;
  for (const route of routes) {
    const hit = route.regex.exec(pathname);
    if (!hit) continue;
    pathExists = true;
    if (route.method !== method) continue;
    const params = {};
    route.names.forEach((name, i) => { params[name] = decodeURIComponent(hit[i + 1]); });
    return { route, params };
  }
  return pathExists ? { methodNotAllowed: true } : null;
}

/* ------------------------------------------------------------- helpers --- */

const user = () => till.db.session;

function approvalFrom(body, ability) {
  if (!body.approverPin) throw forbidden('A manager has to approve this');
  return authoriseByPin(body.approverPin, ability);
}

/**
 * The PIN check, as a demonstration can honestly do it.
 *
 * The product hashes with scrypt and locks an account out after a short run
 * of wrong guesses. Here the accounts are made up and live in this tab, so
 * the PIN is compared directly — and the demonstration says so in as many
 * words rather than implying a security property it does not have.
 */
function authoriseByPin(pin, ability) {
  const candidates = till.db.users.filter((u) =>
    u.active && (!ability || (ROLE_ABILITIES[u.role] || []).includes(ability)));
  const found = candidates.find((u) => u.pin === String(pin));
  if (!found) {
    throw new TillError(403, ability
      ? 'That PIN does not belong to anybody who can approve this'
      : 'That PIN was not recognised');
  }
  return publicUser(found);
}

const publicUser = (row) => row && ({
  id: row.id,
  name: row.name,
  initials: row.initials,
  role: row.role,
  roleLabel: till.ROLE_LABELS[row.role] || row.role,
  active: !!row.active,
});

const withOrder = (order) => ({ order, revision: till.db.revision });

const requireReason = (body) => {
  const reason = String(body.reason || '').trim().slice(0, 120);
  if (!reason) throw badRequest('A reason is required');
  return reason;
};

/** Where this build reads its history from. The server reads SQLite. */
const source = {
  settledOn: (day) => till.settledOn(day),
  ordersBetween: (from, to) => till.ordersBetween(from, to),
  openOrders: () => till.openOrders(),
  shiftFor: (day) => till.db.shifts.filter((s) => s.day === day).at(-1) || null,
};

/* ------------------------------------------------------------ session --- */

on('GET', '/api/health', () => ({
  ok: true,
  app: APP.name,
  version: APP.version,
  revision: till.db.revision,
  businessDay: till.today(),
  terminals: 1,
  demo: true,
}), { open: true });

on('GET', '/api/session/staff', () => ({
  staff: till.db.users.filter((u) => u.active).map(publicUser),
}), { open: true });

on('POST', '/api/session', (ctx) => {
  if (!ctx.body.userId) throw badRequest('Tap your name first');
  const row = till.db.users.find((u) => u.id === ctx.body.userId && u.active);
  if (!row || row.pin !== String(ctx.body.pin)) {
    throw new TillError(401, 'That PIN was not recognised');
  }
  till.db.session = publicUser(row);
  return { user: till.db.session, revision: till.db.revision };
}, { open: true });

on('GET', '/api/session', () => ({
  user: user(),
  abilities: ROLE_ABILITIES[user().role] || [],
  revision: till.db.revision,
  businessDay: till.today(),
}));

on('DELETE', '/api/session', () => {
  till.db.session = null;
  return { ok: true };
});

on('POST', '/api/authorise', (ctx) => ({
  user: authoriseByPin(ctx.body.pin, ctx.body.ability || null),
}));

/* -------------------------------------------------------------- state --- */

on('GET', '/api/state', () => ({
  ...till.workingSet(),
  user: user(),
  abilities: ROLE_ABILITIES[user().role] || [],
}));

on('GET', '/api/orders/:id', (ctx) => {
  const order = till.getOrder(ctx.params.id);
  if (!order) throw notFound('No such order');
  return { order, totals: costOrder(order), revision: till.db.revision };
});

/* ------------------------------------------------------------- tables --- */

on('POST', '/api/tables/:tableId/seat', (ctx) => withOrder(till.seatTable({
  tableId: ctx.params.tableId,
  covers: ctx.body.covers,
  guestName: ctx.body.guestName,
  reservationId: ctx.body.reservationId,
  user: user(),
})), { screen: '/floor' });

on('POST', '/api/orders/:id/transfer', (ctx) =>
  withOrder(till.transferTable(ctx.params.id, ctx.body.toTableId, user())), { screen: '/floor' });

on('POST', '/api/orders/:id/merge', (ctx) =>
  withOrder(till.mergeTables(ctx.params.id, ctx.body.intoOrderId, user())), { screen: '/floor' });

on('PATCH', '/api/orders/:id', (ctx) =>
  withOrder(till.updateOrderDetails(ctx.params.id, ctx.body)), { screen: '/order' });

/* -------------------------------------------------------------- lines --- */

on('POST', '/api/orders/:id/lines', (ctx) => {
  if (!ctx.body.itemId) throw badRequest('Which dish?');
  return withOrder(till.addOrderLine(ctx.params.id, ctx.body));
}, { screen: '/order' });

on('PATCH', '/api/orders/:id/lines/:lineId', (ctx) => {
  const { id, lineId } = ctx.params;
  if (ctx.body.seat !== undefined) return withOrder(till.setLineSeat(id, lineId, ctx.body.seat));
  return withOrder(till.changeLineQty(id, lineId, ctx.body.qty));
}, { screen: '/order' });

on('DELETE', '/api/orders/:id/lines/:lineId', (ctx) =>
  withOrder(till.dropLine(ctx.params.id, ctx.params.lineId)), { screen: '/order' });

on('POST', '/api/orders/:id/lines/:lineId/void', (ctx) => {
  const reason = requireReason(ctx.body);
  const order = till.getOrder(ctx.params.id);
  const line = order?.lines.find((l) => l.id === ctx.params.lineId);
  // A line the kitchen has never seen is the captain's own mistake to undo.
  const approver = line && line.status !== 'HELD'
    ? approvalFrom(ctx.body, 'void')
    : user();
  return withOrder(till.killLine(ctx.params.id, ctx.params.lineId, { reason, approver }));
}, { screen: '/order' });

on('POST', '/api/orders/:id/lines/:lineId/comp', (ctx) => {
  const approver = approvalFrom(ctx.body, 'comp');
  return withOrder(till.toggleComp(ctx.params.id, ctx.params.lineId, {
    reason: String(ctx.body.reason || '').slice(0, 120), approver,
  }));
}, { screen: '/order' });

on('POST', '/api/orders/:id/fire', (ctx) =>
  withOrder(till.fire(ctx.params.id, ctx.body.course, user())), { screen: '/order' });

/* -------------------------------------------------------------- kitchen --- */

on('POST', '/api/kots/:kotId/status', (ctx) => {
  const { order } = till.bumpKot(ctx.params.kotId, ctx.body.to || ctx.body.status, user());
  return withOrder(order);
}, { screen: '/kds' });

on('POST', '/api/kots/:kotId/void', (ctx) => withOrder(till.killKot(ctx.params.kotId, {
  reason: requireReason(ctx.body),
  approver: approvalFrom(ctx.body, 'void'),
})), { screen: '/kds' });

on('POST', '/api/kots/:kotId/reprint', (ctx) =>
  withOrder(till.markReprint(ctx.params.kotId, user())), { screen: '/kds' });

/* --------------------------------------------------------------- bill --- */

on('PATCH', '/api/orders/:id/charges', (ctx) => {
  let approver = null;
  const wants = ctx.body.discount;
  if (wants && wants.mode === 'PCT'
    && Number(wants.value) > charges().discountApprovalPercent) {
    approver = approvalFrom(ctx.body, 'discount');
  } else if (wants && wants.mode !== 'NONE' && Number(wants.value) > 0
    && !(ROLE_ABILITIES[user().role] || []).includes('discount')) {
    approver = approvalFrom(ctx.body, 'discount');
  }
  return withOrder(till.setCharges(ctx.params.id, ctx.body, { user: user(), approver }));
}, { screen: '/bill' });

on('POST', '/api/orders/:id/split', (ctx) => {
  const order = till.getOrder(ctx.params.id);
  if (!order) throw notFound('No such order');
  if (ctx.body.mode === null || ctx.body.mode === 'NONE') {
    return withOrder(till.setSplit(ctx.params.id, null));
  }
  if (!['EQUAL', 'SEAT', 'ITEM'].includes(ctx.body.mode)) {
    throw badRequest(`Unknown split ${ctx.body.mode}`);
  }
  if (ctx.body.mode === 'SEAT' && !order.lines.some((l) => l.seat && l.status !== 'VOID')) {
    throw conflict('Nothing on this table was ordered against a seat number,'
      + ' so there is nothing to split by seat');
  }
  return withOrder(till.setSplit(ctx.params.id, buildSplit(order, ctx.body.mode, ctx.body)));
}, { screen: '/bill' });

on('POST', '/api/orders/:id/invoice', (ctx) =>
  withOrder(till.raiseInvoice(ctx.params.id, user())), { screen: '/bill' });

on('POST', '/api/orders/:id/payments', (ctx) =>
  withOrder(till.addPayment(ctx.params.id, ctx.body, user())), { screen: '/bill' });

on('DELETE', '/api/orders/:id/payments/:payId', (ctx) =>
  withOrder(till.removePayment(ctx.params.id, ctx.params.payId)), { screen: '/bill' });

on('POST', '/api/orders/:id/settle', (ctx) => {
  const order = till.getOrder(ctx.params.id);
  if (!order) throw notFound('That table is no longer open');
  return withOrder(till.settleOrder(ctx.params.id, user(), costOrder(order).total));
}, { screen: '/bill' });

on('POST', '/api/orders/:id/reopen', (ctx) =>
  withOrder(till.reopenOrder(ctx.params.id, approvalFrom(ctx.body, 'reopen'))),
{ screen: '/bill', ability: 'reopen' });

/* --------------------------------------------------------------- menu --- */

on('GET', '/api/menu', () => ({
  menu: till.listMenu(),
  modifierGroups: till.workingSet().modifierGroups,
}));

on('POST', '/api/menu/:itemId/eighty-six', (ctx) => ({
  item: till.setEightySix(ctx.params.itemId, ctx.body.on !== false, {
    actor: user().name, note: String(ctx.body.note || '').slice(0, 120),
  }),
  revision: till.bump(),
}), { ability: 'eightySix' });

on('POST', '/api/menu', (ctx) => {
  const item = till.createMenuItem(ctx.body);
  till.audit('MENU', `${item.name} added to the carte`, { actor: user().name });
  till.bump();
  return { item, revision: till.db.revision };
}, { screen: '/menu', ability: 'settings' });

on('PATCH', '/api/menu/:itemId', (ctx) => {
  const patch = {};
  for (const key of ['name', 'description', 'pricePaise', 'costPaise',
    'active', 'station', 'course', 'category', 'diet']) {
    if (ctx.body[key] !== undefined) patch[key] = ctx.body[key];
  }
  const item = till.updateMenuItem(ctx.params.itemId, patch);
  till.audit('MENU', `${item.name} updated`, { actor: user().name });
  till.bump();
  return { item, revision: till.db.revision };
}, { screen: '/menu', ability: 'settings' });

/* ------------------------------------------------------- reservations --- */

on('GET', '/api/reservations', (ctx) => ({
  reservations: till.listReservations(ctx.query.get('day') || till.today()),
}), { screen: '/reservations' });

on('POST', '/api/reservations', (ctx) => ({
  reservation: till.saveReservation(ctx.body, user()), revision: till.db.revision,
}), { screen: '/reservations' });

on('PATCH', '/api/reservations/:id', (ctx) => ({
  reservation: till.saveReservation({ ...ctx.body, id: ctx.params.id }, user()),
  revision: till.db.revision,
}), { screen: '/reservations' });

on('DELETE', '/api/reservations/:id', (ctx) => ({
  reservation: till.dropReservation(ctx.params.id, user()), revision: till.db.revision,
}), { screen: '/reservations' });

/* ------------------------------------------------------------ reports --- */

on('GET', '/api/reports', (ctx) => {
  const to = ctx.query.get('to') || till.today();
  const from = ctx.query.get('from') || shiftDay(to, -29);
  if (from > to) throw badRequest('That date range runs backwards');
  return buildRangeReport(from, to, source);
}, { screen: '/reports' });

on('GET', '/api/reports/day/:day', (ctx) =>
  buildDayReport(ctx.params.day, source), { screen: '/reports' });

on('GET', '/api/audit', (ctx) => {
  const day = ctx.query.get('day') || till.today();
  return { day, entries: till.auditLog({ day, limit: 400 }) };
}, { screen: '/reports' });

/* ------------------------------------------------------------- shifts --- */

on('POST', '/api/shift/open', (ctx) => ({
  shift: till.openShift({ floatPaise: ctx.body.floatPaise, user: user() }),
  revision: till.db.revision,
}), { ability: 'shift' });

on('POST', '/api/shift/close', (ctx) => ({
  shift: till.closeShift({
    countedPaise: ctx.body.countedPaise, note: ctx.body.note, user: user(),
  }),
  revision: till.db.revision,
}), { ability: 'shift' });

/* -------------------------------------------------------------- staff --- */

on('GET', '/api/users', () => ({
  users: till.db.users.map(publicUser),
}), { ability: 'users' });

on('POST', '/api/users', (ctx) => {
  const name = String(ctx.body.name || '').trim();
  if (!name) throw badRequest('A member of staff needs a name');
  if (!/^\d{4,8}$/.test(String(ctx.body.pin || ''))) {
    throw badRequest('A PIN must be between four and eight digits');
  }
  if (till.db.users.some((u) => u.active && u.pin === String(ctx.body.pin))) {
    throw conflict('Another member of staff already uses that PIN');
  }
  const row = {
    id: till.uid('u'),
    name: name.slice(0, 80),
    initials: name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase(),
    role: ctx.body.role,
    pin: String(ctx.body.pin),
    active: true,
  };
  till.db.users.push(row);
  till.audit('STAFF', `${row.name} added as ${row.role}`, { actor: user().name });
  till.bump();
  return { user: publicUser(row), revision: till.db.revision };
}, { ability: 'users' });

on('PATCH', '/api/users/:id', (ctx) => {
  const row = till.db.users.find((u) => u.id === ctx.params.id);
  if (!row) throw notFound('No such member of staff');
  const managers = till.db.users.filter((u) => u.active && u.role === 'manager').length;
  const losing = row.role === 'manager' && row.active
    && ((ctx.body.role && ctx.body.role !== 'manager') || ctx.body.active === false);
  if (losing && managers <= 1) {
    throw conflict('This is the only manager — promote someone else first');
  }
  if (ctx.body.name !== undefined) row.name = String(ctx.body.name).slice(0, 80);
  if (ctx.body.role !== undefined) row.role = ctx.body.role;
  if (ctx.body.active !== undefined) row.active = !!ctx.body.active;
  if (ctx.body.pin) row.pin = String(ctx.body.pin);
  till.audit('STAFF', `${row.name} updated`, { actor: user().name });
  till.bump();
  return { user: publicUser(row), revision: till.db.revision };
}, { ability: 'users' });

/* ----------------------------------------------------------- settings --- */

on('GET', '/api/settings', () => ({ settings: till.allSettings() }));

on('PATCH', '/api/settings', (ctx) => {
  for (const [key, value] of Object.entries(ctx.body)) till.setSetting(key, value);
  till.audit('SETTINGS', `Updated ${Object.keys(ctx.body).join(', ')}`, { actor: user().name });
  till.bump();
  return { settings: till.allSettings(), revision: till.db.revision };
}, { ability: 'settings' });

on('GET', '/api/terminals', () => ({
  terminals: [{ id: 'demo', user: user().name, since: Date.now(), screen: 'this browser' }],
}), { ability: 'settings' });

/* --------------------------------------------------------------- data --- */

on('POST', '/api/backup', () => ({
  name: 'saba-demonstration.json',
  note: 'A published demonstration keeps nothing to back up — this is where a '
    + 'real till would write a complete copy of its database.',
}), { ability: 'backup' });

on('POST', '/api/demo/reset', () => {
  const signedIn = till.db.session;
  seedDemo();
  till.db.session = till.db.users.find((u) => u.id === signedIn?.id)
    ? signedIn
    : publicUser(till.db.users[0]);
  till.bump();
  return { ok: true, revision: till.db.revision };
}, { ability: 'settings' });

/* ------------------------------------------------------------ the door --- */

const json = (status, payload) => new Response(JSON.stringify(payload), {
  status,
  headers: { 'content-type': 'application/json' },
});

/**
 * One request, answered the way the server would answer it — including the
 * refusals. A demonstration that let a captain open the takings would be
 * demonstrating something the product does not do.
 */
export function handle(path, init = {}) {
  const url = new URL(path, 'http://till.local');
  const found = match(init.method || 'GET', url.pathname);

  if (!found) return json(404, { error: 'No such endpoint', path: url.pathname });
  if (found.methodNotAllowed) {
    return json(405, { error: `${init.method} is not allowed here` });
  }

  const { route, params } = found;

  if (!route.open && !till.db.session) {
    return json(401, { error: 'Sign in to continue', code: 'SIGNED_OUT' });
  }

  try {
    if (route.screen && !mayOpen(till.db.session.role, route.screen)) {
      throw forbidden(`A ${till.db.session.role} cannot use that part of the system`);
    }
    if (route.ability
      && !(ROLE_ABILITIES[till.db.session.role] || []).includes(route.ability)) {
      throw forbidden(`A ${till.db.session.role} cannot do that`);
    }

    const body = init.body ? JSON.parse(init.body) : {};
    return json(200, route.handler({ params, body, query: url.searchParams }) ?? { ok: true });
  } catch (error) {
    if (error instanceof TillError) return json(error.status, { error: error.message });
    // A domain function threw: the same sentence the server would have sent.
    return json(400, { error: error.message || 'That did not work' });
  }
}

/** Switch this build over to the in-tab till. Called by the demo bootstrap. */
export function install() {
  seedDemo();
  globalThis.SABA_TILL = handle;
  return handle;
}

export { till, VOID_REASONS, ROLE_ROUTES };
