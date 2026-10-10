/**
 * What the screens talk to.
 *
 * The views were written against this module when the whole system lived in
 * one browser tab, and they still are: `orderForTable(id)` and `fire(id)`
 * read exactly as they did. What changed underneath is that the reads now
 * come from a replica of the server's state and the writes are commands sent
 * to the till.
 *
 * Keeping that boundary intact is why adding a server did not mean rewriting
 * eight screens.
 *
 * Writes return promises. A view may await one to catch a refusal — "there
 * is still 2,340.00 to pay" — but does not have to, because the replica
 * updates and every screen repaints on its own when the reply lands.
 */

import { api, ApiError, onNetworkChange, networkState, abandonQueue, whenSignedOut } from './net/api.js';
import * as live from './net/live.js';
import * as replica from './core/store.js';

import { tables as planTables, tableById } from './shared/floorplan.js';
import {
  ROLE_ABILITIES, ROLE_ROUTES, KOT_STATUS, homeFor as roleHome,
} from './shared/config.js';
import { costOrder } from './shared/pricing.js';
import { orderStage, orderValue } from './shared/orders.js';

export { ApiError, onNetworkChange, networkState };
export const subscribe = replica.subscribe;
export const getState = replica.getState;
export const isReady = replica.isReady;
export const refresh = replica.refresh;

/* --------------------------------------------------------------- boot --- */

let signedOutHandler = () => {};
export const onSignedOut = (fn) => { signedOutHandler = fn; };

/**
 * Whether this terminal has ever been signed in during this page's life.
 *
 * The opening "who am I?" request answers 401 on a terminal nobody has
 * signed into yet, and that is not a sign-out — it is the normal state of a
 * terminal at the start of a shift. Announcing it would greet every single
 * staff member with "this terminal has been signed out".
 */
let everSignedIn = false;

whenSignedOut(() => {
  abandonQueue();
  replica.clear();
  if (!everSignedIn) return;
  everSignedIn = false;
  signedOutHandler();
});

/** Open the live link and pull the first working set. */
export async function start() {
  live.connect({
    revision: (rev, reason) => replica.seenRevision(rev, reason),
    status: (status) => {
      // The event stream is the most reliable signal that the till is there:
      // it notices a cut cable long before the next command would.
      if (status.connected) replica.refresh({ reason: 'reconnected' });
      for (const fn of linkListeners) fn(status);
    },
  });
  return replica.refresh({ reason: 'start' });
}

export function stop() {
  live.disconnect();
  replica.clear();
}

const linkListeners = new Set();
export const onLinkChange = (fn) => { linkListeners.add(fn); return () => linkListeners.delete(fn); };

/* ------------------------------------------------------------ session --- */

export const session = () => replica.getState()?.user || null;
export const abilities = () => replica.getState()?.abilities || [];
export const can = (ability) => abilities().includes(ability);
export const mayOpen = (path) => (ROLE_ROUTES[session()?.role] || []).includes(path);
export const homeFor = roleHome;

export const staff = () => api.staff().then((r) => r.staff);

/** Told by the boot sequence when a session was already live on page load. */
export const noteSignedIn = () => { everSignedIn = true; };

export async function signIn(userId, pin) {
  const result = await api.signIn(userId, pin, navigator.userAgent.slice(0, 60));
  everSignedIn = true;
  await start();
  return result.user;
}

export async function signOut() {
  everSignedIn = false;
  try { await api.signOut(); } finally { stop(); }
}

/**
 * Have a manager approve something, checking the PIN there and then.
 *
 * Returns the PIN as well as the person, because the action that follows has
 * to send it: this check grants nothing by itself.
 */
export async function authorise(pin, ability) {
  const { user } = await api.authorise(pin, ability);
  return { user, pin };
}

/* --------------------------------------------------------------- reads --- */

const data = () => replica.getState() || {
  orders: [], settled: [], menu: [], reservations: [], activity: [],
  tables: planTables(),
};

export const tables = () => data().tables || planTables();
export const openOrders = () => data().orders;
export const settledToday = () => data().settled;
export const menu = () => data().menu;
export const menuItem = (id) => menu().find((i) => i.id === id);
export const modifierGroups = () => data().modifierGroups || {};
export const reservations = () => data().reservations;
export const activity = () => data().activity;
export const settings = () => data().settings || {};
export const businessDay = () => data().businessDay;
export const shift = () => data().shift || null;

export const orderById = (id) =>
  data().orders.find((o) => o.id === id) || data().settled.find((o) => o.id === id);

export const orderForTable = (tableId) =>
  data().orders.find((o) => o.tableId === tableId && o.status === 'OPEN');

export const reservationForTable = (tableId) =>
  data().reservations.find((r) => r.tableId === tableId && r.status === 'CONFIRMED');

/** Everything the floor plan needs about one table, in one object. */
export function tableView(table) {
  const order = orderForTable(table.id);
  const reservation = reservationForTable(table.id);
  const stage = order ? orderStage(order) : (reservation ? 'RESERVED' : 'VACANT');
  const onPass = order ? order.kots.filter((k) => k.status === KOT_STATUS.READY) : [];
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

/* -------------------------------------------------------------- writes --- */

/**
 * Every command follows the same shape: send it, apply the order the server
 * hands back so this terminal repaints at once, and let the live stream tell
 * everybody else.
 */
const command = (promise) => promise.then((result) => {
  if (result?.order) replica.applyOrder(result.order, result.revision);
  else if (result?.revision) replica.seenRevision(result.revision, 'command');
  return result;
});

export const seatTable = (tableId, body) => command(api.seat(tableId, body));
export const transferTable = (orderId, toTableId) => command(api.transfer(orderId, toTableId));
export const mergeTables = (sourceId, targetId) => command(api.merge(sourceId, targetId));

export const updateOrder = (orderId, body) => command(api.updateOrder(orderId, body));
export const setCovers = (orderId, covers) => command(api.updateOrder(orderId, { covers }));
export const setGuestName = (orderId, guestName) => command(api.updateOrder(orderId, { guestName }));
export const setOrderNote = (orderId, notes) => command(api.updateOrder(orderId, { notes }));

export const addItem = (orderId, item, options = {}) => command(api.addLine(orderId, {
  itemId: item.id,
  qty: options.qty ?? 1,
  seat: options.seat ?? null,
  course: options.course || item.course,
  modifierIds: (options.modifiers || []).map((m) => m.id),
  notes: options.notes || '',
}));

export const changeQty = (orderId, lineId, qty) =>
  (qty <= 0 ? command(api.dropLine(orderId, lineId))
    : command(api.setLine(orderId, lineId, { qty })));

export const dropLine = (orderId, lineId) => command(api.dropLine(orderId, lineId));
export const setSeat = (orderId, lineId, seat) => command(api.setLine(orderId, lineId, { seat }));

export const killLine = (orderId, lineId, reason, approverPin) =>
  command(api.voidLine(orderId, lineId, { reason, approverPin }));

export const toggleComp = (orderId, lineId, reason, approverPin) =>
  command(api.compLine(orderId, lineId, { reason, approverPin }));

/** Fire a course. Resolves with the dockets, so the caller can print them. */
export async function fire(orderId, courseId) {
  const result = await api.fire(orderId, courseId || null);
  replica.applyOrder(result.order, result.revision);
  return result.kots;
}

export const bumpKot = (kotId, to) => command(api.bumpKot(kotId, to));
export const killKot = (kotId, reason, approverPin) =>
  command(api.voidKot(kotId, { reason, approverPin }));
export const markReprint = (kotId) => command(api.reprintKot(kotId));

export const setServiceCharge = (orderId, on) =>
  command(api.charges(orderId, { serviceCharge: on }));

export const setDiscount = (orderId, discount, approverPin) =>
  command(api.charges(orderId, { discount, approverPin }));

export const setTip = (orderId, paise) => command(api.charges(orderId, { tip: paise }));
export const setSplit = (orderId, split) =>
  command(api.split(orderId, split ? { mode: split.mode, shares: split.shares } : { mode: 'NONE' }));

export const buildSplitOn = (orderId, mode, ways) =>
  command(api.split(orderId, { mode, ways }));

export const raiseInvoice = (orderId) => command(api.invoice(orderId));
export const addPayment = (orderId, payment) => command(api.pay(orderId, payment));
export const removePayment = (orderId, paymentId) => command(api.unpay(orderId, paymentId));
export const settleOrder = (orderId) => command(api.settle(orderId));
export const reopenOrder = (orderId, approverPin) => command(api.reopen(orderId, approverPin));

export async function setEightySix(itemId, on, note) {
  const result = await api.eightySix(itemId, on, note);
  await replica.refresh({ reason: 'menu' });
  return result.item;
}

export async function addMenuItem(body) {
  const result = await api.addItem(body);
  await replica.refresh({ reason: 'menu' });
  return result.item;
}

export async function updateMenuItem(itemId, body) {
  const result = await api.updateItem(itemId, body);
  await replica.refresh({ reason: 'menu' });
  return result.item;
}

export async function saveReservation(body) {
  const result = await api.saveReservation(body);
  await replica.refresh({ reason: 'book' });
  return result.reservation;
}

export async function dropReservation(id) {
  await api.dropReservation(id);
  await replica.refresh({ reason: 'book' });
}

export const setReservationStatus = (id, status) =>
  saveReservation({ ...reservations().find((r) => r.id === id), id, status });

/* -------------------------------------------------------------- admin --- */

export const reports = (from, to) => api.reports(from, to);
export const dayReport = (day) => api.dayReport(day || businessDay());
export const auditFor = (day) => api.audit(day);
export const users = () => api.users().then((r) => r.users);
export const addUser = (body) => api.addUser(body);
export const updateUser = (id, body) => api.updateUser(id, body);
export const saveSettings = (body) => api.saveSettings(body).then((r) => {
  replica.patchState({ settings: r.settings }, r.revision);
  return r.settings;
});
export const terminals = () => api.terminals().then((r) => r.terminals);
export const syncStatus = () => api.syncStatus().then((r) => r.sync);
export const syncNow = () => api.syncNow().then((r) => r.sync);
export const syncCheck = () => api.syncCheck();

export const openShift = (floatPaise) => api.openShift(floatPaise)
  .then((r) => { replica.seenRevision(r.revision, 'shift'); return r.shift; });
export const closeShift = (countedPaise, note) => api.closeShift(countedPaise, note)
  .then((r) => { replica.seenRevision(r.revision, 'shift'); return r; });

export const takeBackup = () => api.backup();
export const resetDemo = () => api.resetDemo().then(() => replica.refresh({ reason: 'reset' }));

export const downloadLinks = {
  sales: api.salesCsv,
  gst: api.gstCsv,
  backup: api.backupFile,
};

export { costOrder, orderStage, orderValue, tableById, api };
