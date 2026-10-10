/**
 * The API.
 *
 * One file, because the whole surface is eight screens' worth of commands and
 * splitting forty short handlers across nine files makes them harder to read,
 * not easier. Each section below maps to one screen.
 *
 * Two rules hold everywhere:
 *
 *   The server decides. A terminal sends ids and quantities; prices, totals,
 *   invoice numbers and timestamps all come from here. Nothing a browser
 *   sends is trusted to be a price.
 *
 *   Anything that moves money away from the restaurant — a void, a comp, a
 *   heavy discount, reopening a bill — needs a manager's PIN in the request,
 *   and the manager's name is what lands in the audit log.
 */

import { Router, readJson, sendJson, sendFileDownload, badRequest, notFound, forbidden, conflict, HttpError } from './http/kit.js';
import * as store from './store.js';
import * as auth from './auth.js';
import * as live from './live.js';
import { currentRevision, backupTo, tx } from './db/index.js';
import { config } from './config.js';
import { log } from './log.js';

import {
  ROLE_ABILITIES, COURSES, STATIONS, KOT_STATUS, VOID_REASONS,
  DAY_ROLLOVER_HOUR, APP,
} from '../app/src/shared/config.js';
import { CATEGORIES } from '../app/src/shared/catalogue.js';
import { businessDay, shiftDay, dayKey } from '../app/src/shared/format.js';
import { costOrder, buildSplit } from '../app/src/shared/pricing.js';
import { buildDayReport, buildRangeReport } from './reporting.js';

export const router = new Router();

/* ------------------------------------------------------------ helpers --- */

const ok = (res, payload) => sendJson(res, 200, payload ?? { ok: true });

/** Reply with the order plus the revision, which is what every command returns. */
const withOrder = (res, order) =>
  sendJson(res, 200, { order, revision: currentRevision() });

/**
 * Pull a manager's approval out of the request.
 *
 * Passing the PIN per-action rather than elevating the session is deliberate:
 * a manager walks over, types four digits, and walks away. Nothing stays
 * unlocked behind them.
 */
function approvalFrom(body, ctx, ability) {
  if (!body.approverPin) throw forbidden('A manager has to approve this');
  return auth.authoriseByPin({
    pin: body.approverPin,
    ability,
    address: ctx.address,
  });
}

function requireReason(body, allowed) {
  const reason = String(body.reason || '').trim().slice(0, 120);
  if (!reason) throw badRequest('A reason is required');
  return reason;
}

const asInt = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
};

/* ------------------------------------------------------------ session --- */

router.get('/api/health', async (req, res) => {
  sendJson(res, 200, {
    ok: true,
    app: APP.name,
    version: APP.version,
    revision: currentRevision(),
    businessDay: store.today(),
    terminals: live.terminalCount(),
    uptimeSeconds: Math.round(process.uptime()),
  });
}, { auth: false });

/**
 * Who can sign in. Names and roles only — never PINs.
 *
 * The lock screen shows these as tappable cards so a captain mid-service does
 * not have to read a list; they still have to type the PIN.
 */
router.get('/api/session/staff', async (req, res) => {
  sendJson(res, 200, { staff: auth.listUsers() });
}, { auth: false });

router.post('/api/session', async (req, res, ctx) => {
  const body = await readJson(req);
  if (!body.userId) throw badRequest('Tap your name first');
  const { token, user, expiresAt } = auth.signIn({
    userId: String(body.userId),
    pin: body.pin,
    address: ctx.address,
    terminal: String(body.terminal || '').slice(0, 60),
  });
  ctx.setSession(token, expiresAt - Date.now());
  sendJson(res, 200, { user, revision: currentRevision() });
}, { auth: false });

router.get('/api/session', async (req, res, ctx) => {
  sendJson(res, 200, {
    user: ctx.user,
    abilities: ROLE_ABILITIES[ctx.user.role] || [],
    revision: currentRevision(),
    businessDay: store.today(),
  });
});

router.delete('/api/session', async (req, res, ctx) => {
  auth.signOut(ctx.token);
  ctx.clearSession();
  ok(res);
});

/**
 * Check a manager's PIN without doing anything with it.
 *
 * The approval dialog calls this so it can refuse a wrong PIN on the spot,
 * the way it would if the check were local. The action that follows sends the
 * PIN again and is authorised independently — this endpoint grants nothing,
 * it only answers "would that work".
 */
router.post('/api/authorise', async (req, res, ctx) => {
  const body = await readJson(req);
  const user = auth.authoriseByPin({
    pin: body.pin,
    ability: body.ability || null,
    address: ctx.address,
  });
  sendJson(res, 200, { user });
});

/* -------------------------------------------------------------- state --- */

router.get('/api/state', async (req, res, ctx) => {
  sendJson(res, 200, {
    ...store.workingSet(),
    user: ctx.user,
    abilities: ROLE_ABILITIES[ctx.user.role] || [],
  });
});

/** The live stream. Held open; never returns. */
router.get('/api/events', async (req, res, ctx) => {
  live.attach(req, res, {
    user: ctx.user,
    revision: currentRevision(),
    id: ctx.id,
  });
  return 'streaming';
});

/* -------------------------------------------------------------- floor --- */

router.post('/api/tables/:tableId/seat', async (req, res, ctx) => {
  const body = await readJson(req);
  const order = store.seatTable({
    tableId: req.params.tableId,
    covers: asInt(body.covers, 2),
    guestName: String(body.guestName || '').slice(0, 80),
    reservationId: body.reservationId || null,
    user: ctx.user,
  });
  withOrder(res, order);
});

router.post('/api/orders/:id/transfer', async (req, res, ctx) => {
  const body = await readJson(req);
  if (!body.toTableId) throw badRequest('Which table should it move to?');
  withOrder(res, store.transferTable(req.params.id, body.toTableId, ctx.user));
});

router.post('/api/orders/:id/merge', async (req, res, ctx) => {
  const body = await readJson(req);
  if (!body.intoOrderId) throw badRequest('Which table should it merge into?');
  withOrder(res, store.mergeTables(req.params.id, body.intoOrderId, ctx.user));
});

router.patch('/api/orders/:id', async (req, res, ctx) => {
  const body = await readJson(req);
  withOrder(res, store.updateOrderDetails(req.params.id, body));
});

router.get('/api/orders/:id', async (req, res) => {
  const order = store.getOrder(req.params.id);
  if (!order) throw notFound('No such order');
  sendJson(res, 200, { order, totals: costOrder(order), revision: currentRevision() });
});

/* -------------------------------------------------------------- order --- */

router.post('/api/orders/:id/lines', async (req, res, ctx) => {
  const body = await readJson(req);
  if (!body.itemId) throw badRequest('Which dish?');
  withOrder(res, store.addOrderLine(req.params.id, {
    itemId: body.itemId,
    qty: body.qty,
    seat: body.seat,
    course: body.course,
    modifierIds: body.modifierIds,
    notes: body.notes,
  }, ctx.user));
});

router.patch('/api/orders/:id/lines/:lineId', async (req, res) => {
  const body = await readJson(req);
  const { id, lineId } = req.params;
  if (body.qty !== undefined) withOrder(res, store.changeLineQty(id, lineId, body.qty));
  else if (body.seat !== undefined) withOrder(res, store.setLineSeat(id, lineId, body.seat));
  else throw badRequest('Nothing to change');
});

router.delete('/api/orders/:id/lines/:lineId', async (req, res) => {
  withOrder(res, store.dropLine(req.params.id, req.params.lineId));
});

router.post('/api/orders/:id/lines/:lineId/void', async (req, res, ctx) => {
  const body = await readJson(req);
  const approver = approvalFrom(body, ctx, 'void');
  const reason = requireReason(body);
  withOrder(res, store.killLine(req.params.id, req.params.lineId, { reason, approver }));
});

router.post('/api/orders/:id/lines/:lineId/comp', async (req, res, ctx) => {
  const body = await readJson(req);
  const approver = approvalFrom(body, ctx, 'comp');
  withOrder(res, store.toggleComp(req.params.id, req.params.lineId, {
    reason: String(body.reason || '').slice(0, 120),
    approver,
  }));
});

router.post('/api/orders/:id/fire', async (req, res, ctx) => {
  const body = await readJson(req);
  const course = body.course && COURSES.some((c) => c.id === body.course) ? body.course : null;
  const { order, kots } = store.fire(req.params.id, course, ctx.user);
  if (!kots.length) throw conflict('Nothing is held for that course');
  sendJson(res, 200, { order, kots, revision: currentRevision() });
});

/* ------------------------------------------------------------ kitchen --- */

router.post('/api/kots/:kotId/status', async (req, res, ctx) => {
  const body = await readJson(req);
  const to = body.to;
  if (![KOT_STATUS.FIRED, KOT_STATUS.READY, KOT_STATUS.SERVED].includes(to)) {
    throw badRequest(`A docket cannot be moved to ${to}`);
  }
  withOrder(res, store.bumpKot(req.params.kotId, to, ctx.user));
});

router.post('/api/kots/:kotId/void', async (req, res, ctx) => {
  const body = await readJson(req);
  const approver = approvalFrom(body, ctx, 'void');
  const reason = requireReason(body);
  withOrder(res, store.killKot(req.params.kotId, { reason, approver }));
});

router.post('/api/kots/:kotId/reprint', async (req, res, ctx) => {
  withOrder(res, store.markReprint(req.params.kotId, ctx.user));
});

/* --------------------------------------------------------------- bill --- */

router.patch('/api/orders/:id/charges', async (req, res, ctx) => {
  const body = await readJson(req);
  let approver = null;

  // Past the threshold the discount stops being a cashier's call.
  if (body.discount && body.discount.mode === 'PCT'
      && Number(body.discount.value) > store.charges().discountApprovalPercent) {
    approver = approvalFrom(body, ctx, 'discount');
  } else if (body.discount && body.discount.mode !== 'NONE'
      && !(ROLE_ABILITIES[ctx.user.role] || []).includes('discount')) {
    approver = approvalFrom(body, ctx, 'discount');
  }

  withOrder(res, store.setCharges(req.params.id, body, { user: ctx.user, approver }));
});

router.post('/api/orders/:id/split', async (req, res) => {
  const body = await readJson(req);
  const order = store.getOrder(req.params.id);
  if (!order) throw notFound('No such order');

  if (body.mode === null || body.mode === 'NONE') {
    return withOrder(res, store.setSplit(req.params.id, null));
  }
  if (!['EQUAL', 'SEAT', 'ITEM'].includes(body.mode)) {
    throw badRequest(`Unknown split ${body.mode}`);
  }
  if (body.mode === 'SEAT' && !order.lines.some((l) => l.seat && l.status !== 'VOID')) {
    // Otherwise this silently produces one share called "Table (shared)",
    // which looks like the feature is broken rather than inapplicable.
    throw conflict('Nothing on this table was ordered against a seat number,'
      + ' so there is nothing to split by seat');
  }
  // A split the client assembled by hand (lines moved between shares) is
  // taken as given; otherwise the server builds it from the order.
  const split = Array.isArray(body.shares) && body.shares.length
    ? { mode: body.mode, shares: body.shares }
    : buildSplit(order, body.mode, { ways: asInt(body.ways, 2) });
  withOrder(res, store.setSplit(req.params.id, split));
});

router.post('/api/orders/:id/invoice', async (req, res, ctx) => {
  withOrder(res, store.raiseInvoice(req.params.id, ctx.user));
});

router.post('/api/orders/:id/payments', async (req, res, ctx) => {
  const body = await readJson(req);
  withOrder(res, store.addPayment(req.params.id, {
    method: body.method,
    paise: body.paise,
    ref: body.ref,
    shareId: body.shareId,
  }, ctx.user));
});

router.delete('/api/orders/:id/payments/:payId', async (req, res, ctx) => {
  withOrder(res, store.removePayment(req.params.id, req.params.payId, ctx.user));
});

router.post('/api/orders/:id/settle', async (req, res, ctx) => {
  withOrder(res, store.settleOrder(req.params.id, ctx.user));
});

router.post('/api/orders/:id/reopen', async (req, res, ctx) => {
  const body = await readJson(req);
  const approver = approvalFrom(body, ctx, 'reopen');
  withOrder(res, store.reopenOrder(req.params.id, approver));
});

/* --------------------------------------------------------------- menu --- */

router.get('/api/menu', async (req, res) => {
  sendJson(res, 200, {
    menu: store.listMenu(),
    modifierGroups: store.getModifierGroups(),
  });
});

router.post('/api/menu/:itemId/eighty-six', async (req, res, ctx) => {
  const body = await readJson(req);
  if (!(ROLE_ABILITIES[ctx.user.role] || []).includes('eightySix')) {
    throw forbidden('Only a captain or a manager can take a dish off');
  }
  const item = store.setEightySix(req.params.itemId, body.on !== false, {
    actor: ctx.user.name,
    note: String(body.note || '').slice(0, 120),
  });
  sendJson(res, 200, { item, revision: currentRevision() });
});

/** Where a dish is allowed to sit, cooked and served. */
function placeOnCarte(body, fallback = {}) {
  const pick = (list, value, what) => {
    const found = list.find((entry) => entry.id === value);
    if (!found) throw badRequest(`${what} ${JSON.stringify(value)} is not one of ours`);
    return found.id;
  };
  return {
    category: pick(CATEGORIES, body.category ?? fallback.category, 'Menu section'),
    station: pick(STATIONS, body.station ?? fallback.station, 'Kitchen station'),
    course: pick(COURSES, body.course ?? fallback.course, 'Course'),
  };
}

router.post('/api/menu', async (req, res, ctx) => {
  auth.requireAbility(ctx.user, 'settings');
  const body = await readJson(req);

  const item = store.createMenuItem({ ...body, ...placeOnCarte(body) });
  store.audit('MENU', `${item.name} added to the carte`, { actor: ctx.user.name });
  sendJson(res, 201, { item, revision: currentRevision() });
});

router.patch('/api/menu/:itemId', async (req, res, ctx) => {
  auth.requireAbility(ctx.user, 'settings');
  const body = await readJson(req);
  const existing = store.menuItem(req.params.itemId);
  if (!existing) throw notFound('No such dish');

  const next = { ...existing };
  if (body.pricePaise !== undefined) next.pricePaise = Math.max(0, asInt(body.pricePaise));
  if (body.costPaise !== undefined) next.costPaise = Math.max(0, asInt(body.costPaise));
  if (body.name !== undefined) next.name = String(body.name).slice(0, 80);
  if (body.description !== undefined) next.description = String(body.description).slice(0, 240);
  if (body.active !== undefined) next.active = !!body.active;
  if (body.diet !== undefined) next.diet = body.diet === 'NON_VEG' ? 'NON_VEG' : 'VEG';
  Object.assign(next, placeOnCarte(body, existing));

  delete next.available;
  delete next.eightySixed;
  delete next.eightySix;

  const saved = store.upsertMenuItem(next);
  store.audit('MENU', `${saved.name} updated`, { actor: ctx.user.name });
  sendJson(res, 200, { item: saved, revision: currentRevision() });
});

/* -------------------------------------------------------- reservations --- */

router.get('/api/reservations', async (req, res) => {
  const day = req.query.get('day') || store.today();
  sendJson(res, 200, { reservations: store.listReservations(day), day });
});

router.post('/api/reservations', async (req, res, ctx) => {
  const body = await readJson(req);
  sendJson(res, 200, {
    reservation: store.saveReservation(body, ctx.user),
    revision: currentRevision(),
  });
});

router.patch('/api/reservations/:id', async (req, res, ctx) => {
  const body = await readJson(req);
  sendJson(res, 200, {
    reservation: store.saveReservation({ ...body, id: req.params.id }, ctx.user),
    revision: currentRevision(),
  });
});

router.delete('/api/reservations/:id', async (req, res, ctx) => {
  store.dropReservation(req.params.id, ctx.user);
  ok(res);
});

/* ------------------------------------------------------------ reports --- */

router.get('/api/reports', async (req, res) => {
  const to = req.query.get('to') || store.today();
  const from = req.query.get('from') || shiftDay(to, -29);
  if (from > to) throw badRequest('That date range runs backwards');
  sendJson(res, 200, buildRangeReport(from, to));
});

router.get('/api/reports/day/:day', async (req, res) => {
  sendJson(res, 200, buildDayReport(req.params.day));
});

router.get('/api/audit', async (req, res) => {
  const day = req.query.get('day') || store.today();
  sendJson(res, 200, { day, entries: store.auditLog({ day, limit: 400 }) });
});

/* ------------------------------------------------------------- shifts --- */

router.post('/api/shift/open', async (req, res, ctx) => {
  auth.requireAbility(ctx.user, 'shift');
  const body = await readJson(req);
  sendJson(res, 200, {
    shift: store.openShift({ floatPaise: asInt(body.floatPaise), user: ctx.user }),
    revision: currentRevision(),
  });
});

router.post('/api/shift/close', async (req, res, ctx) => {
  auth.requireAbility(ctx.user, 'shift');
  const body = await readJson(req);
  const shift = store.closeShift({
    countedPaise: asInt(body.countedPaise),
    note: body.note,
    user: ctx.user,
  });
  sendJson(res, 200, {
    shift,
    report: buildDayReport(store.today()),
    revision: currentRevision(),
  });
});

/* ------------------------------------------------------------ exports --- */

function csv(rows) {
  const escape = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    // Guard against a dish named "=cmd|..." being run as a formula when the
    // accountant opens this in Excel.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  // A BOM, because Excel reads a plain UTF-8 CSV as Latin-1 and turns ₹ into
  // mojibake on the one report an accountant actually opens.
  return '﻿' + rows.map((r) => r.map(escape).join(',')).join('\r\n') + '\r\n';
}

router.get('/api/export/sales.csv', async (req, res, ctx) => {
  auth.requireAbility(ctx.user, 'export');
  const to = req.query.get('to') || store.today();
  const from = req.query.get('from') || to;
  const orders = store.ordersBetween(from, to);

  const rows = [[
    'Business day', 'Invoice', 'Order', 'Table', 'Covers', 'Opened', 'Settled',
    'Captain', 'Items', 'Comps', 'Discount', 'Service charge',
    ...store.charges().taxComponents.map((c) => c.label),
    'Tip', 'Round off', 'Total', 'Payment methods',
  ]];
  const money = (p) => (p / 100).toFixed(2);

  for (const order of orders) {
    const t = costOrder(order);
    rows.push([
      order.businessDay, order.invoice?.code || '', order.code, order.tableLabel,
      order.covers,
      new Date(order.openedAt).toISOString(),
      order.closedAt ? new Date(order.closedAt).toISOString() : '',
      order.captainName,
      money(t.gross), money(t.comps), money(t.discount), money(t.serviceCharge),
      ...t.taxes.map((x) => money(x.paise)),
      money(t.tip), money(t.roundOff), money(t.total),
      order.payments.map((p) => p.method).join(' + '),
    ]);
  }
  sendFileDownload(res, `saba-sales-${from}-to-${to}.csv`, csv(rows), 'text/csv; charset=utf-8');
});

router.get('/api/export/gst.csv', async (req, res, ctx) => {
  auth.requireAbility(ctx.user, 'export');
  const to = req.query.get('to') || store.today();
  const from = req.query.get('from') || to;
  const orders = store.ordersBetween(from, to);
  const settings = store.getSetting('restaurant');

  const rows = [[
    'Invoice', 'Date', 'GSTIN', 'Taxable value',
    ...store.charges().taxComponents.flatMap((c) => [`${c.label} rate %`, `${c.label} amount`]),
    'Total tax', 'Invoice total',
  ]];
  const money = (p) => (p / 100).toFixed(2);

  for (const order of orders) {
    const t = costOrder(order);
    rows.push([
      order.invoice?.code || order.code,
      new Date(order.closedAt || order.openedAt).toISOString().slice(0, 10),
      settings.gstin || '',
      money(t.taxable),
      ...t.taxes.flatMap((x) => [(x.bps / 100).toFixed(2), money(x.paise)]),
      money(t.taxTotal), money(t.total),
    ]);
  }
  sendFileDownload(res, `saba-gst-${from}-to-${to}.csv`, csv(rows), 'text/csv; charset=utf-8');
});

/* -------------------------------------------------------------- admin --- */

router.get('/api/users', async (req, res, ctx) => {
  auth.requireAbility(ctx.user, 'users');
  sendJson(res, 200, { users: auth.listAllUsers() });
});

router.post('/api/users', async (req, res, ctx) => {
  auth.requireAbility(ctx.user, 'users');
  const body = await readJson(req);
  const user = auth.createUser({ name: body.name, role: body.role, pin: body.pin });
  store.audit('USER', `Added ${user.name} as ${user.role}`, { actor: ctx.user.name });
  sendJson(res, 200, { user });
});

router.patch('/api/users/:id', async (req, res, ctx) => {
  auth.requireAbility(ctx.user, 'users');
  const body = await readJson(req);
  const user = auth.updateUser(req.params.id, body);
  store.audit('USER', `Updated ${user.name}`, { actor: ctx.user.name });
  sendJson(res, 200, { user });
});

router.get('/api/settings', async (req, res, ctx) => {
  sendJson(res, 200, { settings: store.allSettings() });
});

router.patch('/api/settings', async (req, res, ctx) => {
  auth.requireAbility(ctx.user, 'settings');
  const body = await readJson(req);
  // All of it or none of it: a tax rate the server refuses must not leave the
  // restaurant's address half saved.
  tx(() => {
    for (const [key, value] of Object.entries(body)) store.setSetting(key, value);
    store.audit('SETTINGS', `Updated ${Object.keys(body).join(', ')}`, { actor: ctx.user.name });
  });
  // Committed, so now they are what bills are costed with and what the
  // floor is drawn from.
  store.loadCharges();
  store.loadFloorPlan();
  sendJson(res, 200, { settings: store.allSettings(), revision: currentRevision() });
});

router.get('/api/terminals', async (req, res, ctx) => {
  auth.requireAbility(ctx.user, 'settings');
  sendJson(res, 200, { terminals: live.terminals() });
});

/**
 * Put a demonstration back to how it started.
 *
 * Refused outright unless the server was started with SABA_SEED_DEMO, so
 * there is no path to this on a restaurant's real install — which is the
 * only acceptable shape for a button that deletes every bill.
 */
router.post('/api/demo/reset', async (req, res, ctx) => {
  if (!config.seedDemo) {
    throw forbidden('This is a live install. Resetting trading data is not available.');
  }
  const { resetDemo } = await import('./seed.js');
  resetDemo();
  log.warn('demonstration data reset', { by: ctx.user.name });
  sendJson(res, 200, { ok: true, revision: currentRevision() });
});

/* ------------------------------------------------------------- backup --- */

router.post('/api/backup', async (req, res, ctx) => {
  auth.requireAbility(ctx.user, 'backup');
  const { join } = await import('node:path');
  const name = `saba-backup-${dayKey()}-${Date.now()}.db`;
  const path = backupTo(join(config.dataDir, 'backups', name));
  store.audit('BACKUP', `Backup taken: ${name}`, { actor: ctx.user.name });
  log.info('backup taken', { path });
  sendJson(res, 200, { name, path });
});

router.get('/api/backup/download', async (req, res, ctx) => {
  auth.requireAbility(ctx.user, 'backup');
  const { join } = await import('node:path');
  const { readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');

  const temp = join(tmpdir(), `saba-${Date.now()}.db`);
  backupTo(temp);
  try {
    sendFileDownload(res, `saba-backup-${dayKey()}.db`, readFileSync(temp));
  } finally {
    try { rmSync(temp); } catch { /* best effort */ }
  }
  store.audit('BACKUP', 'Backup downloaded', { actor: ctx.user.name });
});

export default router;

/* ===========================================================================
   ACCESS POLICY
   ---------------------------------------------------------------------------
   Every endpoint, and who may reach it, in one table.

   This is deliberately not spread across the handlers above. Access control
   that is written next to each route is access control nobody ever reads as a
   whole, and the question an auditor asks is never "what does this handler
   check" — it is "what can a cashier do". That question is answered by
   reading one screenful.

   screen   the endpoint belongs to this part of the system; any role that
            cannot open the screen cannot call the endpoint
   ability  additionally requires a specific permission
   open     reachable without signing in

   A route missing from this table is refused outright at start-up, so adding
   an endpoint and forgetting to classify it fails loudly on the next boot
   rather than quietly shipping wide open.
   =========================================================================== */

const POLICY = {
  'GET /api/health': { open: true },
  'GET /api/session/staff': { open: true },
  'POST /api/session': { open: true },
  'GET /api/session': {},
  'DELETE /api/session': {},

  // Every signed-in terminal reads the working set and the live stream; what
  // each role may *do* with it is decided endpoint by endpoint below.
  'GET /api/state': {},
  'GET /api/events': {},
  'GET /api/menu': {},
  'GET /api/settings': {},
  'GET /api/orders/:id': {},

  'POST /api/tables/:tableId/seat': { screen: '/floor' },
  'POST /api/orders/:id/transfer': { screen: '/floor' },
  'POST /api/orders/:id/merge': { screen: '/floor' },

  'PATCH /api/orders/:id': { screen: '/order' },
  'POST /api/orders/:id/lines': { screen: '/order' },
  'PATCH /api/orders/:id/lines/:lineId': { screen: '/order' },
  'DELETE /api/orders/:id/lines/:lineId': { screen: '/order' },
  'POST /api/orders/:id/lines/:lineId/void': { screen: '/order' },
  'POST /api/orders/:id/lines/:lineId/comp': { screen: '/order' },
  'POST /api/orders/:id/fire': { screen: '/order' },

  'POST /api/kots/:kotId/status': { screen: '/kds' },
  'POST /api/kots/:kotId/void': { screen: '/kds' },
  'POST /api/kots/:kotId/reprint': { screen: '/kds' },

  'PATCH /api/orders/:id/charges': { screen: '/bill' },
  'POST /api/orders/:id/split': { screen: '/bill' },
  'POST /api/orders/:id/invoice': { screen: '/bill' },
  'POST /api/orders/:id/payments': { screen: '/bill' },
  'DELETE /api/orders/:id/payments/:payId': { screen: '/bill' },
  'POST /api/orders/:id/settle': { screen: '/bill' },
  'POST /api/orders/:id/reopen': { screen: '/bill', ability: 'reopen' },

  // 86 is an operational call a captain makes mid-service, so it is gated on
  // the ability rather than on the Menu screen a captain cannot open.
  'POST /api/menu': { screen: '/menu', ability: 'settings' },
  'POST /api/menu/:itemId/eighty-six': { ability: 'eightySix' },
  'PATCH /api/menu/:itemId': { screen: '/menu', ability: 'settings' },

  'GET /api/reservations': { screen: '/reservations' },
  'POST /api/reservations': { screen: '/reservations' },
  'PATCH /api/reservations/:id': { screen: '/reservations' },
  'DELETE /api/reservations/:id': { screen: '/reservations' },

  'GET /api/reports': { screen: '/reports' },
  'GET /api/reports/day/:day': { screen: '/reports' },
  'GET /api/audit': { screen: '/reports' },

  'POST /api/shift/open': { ability: 'shift' },
  'POST /api/shift/close': { ability: 'shift' },

  'GET /api/export/sales.csv': { ability: 'export' },
  'GET /api/export/gst.csv': { ability: 'export' },

  'GET /api/users': { ability: 'users' },
  'POST /api/users': { ability: 'users' },
  'PATCH /api/users/:id': { ability: 'users' },
  'PATCH /api/settings': { ability: 'settings' },
  'GET /api/terminals': { ability: 'settings' },

  'POST /api/authorise': {},
  'POST /api/demo/reset': { ability: 'settings' },
  'POST /api/backup': { ability: 'backup' },
  'GET /api/backup/download': { ability: 'backup' },
};

/** Apply the table, and refuse to start if a route was left out of it. */
function applyPolicy() {
  const missing = [];
  const seen = new Set();

  for (const route of router.routes) {
    const key = `${route.method} /${route.parts.join('/')}`;
    const rule = POLICY[key];
    if (!rule) { missing.push(key); continue; }
    seen.add(key);
    route.auth = !rule.open;
    route.screen = rule.screen || null;
    route.ability = rule.ability || null;
  }

  const stale = Object.keys(POLICY).filter((key) => !seen.has(key));
  if (missing.length || stale.length) {
    const lines = [
      'The access policy and the routes do not agree.',
      ...missing.map((k) => `  route with no policy:  ${k}`),
      ...stale.map((k) => `  policy with no route:  ${k}`),
    ];
    throw new Error(lines.join('\n'));
  }
}

applyPolicy();
