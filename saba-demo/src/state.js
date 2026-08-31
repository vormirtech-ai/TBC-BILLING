/**
 * The layer between the screens and the store.
 *
 * Views never reach into state directly and never mutate it. They read through
 * the selectors here and act through the operations here, which is what makes
 * it possible to say with confidence that a table can only change status in one
 * place, and that every void ends up in the audit log.
 */

import { getState, update, logActivity, subscribe, flush, resetStore } from './core/store.js';
import { buildInitialState } from './data/seed.js';
import { MENU_ITEMS, itemById } from './data/menu.seed.js';
import { TABLES, tableById } from './data/floor.seed.js';
import {
  ROLE_ABILITIES, ROLE_ROUTES, NUMBERING, KOT_STATUS, DEMO_USERS,
} from './config.js';
import {
  createOrder, addLine, setLineQty, removeHeldLine, voidLine, compLine,
  fireCourse, advanceKot, voidKot, reprintKot, orderStage, orderValue, moveLineToSeat,
} from './domain/orders.js';
import { costOrder } from './domain/pricing.js';
import { serial } from './core/format.js';

export { subscribe, getState, flush };

/**
 * Put the whole evening back to how the demo opened.
 *
 * The signed-in person is carried across deliberately. A fresh state has no
 * session, so a plain reset would drop whoever is presenting back onto the lock
 * screen mid-sentence — which is a worse interruption than whatever they were
 * resetting.
 */
export function reset() {
  const who = session();
  resetStore(buildInitialState);
  if (who) update((s) => { s.session = who; });
  logActivity('SYSTEM', 'Demo reset — service restarted from the opening state');
  return getState();
}

/* ------------------------------------------------------------ session --- */

export const session = () => getState().session;

export const can = (ability) =>
  (ROLE_ABILITIES[session()?.role] || []).includes(ability);

export const mayOpen = (path) =>
  (ROLE_ROUTES[session()?.role] || []).includes(path);

/** The first screen this role should land on after signing in. */
export const homeFor = (role) => (ROLE_ROUTES[role] || ['/floor'])[0];

export function signIn(user) {
  update((s) => { s.session = { ...user, since: Date.now() }; });
  logActivity('SESSION', `${user.name} signed in as ${user.role}`);
}

export function signOut() {
  const who = session()?.name;
  update((s) => { s.session = null; });
  if (who) logActivity('SESSION', `${who} signed out`);
}

/* --------------------------------------------------------------- menu --- */

/**
 * The live carte: seed prices with any Settings edits applied, and anything
 * marked 86 flagged unavailable rather than removed — a captain still needs to
 * see that the sea bass exists so they can tell the guest it has gone.
 */
export function menu() {
  const state = getState();
  const off = new Set(state.eightySix.map((e) => e.itemId));
  return MENU_ITEMS.map((item) => {
    const override = state.menuOverrides[item.id] || {};
    return {
      ...item,
      ...override,
      available: override.available !== false && !off.has(item.id),
      eightySixed: off.has(item.id),
    };
  });
}

export const menuItem = (id) => menu().find((i) => i.id === id) || itemById(id);

export function setEightySix(itemId, on, note = '') {
  update((s) => {
    s.eightySix = s.eightySix.filter((e) => e.itemId !== itemId);
    if (on) s.eightySix.push({ itemId, by: s.session?.name || '', at: Date.now(), note });
  });
  const item = itemById(itemId);
  logActivity('86', `${item?.name} ${on ? 'marked 86' : 'put back on'}`);
}

export function setMenuOverride(itemId, patch) {
  update((s) => {
    s.menuOverrides[itemId] = { ...(s.menuOverrides[itemId] || {}), ...patch };
  });
}

/* -------------------------------------------------------------- floor --- */

export const tables = () => TABLES;

export const openOrders = () => getState().orders;

export const orderById = (id) => getState().orders.find((o) => o.id === id)
  || getState().settled.find((o) => o.id === id);

export const orderForTable = (tableId) =>
  getState().orders.find((o) => o.tableId === tableId && o.status === 'OPEN');

export const reservationForTable = (tableId) =>
  getState().reservations.find(
    (r) => r.tableId === tableId && r.status === 'CONFIRMED'
  );

/** Everything the floor plan needs about one table, in one object. */
export function tableView(table) {
  const order = orderForTable(table.id);
  const reservation = reservationForTable(table.id);
  const stage = order ? orderStage(order) : (reservation ? 'RESERVED' : 'VACANT');
  const onPass = order
    ? order.kots.filter((k) => k.status === KOT_STATUS.READY)
    : [];
  const waitingMin = onPass.length
    ? Math.max(...onPass.map((k) => Math.round((Date.now() - k.readyAt) / 60000)))
    : 0;
  return {
    table,
    order,
    reservation,
    stage,
    value: order ? orderValue(order) : 0,
    /** Plated food nobody has collected for more than eight minutes. */
    alert: waitingMin >= 8,
    waitingMin,
  };
}

export function seatTable(tableId, { covers, guestName, reservationId }) {
  const table = tableById(tableId);
  const user = session();
  let created = null;
  update((s) => {
    s.orderSeq += 1;
    created = createOrder({
      number: s.orderSeq, table, covers, guestName, user, reservationId,
    });
    s.orders.push(created);
    if (reservationId) {
      const reservation = s.reservations.find((r) => r.id === reservationId);
      if (reservation) reservation.status = 'SEATED';
    }
  });
  logActivity('SEAT', `Table ${table.label} seated — ${covers} covers${guestName ? `, ${guestName}` : ''}`);
  return created;
}

/** Move a whole order to a different table, keeping every docket with it. */
export function transferTable(orderId, toTableId) {
  const target = tableById(toTableId);
  let from = '';
  update((s) => {
    const order = s.orders.find((o) => o.id === orderId);
    if (!order) return;
    from = order.tableLabel;
    order.tableId = target.id;
    order.tableLabel = target.label;
    order.sectionId = target.sectionId;
    for (const kot of order.kots) kot.tableLabel = target.label;
  });
  logActivity('TRANSFER', `Table ${from} moved to ${target.label}`);
}

/** Fold one table's order into another — two tables pushed together. */
export function mergeTables(sourceOrderId, targetOrderId) {
  let summary = '';
  update((s) => {
    const source = s.orders.find((o) => o.id === sourceOrderId);
    const target = s.orders.find((o) => o.id === targetOrderId);
    if (!source || !target) return;
    summary = `Table ${source.tableLabel} merged into ${target.tableLabel}`;
    target.lines.push(...source.lines);
    target.kots.push(...source.kots.map((k) => ({ ...k, orderId: target.id, tableLabel: target.tableLabel })));
    target.covers += source.covers;
    target.kotSeq += source.kotSeq;
    s.orders = s.orders.filter((o) => o.id !== sourceOrderId);
  });
  if (summary) logActivity('MERGE', summary);
}

export function setCovers(orderId, covers) {
  update((s) => {
    const order = s.orders.find((o) => o.id === orderId);
    if (order) order.covers = Math.max(1, covers);
  });
}

export function setOrderNote(orderId, note) {
  update((s) => {
    const order = s.orders.find((o) => o.id === orderId);
    if (order) order.notes = note;
  });
}

export function setGuestName(orderId, name) {
  update((s) => {
    const order = s.orders.find((o) => o.id === orderId);
    if (order) order.guestName = name;
  });
}

/* ------------------------------------------------------------- order --- */

const mutateOrder = (orderId, fn) => update((s) => {
  const order = s.orders.find((o) => o.id === orderId);
  if (order) fn(order, s);
});

export const addItem = (orderId, item, options) =>
  mutateOrder(orderId, (order) => addLine(order, item, options));

export const changeQty = (orderId, lineId, qty) =>
  mutateOrder(orderId, (order) => setLineQty(order, lineId, qty));

export const dropLine = (orderId, lineId) =>
  mutateOrder(orderId, (order) => removeHeldLine(order, lineId));

export const setSeat = (orderId, lineId, seat) =>
  mutateOrder(orderId, (order) => moveLineToSeat(order, lineId, seat));

export function killLine(orderId, lineId, reason, approver) {
  let summary = '';
  mutateOrder(orderId, (order) => {
    const line = order.lines.find((l) => l.id === lineId);
    summary = `Voided ${line?.qty} × ${line?.name} on Table ${order.tableLabel} — ${reason}`;
    voidLine(order, lineId, reason, approver);
  });
  logActivity('VOID', summary, { by: approver });
}

export function toggleComp(orderId, lineId, reason, approver) {
  let summary = '';
  mutateOrder(orderId, (order) => {
    const line = order.lines.find((l) => l.id === lineId);
    const turningOn = !line?.comp;
    summary = `${turningOn ? 'Comped' : 'Un-comped'} ${line?.qty} × ${line?.name} on Table ${order.tableLabel}${turningOn && reason ? ` — ${reason}` : ''}`;
    compLine(order, lineId, reason, approver);
  });
  logActivity('COMP', summary, { by: approver });
}

/**
 * Send a course to the kitchen. Returns the dockets created so the caller can
 * print them — firing and printing are separate steps on purpose, because a
 * printer being out of paper must not lose the order.
 */
export function fire(orderId, courseId) {
  const user = session();
  let created = [];
  mutateOrder(orderId, (order) => {
    const result = fireCourse(order, courseId, user);
    created = result.kots;
  });
  if (created.length) {
    const order = orderById(orderId);
    logActivity('KOT', `${created.length} docket${created.length > 1 ? 's' : ''} fired for Table ${order.tableLabel} (${created.map((k) => k.code).join(', ')})`);
  }
  return created;
}

export function bumpKot(orderId, kotId, to) {
  mutateOrder(orderId, (order) => advanceKot(order, kotId, to));
}

export function killKot(orderId, kotId, reason, approver) {
  let summary = '';
  mutateOrder(orderId, (order) => {
    const kot = order.kots.find((k) => k.id === kotId);
    summary = `Docket ${kot?.code} voided on Table ${order.tableLabel} — ${reason}`;
    voidKot(order, kotId, reason, approver);
  });
  logActivity('VOID', summary, { by: approver });
}

export function markReprint(orderId, kotId) {
  mutateOrder(orderId, (order) => reprintKot(order, kotId));
}

/* -------------------------------------------------------------- bill --- */

export function setServiceCharge(orderId, on) {
  mutateOrder(orderId, (order) => { order.charges.serviceCharge = on; });
  logActivity('BILL', `Service charge ${on ? 'applied' : 'removed'} on order`);
}

export function setDiscount(orderId, discount) {
  mutateOrder(orderId, (order) => { order.charges.discount = discount; });
  if (discount.mode !== 'NONE') {
    logActivity('DISCOUNT',
      `${discount.mode === 'PCT' ? `${discount.value}%` : 'Flat'} discount applied — ${discount.reason || 'no reason given'}`,
      { by: discount.approvedBy });
  }
}

export function setTip(orderId, paise) {
  mutateOrder(orderId, (order) => { order.charges.tipPaise = paise; });
}

export function setSplit(orderId, split) {
  mutateOrder(orderId, (order) => { order.split = split; });
}

/** Print the bill: stamps an invoice number and freezes the table as BILLED. */
export function raiseInvoice(orderId) {
  let invoice = null;
  update((s) => {
    const order = s.orders.find((o) => o.id === orderId);
    if (!order || order.invoice) { invoice = order?.invoice || null; return; }
    s.invoiceSeq += 1;
    invoice = {
      number: s.invoiceSeq,
      code: serial(NUMBERING.invoicePrefix, s.invoiceSeq, NUMBERING.padding),
      at: Date.now(),
      by: s.session?.name || '',
    };
    order.invoice = invoice;
  });
  const order = orderById(orderId);
  logActivity('BILL', `Bill printed for Table ${order.tableLabel} · ${invoice?.code}`);
  return invoice;
}

export function addPayment(orderId, payment) {
  mutateOrder(orderId, (order) => {
    order.payments.push({
      id: `pay_${Date.now().toString(36)}`,
      at: Date.now(),
      by: getState().session?.name || '',
      ...payment,
    });
  });
}

export function removePayment(orderId, paymentId) {
  mutateOrder(orderId, (order) => {
    order.payments = order.payments.filter((p) => p.id !== paymentId);
  });
}

/**
 * Close the table. The order moves out of the live list into today's settled
 * bills, where the reports pick it up and where it can still be reprinted.
 */
export function settleOrder(orderId) {
  let closed = null;
  update((s) => {
    const index = s.orders.findIndex((o) => o.id === orderId);
    if (index < 0) return;
    const [order] = s.orders.splice(index, 1);
    order.status = 'SETTLED';
    order.closedAt = Date.now();
    s.settled.unshift(order);
    closed = order;
  });
  if (closed) {
    const total = costOrder(closed).total;
    logActivity('SETTLE', `Table ${closed.tableLabel} settled · ${closed.invoice?.code || closed.code} · ₹${(total / 100).toFixed(2)}`);
  }
  return closed;
}

/** Pull a settled bill back onto the floor. Manager only, always logged. */
export function reopenOrder(orderId, approver) {
  let reopened = null;
  update((s) => {
    const index = s.settled.findIndex((o) => o.id === orderId);
    if (index < 0) return;
    const [order] = s.settled.splice(index, 1);
    order.status = 'OPEN';
    order.closedAt = null;
    s.orders.push(order);
    reopened = order;
  });
  if (reopened) {
    logActivity('REOPEN', `Bill ${reopened.invoice?.code} reopened on Table ${reopened.tableLabel}`, { by: approver });
  }
  return reopened;
}

/* ------------------------------------------------------ reservations --- */

export const reservations = () => getState().reservations;

export function addReservation(row) {
  update((s) => {
    s.reservations.push({ id: `res_${Date.now().toString(36)}`, status: 'CONFIRMED', ...row });
    s.reservations.sort((a, b) => a.at - b.at);
  });
  logActivity('BOOKING', `${row.name} booked for ${row.covers}`);
}

export function setReservationStatus(id, status) {
  update((s) => {
    const reservation = s.reservations.find((r) => r.id === id);
    if (reservation) reservation.status = status;
  });
}

export function dropReservation(id) {
  update((s) => { s.reservations = s.reservations.filter((r) => r.id !== id); });
}

/* -------------------------------------------------------------- misc --- */

export const users = () => getState().users || DEMO_USERS;
export const activity = () => getState().activity;
export { costOrder, orderStage, orderValue, tableById };
