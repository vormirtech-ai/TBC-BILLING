/**
 * The till, kept in this browser tab.
 *
 * The published demonstration has no server to talk to, so this stands in for
 * one. It is emphatically NOT a second implementation of the product: every
 * state transition and every figure comes from `app/src/shared/`, the same
 * pure modules the real server runs. What lives here is only the part the
 * server does with SQLite — holding the documents, handing out numbers,
 * keeping the audit log — done with a plain object instead.
 *
 * That boundary is the point. If the arithmetic on the published demo ever
 * disagreed with the arithmetic on a restaurant's till, the demo would be
 * worse than useless, so `tests/till/parity.test.mjs` runs one whole service
 * through both and insists the totals match to the paise.
 */

import {
  CHARGES, RESTAURANT, STATIONS, ROLE_LABELS, DAY_ROLLOVER_HOUR,
} from '../../shared/config.js';
import { MENU_ITEMS, MODIFIER_GROUPS } from '../../shared/catalogue.js';
import {
  SECTIONS, TABLES, tableById, useFloorPlan, floorPlan,
} from '../../shared/floorplan.js';
import { businessDay, serial } from '../../shared/format.js';
import { useCharges, charges } from '../../shared/pricing.js';
import { NUMBERING } from '../../shared/config.js';
import {
  createOrder as buildOrder, addLine, setLineQty, removeHeldLine, voidLine,
  compLine, fireCourse, advanceKot, voidKot, reprintKot, moveLineToSeat,
} from '../../shared/orders.js';

/* --------------------------------------------------------------- error --- */

/** Carries a status, so the router can answer exactly as the server would. */
export class TillError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const badRequest = (m) => new TillError(400, m);
export const notFound = (m) => new TillError(404, m);
export const conflict = (m) => new TillError(409, m);
export const forbidden = (m) => new TillError(403, m);

/* --------------------------------------------------------------- state --- */

const uid = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

export const db = {
  revision: 0,
  counters: { order: 0, invoice: 0 },
  users: [],
  orders: new Map(),
  reservations: new Map(),
  menu: new Map(),
  eightySix: new Map(),
  audit: [],
  shifts: [],
  settings: {},
  session: null,
};

export const bump = () => (db.revision += 1);
export const today = () => businessDay(Date.now(), DAY_ROLLOVER_HOUR);

export function reset() {
  db.revision = 0;
  db.counters = { order: 0, invoice: 0 };
  db.users = [];
  db.orders = new Map();
  db.reservations = new Map();
  db.menu = new Map();
  db.eightySix = new Map();
  db.audit = [];
  db.shifts = [];
  db.session = null;
  db.settings = {
    restaurant: structuredClone(RESTAURANT),
    charges: structuredClone(CHARGES),
    stations: structuredClone(STATIONS),
    printing: { billFormat: 'A4', watermark: true },
    floorplan: { sections: structuredClone(SECTIONS), tables: structuredClone(TABLES) },
  };
  useCharges(db.settings.charges);
  useFloorPlan(db.settings.floorplan);

  for (const item of MENU_ITEMS) db.menu.set(item.id, structuredClone(item));
}

export function nextCounter(name) {
  db.counters[name] = (db.counters[name] || 0) + 1;
  return db.counters[name];
}

export function audit(kind, message, { actor = 'System', meta = null } = {}) {
  db.audit.push({
    id: db.audit.length + 1, at: Date.now(), day: today(), kind, actor, message, meta,
  });
}

export const auditLog = ({ day = today(), limit = 200 } = {}) =>
  db.audit.filter((row) => row.day === day).slice(-limit).reverse();

/* ------------------------------------------------------------ settings --- */

export const allSettings = () => structuredClone(db.settings);

export function setSetting(key, value) {
  if (!(key in db.settings)) throw badRequest(`Unknown setting ${key}`);
  if (key === 'charges') value = validateCharges(value);
  if (key === 'floorplan') value = validateFloorPlan(value);
  db.settings[key] = value;
  if (key === 'charges') useCharges(value);
  if (key === 'floorplan') useFloorPlan(value);
  return value;
}

/**
 * The same checks the server makes, for the same reason: these numbers decide
 * what a guest is charged, and the demonstration should refuse a typo exactly
 * where the product would.
 */
export function validateCharges(input) {
  const given = input && typeof input === 'object' ? input : {};
  const next = { ...structuredClone(CHARGES), ...given };

  const rate = (value, what, max) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > max) {
      throw badRequest(`${what} must be between 0 and ${max}%`);
    }
    return Math.round(n * 100);
  };

  if (given.serviceChargePercent !== undefined) {
    next.serviceChargeBps = rate(given.serviceChargePercent, 'The service charge', 25);
    delete next.serviceChargePercent;
  } else {
    next.serviceChargeBps = rate(Number(next.serviceChargeBps) / 100, 'The service charge', 25);
  }
  next.serviceChargeLabel = String(next.serviceChargeLabel || 'Service Charge').slice(0, 40);

  if (!Array.isArray(next.taxComponents) || next.taxComponents.length > 4) {
    throw badRequest('A bill can carry between none and four tax components');
  }
  next.taxComponents = next.taxComponents.map((component, i) => {
    const label = String(component?.label || '').trim();
    if (!label) throw badRequest(`Tax component ${i + 1} needs a name`);
    return {
      id: String(component.id || label).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
        || `TAX${i + 1}`,
      label: label.slice(0, 24),
      bps: rate(Number(component.bps) / 100, label, 50),
    };
  });
  const ids = next.taxComponents.map((c) => c.id);
  if (new Set(ids).size !== ids.length) throw badRequest('Two tax components cannot share a name');

  next.roundOffEnabled = !!next.roundOffEnabled;
  next.serviceChargeOptional = !!next.serviceChargeOptional;
  next.pricesIncludeTax = false;

  const approval = Number(next.discountApprovalPercent);
  if (!Number.isFinite(approval) || approval < 0 || approval > 100) {
    throw badRequest('The discount approval threshold must be between 0 and 100%');
  }
  next.discountApprovalPercent = approval;
  next.maxDiscountPercent = 100;
  return next;
}

export function validateFloorPlan(input) {
  const sections = (input?.sections || []).map((section, i) => {
    const label = String(section?.label || '').trim();
    if (!label) throw badRequest(`Room ${i + 1} needs a name`);
    return {
      id: String(section.id || label).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)
        || `room${i + 1}`,
      label: label.slice(0, 40),
      short: String(section.short || label).slice(0, 16),
      note: String(section.note || '').slice(0, 60),
    };
  });
  if (!sections.length) throw badRequest('A restaurant needs at least one room');

  const roomIds = new Set(sections.map((s) => s.id));
  if (roomIds.size !== sections.length) throw badRequest('Two rooms cannot share a name');

  const clamp = (value, fallback) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(96, Math.max(4, Math.round(n)));
  };

  const tables = (input?.tables || []).map((table, i) => {
    const label = String(table?.label || '').trim();
    if (!label) throw badRequest(`Table ${i + 1} needs a number`);
    if (!roomIds.has(table.sectionId)) {
      throw badRequest(`Table ${label} is in a room that does not exist`);
    }
    const seats = Number(table.seats);
    if (!Number.isInteger(seats) || seats < 1 || seats > 40) {
      throw badRequest(`Table ${label} must seat between 1 and 40`);
    }
    return {
      id: String(table.id || '').trim() || uid('t'),
      label: label.slice(0, 12),
      sectionId: table.sectionId,
      seats,
      x: clamp(table.x, 50),
      y: clamp(table.y, 50),
      shape: ['round', 'oval', 'long'].includes(table.shape) ? table.shape : 'round',
    };
  });

  const ids = tables.map((t) => t.id);
  if (new Set(ids).size !== ids.length) throw badRequest('Two tables cannot share an id');

  const keeping = new Set(ids);
  for (const order of openOrders()) {
    if (!keeping.has(order.tableId)) {
      throw conflict(
        `Table ${order.tableLabel || order.tableId} has an open bill on it — `
        + 'settle or move it before taking the table away'
      );
    }
  }
  return { sections, tables };
}

/* ---------------------------------------------------------------- menu --- */

export function listMenu() {
  return [...db.menu.values()].map((item) => {
    const stopped = db.eightySix.get(item.id);
    return {
      ...item,
      active: item.active !== false,
      available: item.active !== false && !stopped,
      eightySixed: !!stopped,
      eightySix: stopped || null,
    };
  });
}

export const menuItem = (id) => listMenu().find((i) => i.id === id);

export function createMenuItem(input) {
  const name = String(input?.name || '').trim();
  if (!name) throw badRequest('A dish needs a name');

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
  let id = slug || 'dish';
  for (let n = 2; db.menu.has(id); n += 1) id = `${slug}-${n}`;

  const item = {
    id,
    name: name.slice(0, 80),
    category: input.category,
    station: input.station,
    course: input.course,
    pricePaise: Math.max(0, Math.round(Number(input.pricePaise) || 0)),
    costPaise: Math.max(0, Math.round(Number(input.costPaise) || 0)),
    description: String(input.description || '').slice(0, 240),
    diet: input.diet === 'NON_VEG' ? 'NON_VEG' : 'VEG',
    allergens: [],
    modifierGroups: [],
    signature: false,
    active: true,
  };
  db.menu.set(id, item);
  return menuItem(id);
}

export function updateMenuItem(id, patch) {
  const existing = db.menu.get(id);
  if (!existing) throw notFound('No such dish');
  const next = { ...existing, ...patch };
  delete next.available;
  delete next.eightySixed;
  delete next.eightySix;
  db.menu.set(id, next);
  return menuItem(id);
}

export function setEightySix(itemId, on, { actor, note = '' }) {
  const item = menuItem(itemId);
  if (!item) throw notFound('No such dish');
  if (on) db.eightySix.set(itemId, { by: actor, note, at: Date.now() });
  else db.eightySix.delete(itemId);
  audit('86', `${item.name} ${on ? 'marked 86' : 'put back on'}${note ? ` — ${note}` : ''}`,
    { actor });
  return menuItem(itemId);
}

/* -------------------------------------------------------------- orders --- */

export const getOrder = (id) => db.orders.get(id) || null;
export const openOrders = () =>
  [...db.orders.values()].filter((o) => o.status === 'OPEN')
    .sort((a, b) => a.openedAt - b.openedAt);
export const orderForTable = (tableId) =>
  openOrders().find((o) => o.tableId === tableId) || null;
export const settledOn = (day) =>
  [...db.orders.values()].filter((o) => o.status === 'SETTLED' && o.businessDay === day)
    .sort((a, b) => b.closedAt - a.closedAt);
export const ordersBetween = (from, to) =>
  [...db.orders.values()]
    .filter((o) => o.status === 'SETTLED' && o.businessDay >= from && o.businessDay <= to)
    .sort((a, b) => a.closedAt - b.closedAt);

export function mutateOrder(id, fn, { allowSettled = false } = {}) {
  const order = getOrder(id);
  if (!order) throw notFound('That table is no longer open');
  if (order.status !== 'OPEN' && !allowSettled) {
    throw conflict('That bill has already been settled');
  }
  const result = fn(order);
  bump();
  return { order, result, revision: db.revision };
}

export function seatTable({ tableId, covers, guestName, reservationId, user }) {
  const table = tableById(tableId);
  if (!table) throw notFound('No such table');
  if (orderForTable(tableId)) throw conflict(`Table ${table.label} is already open`);

  const order = buildOrder({
    number: nextCounter('order'),
    table,
    covers,
    guestName,
    user,
    reservationId: reservationId || null,
  });
  order.businessDay = today();
  db.orders.set(order.id, order);

  if (reservationId) {
    const booking = db.reservations.get(reservationId);
    if (booking) booking.status = 'SEATED';
  }

  audit('SEAT',
    `Table ${table.label} seated — ${covers} covers${guestName ? `, ${guestName}` : ''}`,
    { actor: user.name, meta: { orderId: order.id } });
  bump();
  return order;
}

export function transferTable(orderId, toTableId, user) {
  const target = tableById(toTableId);
  if (!target) throw notFound('No such table');
  if (orderForTable(toTableId)) throw conflict(`Table ${target.label} is already open`);

  const order = getOrder(orderId);
  if (!order || order.status !== 'OPEN') throw notFound('That table is no longer open');

  const from = order.tableLabel;
  order.tableId = target.id;
  order.tableLabel = target.label;
  order.sectionId = target.sectionId;
  for (const kot of order.kots) kot.tableLabel = target.label;

  audit('TRANSFER', `Table ${from} moved to ${target.label}`,
    { actor: user.name, meta: { orderId } });
  bump();
  return order;
}

export function mergeTables(sourceId, targetId, user) {
  if (sourceId === targetId) throw badRequest('Pick two different tables');
  const source = getOrder(sourceId);
  const target = getOrder(targetId);
  if (!source || source.status !== 'OPEN') throw notFound('That table is no longer open');
  if (!target || target.status !== 'OPEN') throw notFound('That table is no longer open');
  if (target.invoice) throw conflict('That table has already been billed');

  target.lines.push(...source.lines);
  target.kots.push(...source.kots.map((k) => ({
    ...k, orderId: target.id, tableLabel: target.tableLabel,
  })));
  target.covers += source.covers;
  target.kotSeq += source.kotSeq;

  source.status = 'VOID';
  source.closedAt = Date.now();
  source.mergedInto = target.id;

  audit('MERGE', `Table ${source.tableLabel} merged into ${target.tableLabel}`,
    { actor: user.name, meta: { from: sourceId, into: targetId } });
  bump();
  return target;
}

/* --------------------------------------------------------------- lines --- */

function resolveModifiers(item, ids) {
  if (!Array.isArray(ids) || !ids.length) return [];
  const wanted = new Set(ids);
  const out = [];
  for (const groupId of item.modifierGroups || []) {
    const group = MODIFIER_GROUPS[groupId];
    if (!group) continue;
    for (const option of group.options) {
      if (wanted.has(option.id)) {
        out.push({ id: option.id, label: option.label, deltaPaise: option.deltaPaise || 0 });
      }
    }
  }
  return out;
}

export function addOrderLine(orderId, { itemId, qty, seat, course, modifierIds, notes }) {
  const item = menuItem(itemId);
  if (!item) throw notFound('No such dish');
  if (!item.available) throw conflict(`${item.name} is 86 tonight`);

  const chosen = resolveModifiers(item, modifierIds);
  return mutateOrder(orderId, (order) => {
    addLine(order, item, {
      qty: Math.max(1, Math.min(99, Number(qty) || 1)),
      seat: seat ? Math.max(1, Math.min(40, Number(seat))) : null,
      course: course || item.course,
      modifiers: chosen,
      notes: String(notes || '').slice(0, 240),
    });
  }).order;
}

export const changeLineQty = (orderId, lineId, qty) =>
  mutateOrder(orderId, (order) =>
    setLineQty(order, lineId, Math.max(0, Math.min(99, Number(qty) || 0)))).order;

export const dropLine = (orderId, lineId) =>
  mutateOrder(orderId, (order) => removeHeldLine(order, lineId)).order;

export const setLineSeat = (orderId, lineId, seat) =>
  mutateOrder(orderId, (order) => moveLineToSeat(order, lineId, seat ? Number(seat) : null)).order;

export function killLine(orderId, lineId, { reason, approver }) {
  const { order } = mutateOrder(orderId, (o) => {
    const line = o.lines.find((l) => l.id === lineId);
    if (!line) throw notFound('No such line');
    if (line.status === 'VOID') throw conflict('That line is already void');
    voidLine(o, lineId, reason, approver.name);
    audit('VOID', `${line.name} voided on Table ${o.tableLabel} — ${reason}`,
      { actor: approver.name, meta: { orderId, lineId } });
  });
  return order;
}

export function toggleComp(orderId, lineId, { reason, approver }) {
  const { order } = mutateOrder(orderId, (o) => {
    const line = o.lines.find((l) => l.id === lineId);
    if (!line) throw notFound('No such line');
    compLine(o, lineId, reason, approver.name);
    audit('COMP', `${line.name} ${line.comp ? 'comped' : 'un-comped'} on Table ${o.tableLabel}`
      + `${reason ? ` — ${reason}` : ''}`,
      { actor: approver.name, meta: { orderId, lineId } });
  });
  return order;
}

export function updateOrderDetails(orderId, { covers, guestName, notes }) {
  return mutateOrder(orderId, (order) => {
    if (covers !== undefined) order.covers = Math.max(1, Math.min(40, Number(covers) || 1));
    if (guestName !== undefined) order.guestName = String(guestName).slice(0, 80);
    if (notes !== undefined) order.notes = String(notes).slice(0, 240);
  }).order;
}

/* --------------------------------------------------------------- fire --- */

export function fire(orderId, courseId, user) {
  const { order, result } = mutateOrder(orderId, (o) => fireCourse(o, courseId, user));
  if (!result?.length) throw conflict('Nothing is waiting on that course');
  audit('FIRE', `${result.length} docket${result.length === 1 ? '' : 's'} fired`
    + ` for Table ${order.tableLabel}`, { actor: user.name, meta: { orderId } });
  return order;
}

function findKot(kotId) {
  for (const order of db.orders.values()) {
    const kot = order.kots.find((k) => k.id === kotId);
    if (kot) return { order, kot };
  }
  throw notFound('No such docket');
}

export function bumpKot(kotId, to, user) {
  const { order } = findKot(kotId);
  const { result } = mutateOrder(order.id, (o) => advanceKot(o, kotId, to));
  bump();
  return { order: getOrder(order.id), kot: result };
}

export function killKot(kotId, { reason, approver }) {
  const { order, kot } = findKot(kotId);
  mutateOrder(order.id, (o) => voidKot(o, kotId, reason, approver.name));
  audit('VOID', `Docket ${kot.code} voided — ${reason}`, { actor: approver.name });
  return getOrder(order.id);
}

export function markReprint(kotId, user) {
  const { order, kot } = findKot(kotId);
  mutateOrder(order.id, (o) => reprintKot(o, kotId));
  audit('REPRINT', `Docket ${kot.code} reprinted`, { actor: user.name });
  return getOrder(order.id);
}

/* ---------------------------------------------------------------- bill --- */

export function setCharges(orderId, { serviceCharge, discount, tip }, { user, approver }) {
  return mutateOrder(orderId, (order) => {
    if (serviceCharge !== undefined) order.charges.serviceCharge = !!serviceCharge;
    if (tip !== undefined) order.charges.tipPaise = Math.max(0, Math.round(Number(tip) || 0));
    if (discount !== undefined) {
      order.charges.discount = {
        mode: discount.mode || 'NONE',
        value: Number(discount.value) || 0,
        reason: String(discount.reason || '').slice(0, 120),
        approvedBy: approver ? approver.name : '',
      };
      if (discount.mode !== 'NONE' && discount.value) {
        audit('DISCOUNT',
          `${discount.mode === 'PCT' ? `${discount.value}%` : `₹${discount.value}`}`
          + ` off Table ${order.tableLabel}${discount.reason ? ` — ${discount.reason}` : ''}`,
          { actor: (approver || user).name, meta: { orderId } });
      }
    }
  }).order;
}

export const setSplit = (orderId, split) =>
  mutateOrder(orderId, (order) => { order.split = split; }).order;

export function raiseInvoice(orderId, user) {
  return mutateOrder(orderId, (order) => {
    if (order.invoice) return;
    const number = nextCounter('invoice');
    order.invoice = {
      number,
      code: serial(NUMBERING.invoicePrefix, number, NUMBERING.padding),
      at: Date.now(),
      by: user.name,
    };
    audit('INVOICE', `Bill ${order.invoice.code} printed for Table ${order.tableLabel}`,
      { actor: user.name, meta: { orderId } });
  }).order;
}

export function addPayment(orderId, { method, paise, ref, shareId }, user) {
  return mutateOrder(orderId, (order) => {
    const amount = Math.round(Number(paise) || 0);
    if (amount <= 0) throw badRequest('A payment has to be for something');
    order.payments.push({
      id: uid('pay'),
      method,
      paise: amount,
      ref: String(ref || '').slice(0, 60),
      shareId: shareId || null,
      at: Date.now(),
      by: user.name,
    });
  }).order;
}

export function removePayment(orderId, paymentId) {
  return mutateOrder(orderId, (order) => {
    const payment = order.payments.find((p) => p.id === paymentId);
    if (!payment) throw notFound('No such payment');
    order.payments = order.payments.filter((p) => p.id !== paymentId);
  }).order;
}

export function settleOrder(orderId, user, totalDue) {
  const order = getOrder(orderId);
  if (!order) throw notFound('That table is no longer open');
  if (order.status !== 'OPEN') throw conflict('That bill has already been settled');

  const paid = order.payments.reduce((n, p) => n + p.paise, 0);
  if (paid < totalDue) {
    throw conflict(`There is still ${((totalDue - paid) / 100).toFixed(2)} to pay`);
  }

  if (!order.invoice) raiseInvoice(orderId, user);
  order.status = 'SETTLED';
  order.closedAt = Date.now();
  order.settledBy = user.name;
  audit('SETTLE', `Table ${order.tableLabel} settled — ${(totalDue / 100).toFixed(2)}`,
    { actor: user.name, meta: { orderId } });
  bump();
  return order;
}

export function reopenOrder(orderId, approver) {
  const order = getOrder(orderId);
  if (!order) throw notFound('No such bill');
  if (order.status !== 'SETTLED') throw conflict('That bill is not settled');
  if (orderForTable(order.tableId)) {
    throw conflict(`Table ${order.tableLabel} has been seated again`);
  }
  order.status = 'OPEN';
  order.closedAt = null;
  audit('REOPEN', `Bill ${order.invoice?.code || order.code} reopened`,
    { actor: approver.name, meta: { orderId } });
  bump();
  return order;
}

/* -------------------------------------------------------- reservations --- */

export const listReservations = (day = today()) =>
  [...db.reservations.values()].filter((r) => r.day === day)
    .sort((a, b) => a.at - b.at);

export function saveReservation(input, user) {
  const id = input.id || uid('res');
  const existing = db.reservations.get(id);
  const row = {
    ...(existing || {}),
    id,
    day: input.day || existing?.day || today(),
    at: Number(input.at) || existing?.at || Date.now(),
    name: String(input.name || existing?.name || '').slice(0, 80),
    phone: String(input.phone || existing?.phone || '').slice(0, 30),
    covers: Math.max(1, Number(input.covers) || existing?.covers || 2),
    tableId: input.tableId ?? existing?.tableId ?? null,
    notes: String(input.notes ?? existing?.notes ?? '').slice(0, 240),
    status: input.status || existing?.status || 'CONFIRMED',
  };
  if (!row.name) throw badRequest('A booking needs a name');
  db.reservations.set(id, row);
  audit('BOOKING', `${existing ? 'Updated' : 'Took'} a booking for ${row.name}`,
    { actor: user.name, meta: { id } });
  bump();
  return row;
}

export function dropReservation(id, user) {
  const row = db.reservations.get(id);
  if (!row) throw notFound('No such booking');
  db.reservations.delete(id);
  audit('BOOKING', `Cancelled the booking for ${row.name}`, { actor: user.name });
  bump();
  return row;
}

/* -------------------------------------------------------------- shifts --- */

export const currentShift = () => db.shifts.find((s) => !s.closed_at) || null;

export function openShift({ floatPaise, user }) {
  if (currentShift()) throw conflict('A shift is already open');
  const shift = {
    id: uid('sh'),
    day: today(),
    opened_at: Date.now(),
    opened_by: user.name,
    float_paise: Math.max(0, Math.round(floatPaise || 0)),
    closed_at: null,
    closed_by: null,
    counted_paise: null,
    doc: '{}',
  };
  db.shifts.push(shift);
  audit('SHIFT', `Till opened with a float of ${((floatPaise || 0) / 100).toFixed(2)}`,
    { actor: user.name });
  bump();
  return shift;
}

export function closeShift({ countedPaise, note, user }) {
  const shift = currentShift();
  if (!shift) throw conflict('No shift is open');
  shift.closed_at = Date.now();
  shift.closed_by = user.name;
  shift.counted_paise = Math.max(0, Math.round(countedPaise || 0));
  shift.doc = JSON.stringify({ note: String(note || '').slice(0, 240) });
  audit('SHIFT', `Till closed and counted at ${((countedPaise || 0) / 100).toFixed(2)}`,
    { actor: user.name, meta: { shiftId: shift.id } });
  bump();
  return shift;
}

/* --------------------------------------------------------- working set --- */

export function workingSet() {
  const day = today();
  return {
    revision: db.revision,
    businessDay: day,
    serverTime: Date.now(),
    tables: floorPlan().tables,
    sections: floorPlan().sections,
    orders: openOrders(),
    settled: settledOn(day),
    reservations: listReservations(day),
    menu: listMenu(),
    modifierGroups: MODIFIER_GROUPS,
    settings: allSettings(),
    activity: auditLog({ day, limit: 120 }),
    shift: currentShift(),
    counters: { ...db.counters },
  };
}

export { charges, ROLE_LABELS, uid };
