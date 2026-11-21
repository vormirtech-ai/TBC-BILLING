/**
 * The authoritative state.
 *
 * Every change to a table, an order or a docket passes through this module,
 * inside a transaction, and bumps the revision that terminals watch. The
 * browser holds a replica; this holds the truth.
 *
 * The business logic itself is not here. It lives in app/src/shared/, is
 * pure, and is the very same code the browser runs — so the bill the captain
 * sees being added up and the bill the server stores cannot drift apart.
 * This module's job is to load a document, hand it to one of those pure
 * functions, write the result back, and say what changed.
 */

import { randomUUID } from 'node:crypto';

import { one, all, run, tx, bumpRevision, currentRevision, nextCounter } from './db/index.js';
import { HttpError, conflict, notFound } from './http/kit.js';
import { log } from './log.js';

import {
  NUMBERING, DAY_ROLLOVER_HOUR, RESTAURANT, CHARGES, STATIONS, COURSES,
  PAYMENT_METHODS,
} from '../app/src/shared/config.js';
import { businessDay, serial } from '../app/src/shared/format.js';
import { costOrder, useCharges, charges } from '../app/src/shared/pricing.js';
import {
  createOrder as buildOrder, addLine, setLineQty, removeHeldLine, voidLine,
  compLine, fireCourse, advanceKot, voidKot, reprintKot, moveLineToSeat,
  orderStage, orderValue, kotLines,
} from '../app/src/shared/orders.js';
import {
  SECTIONS, TABLES, tableById, useFloorPlan, floorPlan,
} from '../app/src/shared/floorplan.js';

/* ------------------------------------------------------------ settings --- */

const SETTING_DEFAULTS = {
  restaurant: RESTAURANT,
  charges: CHARGES,
  stations: STATIONS,
  printing: {
    billFormat: 'A4',
    watermark: true,
    /**
     * Where kitchen dockets print, or '' for the screen only.
     *
     * A network printer is `host:port` — almost always port 9100, which is
     * what "raw printing" means. A USB one on Linux is its device file,
     * such as /dev/usb/lp0.
     */
    kotPrinter: '',
    paper: '80mm',
  },
  floorplan: { sections: SECTIONS, tables: TABLES },
};

export function getSetting(key) {
  const row = one('SELECT value FROM settings WHERE key = ?', key);
  if (!row) return structuredClone(SETTING_DEFAULTS[key] ?? null);
  try {
    return JSON.parse(row.value);
  } catch {
    log.warn('unreadable setting, falling back to the default', { key });
    return structuredClone(SETTING_DEFAULTS[key] ?? null);
  }
}

export function allSettings() {
  const out = {};
  for (const key of Object.keys(SETTING_DEFAULTS)) out[key] = getSetting(key);
  return out;
}

export function setSetting(key, value) {
  if (!(key in SETTING_DEFAULTS)) throw new HttpError(400, `Unknown setting ${key}`);
  // Checked, but not put into force here: the caller's transaction may still
  // roll back, and the tariff the server costs bills with must never be one
  // the database does not hold. loadCharges() does that, after the commit.
  if (key === 'charges') value = validateCharges(value);
  if (key === 'floorplan') value = validateFloorPlan(value);
  run(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)'
    + ' ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    key, JSON.stringify(value), Date.now()
  );
  return value;
}

/**
 * Load the restaurant's tariff into the pricing module.
 *
 * Called once when the server boots, before it accepts a request. Without it
 * the server would cost bills with the defaults while the terminals, which
 * are handed the stored settings with the working set, used the real rates.
 */
export function loadCharges() {
  return useCharges(getSetting('charges'));
}

/**
 * Check a tariff before it is stored.
 *
 * These numbers decide what a guest is charged and what the restaurant owes
 * in tax, and they are typed in by an owner on a tablet. A typo that turns
 * 2.5% into 250% must be refused here, not discovered by an accountant in
 * April.
 */
export function validateCharges(input) {
  const given = input && typeof input === 'object' ? input : {};
  const next = { ...structuredClone(CHARGES), ...given };

  const rate = (value, what, max) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > max) {
      throw new HttpError(400, `${what} must be between 0 and ${max}%`);
    }
    // Held in basis points, so a quarter of a percent is exact.
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
    throw new HttpError(400, 'A bill can carry between none and four tax components');
  }
  next.taxComponents = next.taxComponents.map((component, i) => {
    const label = String(component?.label || '').trim();
    if (!label) throw new HttpError(400, `Tax component ${i + 1} needs a name`);
    return {
      id: String(component.id || label).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || `TAX${i + 1}`,
      label: label.slice(0, 24),
      bps: rate(Number(component.bps) / 100, label, 50),
    };
  });

  const ids = next.taxComponents.map((c) => c.id);
  if (new Set(ids).size !== ids.length) {
    throw new HttpError(400, 'Two tax components cannot share a name');
  }

  next.roundOffEnabled = !!next.roundOffEnabled;
  next.serviceChargeOptional = !!next.serviceChargeOptional;
  next.pricesIncludeTax = false;      // not supported; see HANDOVER.md

  const approval = Number(next.discountApprovalPercent);
  if (!Number.isFinite(approval) || approval < 0 || approval > 100) {
    throw new HttpError(400, 'The discount approval threshold must be between 0 and 100%');
  }
  next.discountApprovalPercent = approval;
  next.maxDiscountPercent = 100;

  return next;
}

/** The restaurant's own rooms and tables, loaded before it opens. */
export function loadFloorPlan() {
  return useFloorPlan(getSetting('floorplan'));
}

/**
 * Check a floor plan before it is stored.
 *
 * A table that two orders could point at, or one that vanishes while people
 * are sitting at it, is worse than no floor plan at all — so an id is never
 * reused, never duplicated, and a table carrying an open order cannot be
 * removed.
 */
export function validateFloorPlan(input) {
  const sections = (input?.sections || []).map((section, i) => {
    const label = String(section?.label || '').trim();
    if (!label) throw new HttpError(400, `Room ${i + 1} needs a name`);
    return {
      id: String(section.id || label).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)
        || `room${i + 1}`,
      label: label.slice(0, 40),
      short: String(section.short || label).slice(0, 16),
      note: String(section.note || '').slice(0, 60),
    };
  });
  if (!sections.length) throw new HttpError(400, 'A restaurant needs at least one room');

  const roomIds = new Set(sections.map((s) => s.id));
  if (roomIds.size !== sections.length) {
    throw new HttpError(400, 'Two rooms cannot share a name');
  }

  const tables = (input?.tables || []).map((table, i) => {
    const label = String(table?.label || '').trim();
    if (!label) throw new HttpError(400, `Table ${i + 1} needs a number`);
    if (!roomIds.has(table.sectionId)) {
      throw new HttpError(400, `Table ${label} is in a room that does not exist`);
    }
    const seats = Number(table.seats);
    if (!Number.isInteger(seats) || seats < 1 || seats > 40) {
      throw new HttpError(400, `Table ${label} must seat between 1 and 40`);
    }
    return {
      id: String(table.id || '').trim() || `t_${randomUUID().slice(0, 8)}`,
      label: label.slice(0, 12),
      sectionId: table.sectionId,
      seats,
      x: clampPercent(table.x, 50),
      y: clampPercent(table.y, 50),
      shape: ['round', 'oval', 'long'].includes(table.shape) ? table.shape : 'round',
    };
  });

  const ids = tables.map((t) => t.id);
  if (new Set(ids).size !== ids.length) {
    throw new HttpError(400, 'Two tables cannot share an id');
  }

  // Nobody is left standing: a table with people at it stays on the plan.
  const keeping = new Set(ids);
  for (const order of openOrders()) {
    if (!keeping.has(order.tableId)) {
      throw new HttpError(409,
        `Table ${order.tableLabel || order.tableId} has an open bill on it — `
        + 'settle or move it before taking the table away');
    }
  }

  return { sections, tables };
}

const clampPercent = (value, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(96, Math.max(4, Math.round(n)));
};

export const today = () => businessDay(Date.now(), DAY_ROLLOVER_HOUR);

/* --------------------------------------------------------------- audit --- */

export function audit(kind, message, { actor = 'System', meta = null } = {}) {
  run(
    'INSERT INTO audit (at, day, kind, actor, message, meta) VALUES (?, ?, ?, ?, ?, ?)',
    Date.now(), today(), kind, actor, message, meta ? JSON.stringify(meta) : null
  );
}

export function auditLog({ day = today(), limit = 200 } = {}) {
  return all(
    'SELECT id, at, kind, actor, message, meta FROM audit WHERE day = ? ORDER BY at DESC LIMIT ?',
    day, limit
  ).map((row) => ({ ...row, meta: row.meta ? JSON.parse(row.meta) : null }));
}

/* ---------------------------------------------------------------- menu --- */

export function listMenu() {
  const off = new Map(all('SELECT * FROM eighty_six').map((r) => [r.item_id, r]));
  return all('SELECT * FROM menu_items ORDER BY sort, id').map((row) => {
    const item = JSON.parse(row.doc);
    const stopped = off.get(row.id);
    return {
      ...item,
      id: row.id,
      active: !!row.active,
      available: !!row.active && !stopped,
      eightySixed: !!stopped,
      eightySix: stopped
        ? { by: stopped.by_name, at: stopped.at, note: stopped.note }
        : null,
    };
  });
}

export const menuItem = (id) => listMenu().find((i) => i.id === id);

export function upsertMenuItem(item) {
  const now = Date.now();
  run(
    'INSERT INTO menu_items (id, category, station, sort, active, doc, updated_at)'
    + ' VALUES (?, ?, ?, ?, ?, ?, ?)'
    + ' ON CONFLICT (id) DO UPDATE SET category = excluded.category,'
    + ' station = excluded.station, sort = excluded.sort, active = excluded.active,'
    + ' doc = excluded.doc, updated_at = excluded.updated_at',
    item.id, item.category, item.station, item.sort ?? 0,
    item.active === false ? 0 : 1, JSON.stringify(item), now
  );
  return menuItem(item.id);
}

/**
 * Put a new dish on the carte.
 *
 * A restaurant changes its menu with the season, and should not have to
 * telephone anybody to do it. The id is derived from the name and kept
 * stable afterwards, because every line on every bill ever taken refers to
 * it — which is also why a dish is retired rather than deleted.
 */
export function createMenuItem(input) {
  const name = String(input?.name || '').trim();
  if (!name) throw new HttpError(400, 'A dish needs a name');

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
  const taken = new Set(all('SELECT id FROM menu_items').map((r) => r.id));
  let id = slug || 'dish';
  for (let n = 2; taken.has(id); n += 1) id = `${slug}-${n}`;

  const sort = (one('SELECT max(sort) AS n FROM menu_items WHERE category = ?',
    input.category)?.n ?? 0) + 1;

  return upsertMenuItem({
    id,
    name: name.slice(0, 80),
    category: input.category,
    station: input.station,
    course: input.course,
    pricePaise: Math.max(0, Math.round(Number(input.pricePaise) || 0)),
    costPaise: Math.max(0, Math.round(Number(input.costPaise) || 0)),
    halfPricePaise: Number(input.halfPricePaise) > 0
      ? Math.round(Number(input.halfPricePaise))
      : null,
    description: String(input.description || '').slice(0, 240),
    diet: input.diet === 'NON_VEG' ? 'NON_VEG' : 'VEG',
    allergens: Array.isArray(input.allergens) ? input.allergens.slice(0, 8) : [],
    modifierGroups: [],
    signature: false,
    active: true,
    sort,
  });
}

export function setEightySix(itemId, on, { actor, note = '' }) {
  const item = menuItem(itemId);
  if (!item) throw notFound('No such dish');
  if (on) {
    run(
      'INSERT INTO eighty_six (item_id, by_name, note, at) VALUES (?, ?, ?, ?)'
      + ' ON CONFLICT (item_id) DO UPDATE SET by_name = excluded.by_name,'
      + ' note = excluded.note, at = excluded.at',
      itemId, actor, note, Date.now()
    );
  } else {
    run('DELETE FROM eighty_six WHERE item_id = ?', itemId);
  }
  audit('86', `${item.name} ${on ? 'marked 86' : 'put back on'}${note ? ` — ${note}` : ''}`,
    { actor });
  return menuItem(itemId);
}

/* --------------------------------------------------------------- order --- */

const rowToOrder = (row) => (row ? JSON.parse(row.doc) : null);

export const getOrder = (id) =>
  rowToOrder(one('SELECT doc FROM orders WHERE id = ?', id));

export const openOrders = () =>
  all("SELECT doc FROM orders WHERE status = 'OPEN' ORDER BY opened_at").map(rowToOrder);

export const orderForTable = (tableId) =>
  rowToOrder(one("SELECT doc FROM orders WHERE table_id = ? AND status = 'OPEN'", tableId));

export const settledOn = (day) =>
  all("SELECT doc FROM orders WHERE business_day = ? AND status = 'SETTLED' ORDER BY closed_at DESC", day)
    .map(rowToOrder);

export const ordersBetween = (from, to) =>
  all(
    "SELECT doc FROM orders WHERE business_day >= ? AND business_day <= ? AND status = 'SETTLED'"
    + ' ORDER BY closed_at',
    from, to
  ).map(rowToOrder);

/** Write an order document back, keeping the indexed columns in step. */
function persist(order) {
  const totals = costOrder(order);
  run(
    'INSERT INTO orders (id, number, code, business_day, table_id, status, invoice_no,'
    + ' opened_at, closed_at, total_paise, covers, doc, updated_at)'
    + ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    + ' ON CONFLICT (id) DO UPDATE SET table_id = excluded.table_id, status = excluded.status,'
    + ' invoice_no = excluded.invoice_no, closed_at = excluded.closed_at,'
    + ' total_paise = excluded.total_paise, covers = excluded.covers,'
    + ' doc = excluded.doc, updated_at = excluded.updated_at',
    order.id, order.number, order.code, order.businessDay, order.tableId,
    order.status, order.invoice?.number ?? null, order.openedAt, order.closedAt ?? null,
    totals.total, order.covers, JSON.stringify(order), Date.now()
  );
  return order;
}

/**
 * Load an order, apply a pure domain change to it, and write it back —
 * all inside one transaction, with the revision bumped so every terminal
 * learns about it.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.allowSettled] let the change touch a closed bill
 * @returns {{ order: object, result: * , revision: number }}
 */
export function mutateOrder(id, fn, opts = {}) {
  return tx(() => {
    const order = getOrder(id);
    if (!order) throw notFound('That table is no longer open');
    if (order.status !== 'OPEN' && !opts.allowSettled) {
      throw conflict('That bill has already been settled');
    }
    const result = fn(order);
    persist(order);
    const revision = bumpRevision();
    return { order, result, revision };
  });
}

/* ------------------------------------------------------------- seating --- */

export function seatTable({ tableId, covers, guestName, reservationId, user }) {
  const table = tableById(tableId);
  if (!table) throw notFound('No such table');

  return tx(() => {
    if (orderForTable(tableId)) {
      throw conflict(`Table ${table.label} is already open`);
    }
    const number = nextCounter('order', 1);
    const order = buildOrder({
      number,
      table,
      covers,
      guestName,
      user,
      reservationId: reservationId || null,
    });
    order.businessDay = today();
    persist(order);

    if (reservationId) {
      run("UPDATE reservations SET status = 'SEATED', updated_at = ? WHERE id = ?",
        Date.now(), reservationId);
      const row = one('SELECT doc FROM reservations WHERE id = ?', reservationId);
      if (row) {
        const doc = JSON.parse(row.doc);
        doc.status = 'SEATED';
        run('UPDATE reservations SET doc = ? WHERE id = ?', JSON.stringify(doc), reservationId);
      }
    }

    audit('SEAT',
      `Table ${table.label} seated — ${covers} covers${guestName ? `, ${guestName}` : ''}`,
      { actor: user.name, meta: { orderId: order.id } });
    bumpRevision();
    return order;
  });
}

export function transferTable(orderId, toTableId, user) {
  const target = tableById(toTableId);
  if (!target) throw notFound('No such table');

  return tx(() => {
    if (orderForTable(toTableId)) {
      throw conflict(`Table ${target.label} is already open`);
    }
    const order = getOrder(orderId);
    if (!order || order.status !== 'OPEN') throw notFound('That table is no longer open');

    const from = order.tableLabel;
    order.tableId = target.id;
    order.tableLabel = target.label;
    order.sectionId = target.sectionId;
    for (const kot of order.kots) kot.tableLabel = target.label;
    persist(order);

    audit('TRANSFER', `Table ${from} moved to ${target.label}`,
      { actor: user.name, meta: { orderId } });
    bumpRevision();
    return order;
  });
}

export function mergeTables(sourceId, targetId, user) {
  if (sourceId === targetId) throw new HttpError(400, 'Pick two different tables');

  return tx(() => {
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
    persist(target);

    source.status = 'VOID';
    source.closedAt = Date.now();
    source.mergedInto = target.id;
    persist(source);

    audit('MERGE', `Table ${source.tableLabel} merged into ${target.tableLabel}`,
      { actor: user.name, meta: { from: sourceId, into: targetId } });
    bumpRevision();
    return target;
  });
}

/* --------------------------------------------------------------- lines --- */

export function addOrderLine(orderId,
  { itemId, qty, seat, course, modifierIds, notes, portion }, user) {
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
      portion: portion === 'HALF' ? 'HALF' : 'FULL',
      notes: String(notes || '').slice(0, 240),
    });
  }).order;
}

/**
 * Turn the modifier ids a terminal sent into priced modifiers from the
 * catalogue. The client never gets to name its own price: it sends ids, and
 * the amounts come from the server's own copy of the menu.
 */
function resolveModifiers(item, ids) {
  if (!Array.isArray(ids) || !ids.length) return [];
  const groups = getSetting('modifierGroups') || MODIFIER_GROUPS;
  const wanted = new Set(ids);
  const out = [];
  for (const groupId of item.modifierGroups || []) {
    const group = groups[groupId];
    if (!group) continue;
    for (const option of group.options) {
      if (wanted.has(option.id)) {
        out.push({ id: option.id, label: option.label, deltaPaise: option.deltaPaise || 0 });
      }
    }
  }
  return out;
}

let MODIFIER_GROUPS = {};
export function registerModifierGroups(groups) { MODIFIER_GROUPS = groups; }
export function getModifierGroups() { return MODIFIER_GROUPS; }

export const changeLineQty = (orderId, lineId, qty) =>
  mutateOrder(orderId, (order) =>
    setLineQty(order, lineId, Math.max(0, Math.min(99, Number(qty) || 0)))).order;

export const dropLine = (orderId, lineId) =>
  mutateOrder(orderId, (order) => removeHeldLine(order, lineId)).order;

export const setLineSeat = (orderId, lineId, seat) =>
  mutateOrder(orderId, (order) =>
    moveLineToSeat(order, lineId, seat ? Number(seat) : null)).order;

export function killLine(orderId, lineId, { reason, approver }) {
  const { order } = mutateOrder(orderId, (o) => {
    const line = o.lines.find((l) => l.id === lineId);
    if (!line) throw notFound('No such line');
    if (line.status === 'VOID') throw conflict('That line is already void');
    voidLine(o, lineId, reason, approver.name);
    audit('VOID',
      `Voided ${line.qty} × ${line.name} on Table ${o.tableLabel} — ${reason}`,
      { actor: approver.name, meta: { orderId, lineId } });
  });
  return order;
}

export function toggleComp(orderId, lineId, { reason, approver }) {
  const { order } = mutateOrder(orderId, (o) => {
    const line = o.lines.find((l) => l.id === lineId);
    if (!line) throw notFound('No such line');
    const turningOn = !line.comp;
    compLine(o, lineId, reason, approver.name);
    audit('COMP',
      `${turningOn ? 'Comped' : 'Un-comped'} ${line.qty} × ${line.name}`
      + ` on Table ${o.tableLabel}${turningOn && reason ? ` — ${reason}` : ''}`,
      { actor: approver.name, meta: { orderId, lineId } });
  });
  return order;
}

/**
 * Move one dish to another table.
 *
 * For the thing that happens in every dining room: the lamb goes to six when
 * it was ordered on four. The guests have it, nobody wants it back, and the
 * only question left is whose bill it lands on.
 *
 * The money moves with the dish. What does not move is the docket it was
 * cooked on: that ticket was printed for table four and the kitchen made it
 * for table four, and rewriting history to tidy up a mistake would make the
 * audit trail a worse record than the mistake. The line keeps its timings
 * and its kot id, carries a note saying where it came from, and both bills
 * say what happened.
 *
 * Seat numbers are dropped, because seat 2 on another table is somebody else.
 */
export function moveLineToOrder(fromOrderId, lineId, toOrderId, { approver }) {
  if (fromOrderId === toOrderId) throw new HttpError(400, 'That is the same table');

  return tx(() => {
    const from = getOrder(fromOrderId);
    const to = getOrder(toOrderId);
    if (!from || from.status !== 'OPEN') throw notFound('That table is no longer open');
    if (!to || to.status !== 'OPEN') throw notFound('The other table is no longer open');
    if (to.invoice) throw conflict(`Table ${to.tableLabel} has already been billed`);

    if (from.invoice) {
      throw conflict(
        `Table ${from.tableLabel} has already been billed as ${from.invoice.code}.`
        + ' Moving a dish off a printed bill would change a total the guest has'
        + ' already been shown — void the line and add it to the other table.'
      );
    }

    const line = from.lines.find((l) => l.id === lineId);
    if (!line) throw notFound('No such line');
    if (line.status === 'VOID') throw conflict('That line is already void');

    from.lines = from.lines.filter((l) => l.id !== lineId);
    to.lines.push({
      ...line,
      seat: null,
      movedFrom: from.tableLabel,
      movedAt: Date.now(),
      movedBy: approver.name,
    });

    persist(from);
    persist(to);

    const what = `${line.qty} × ${line.name}`;
    audit('MOVE', `${what} moved from Table ${from.tableLabel} to Table ${to.tableLabel}`,
      { actor: approver.name, meta: { lineId, from: fromOrderId, to: toOrderId } });
    bumpRevision();
    return { from, to };
  });
}

export function updateOrderDetails(orderId, { covers, guestName, notes }) {
  return mutateOrder(orderId, (order) => {
    if (covers !== undefined) order.covers = Math.max(1, Math.min(60, Number(covers) || 1));
    if (guestName !== undefined) order.guestName = String(guestName).slice(0, 80);
    if (notes !== undefined) order.notes = String(notes).slice(0, 400);
  }).order;
}

/* ---------------------------------------------------------------- KOTs --- */

export function fire(orderId, courseId, user) {
  const { order, result } = mutateOrder(orderId, (o) => {
    const { kots } = fireCourse(o, courseId || null, user);
    if (kots.length) {
      audit('KOT',
        `${kots.length} docket${kots.length > 1 ? 's' : ''} fired for Table ${o.tableLabel}`
        + ` (${kots.map((k) => k.code).join(', ')})`,
        { actor: user.name, meta: { orderId, kots: kots.map((k) => k.code) } });
    }
    return kots;
  });

  // On paper too, if the kitchen has a printer. Deliberately not awaited: a
  // printer that is off or out of paper must not hold up a course going to
  // the pass, and the kitchen screen has the docket either way.
  printDockets(order, result);

  return { order, kots: result };
}

/**
 * Put the dockets on paper.
 *
 * Fire-and-forget, by design. Nothing here is awaited and nothing here can
 * throw into the caller: the worst a dead printer does is write one line to
 * the log and leave the kitchen reading its screen, which is what a kitchen
 * display is for.
 */
function printDockets(order, kots) {
  const printing = getSetting('printing') || {};
  if (!printing.kotPrinter || !kots?.length) return;

  (async () => {
    const [{ renderKot }, printer] = await Promise.all([
      import('./printer/escpos.js'),
      import('./printer/index.js'),
    ]);
    for (const kot of kots) {
      const lines = kotLines(order, kot);
      if (!lines.length) continue;
      await printer.send(kot.printer || printing.kotPrinter,
        renderKot(kot, lines, order, { paper: printing.paper || '80mm' }));
    }
  })().catch((error) => log.error('printing failed', { error: error.message }));
}

/** Dockets are addressed by their own id; the server finds the order. */
function orderOfKot(kotId) {
  for (const order of openOrders()) {
    if (order.kots.some((k) => k.id === kotId)) return order;
  }
  return null;
}

export function bumpKot(kotId, to, user) {
  const found = orderOfKot(kotId);
  if (!found) throw notFound('That docket is no longer on the pass');
  const { order } = mutateOrder(found.id, (o) => {
    advanceKot(o, kotId, to);
  });
  log.debug('docket bumped', { kotId, to, by: user.name });
  return order;
}

export function killKot(kotId, { reason, approver }) {
  const found = orderOfKot(kotId);
  if (!found) throw notFound('That docket is no longer on the pass');
  const { order } = mutateOrder(found.id, (o) => {
    const kot = o.kots.find((k) => k.id === kotId);
    voidKot(o, kotId, reason, approver.name);
    audit('VOID', `Docket ${kot.code} voided on Table ${o.tableLabel} — ${reason}`,
      { actor: approver.name, meta: { orderId: o.id, kotId } });
  });
  return order;
}

export function markReprint(kotId, user) {
  const found = orderOfKot(kotId);
  if (!found) throw notFound('That docket is no longer on the pass');
  const { order } = mutateOrder(found.id, (o) => {
    reprintKot(o, kotId);
    const kot = o.kots.find((k) => k.id === kotId);
    audit('REPRINT', `Docket ${kot.code} reprinted (copy ${kot.printCount})`,
      { actor: user.name, meta: { orderId: o.id, kotId } });
  });
  return order;
}

/* ---------------------------------------------------------------- bill --- */

export function setCharges(orderId, { serviceCharge, discount, tip }, { user, approver }) {
  return mutateOrder(orderId, (order) => {
    if (serviceCharge !== undefined) {
      order.charges.serviceCharge = !!serviceCharge;
      audit('BILL',
        `Service charge ${serviceCharge ? 'applied' : 'removed'} on Table ${order.tableLabel}`
        + (!serviceCharge && approver ? ` (approved by ${approver.name})` : ''),
        { actor: user.name, meta: { orderId } });
    }
    if (discount !== undefined) {
      const mode = discount?.mode === 'PCT' || discount?.mode === 'FLAT' ? discount.mode : 'NONE';
      const value = mode === 'NONE' ? 0 : Math.max(0, Number(discount.value) || 0);
      order.charges.discount = {
        mode,
        value,
        reason: String(discount?.reason || '').slice(0, 120),
        approvedBy: approver?.name || user.name,
      };
      if (mode !== 'NONE') {
        audit('DISCOUNT',
          `${mode === 'PCT' ? `${value}%` : 'Flat'} discount on Table ${order.tableLabel}`
          + ` — ${order.charges.discount.reason || 'no reason given'}`,
          { actor: approver?.name || user.name, meta: { orderId } });
      }
    }
    if (tip !== undefined) {
      order.charges.tipPaise = Math.max(0, Math.round(Number(tip) || 0));
    }
  }).order;
}

export function setSplit(orderId, split) {
  return mutateOrder(orderId, (order) => {
    // Each payment is taken against one share. Re-cut the bill underneath
    // them and that money is attached to a share that no longer exists, so
    // the shares stop adding up to what has actually been paid.
    if (order.payments.length) {
      throw conflict('Money has already been taken on this bill, so it cannot'
        + ' be split differently. Remove the payments first.');
    }
    order.split = split;
  }).order;
}

export function raiseInvoice(orderId, user) {
  return tx(() => {
    const order = getOrder(orderId);
    if (!order) throw notFound('That table is no longer open');
    if (order.status !== 'OPEN') throw conflict('That bill has already been settled');
    if (order.invoice) return order; // printing twice must not take a second number

    const number = nextCounter('invoice', 1);
    order.invoice = {
      number,
      code: serial(NUMBERING.invoicePrefix, number, NUMBERING.padding),
      at: Date.now(),
      by: user.name,
    };
    persist(order);
    audit('BILL', `Bill printed for Table ${order.tableLabel} · ${order.invoice.code}`,
      { actor: user.name, meta: { orderId } });
    bumpRevision();
    return order;
  });
}

export function addPayment(orderId, { method, paise, ref, shareId }, user) {
  const amount = Math.round(Number(paise) || 0);
  if (amount <= 0) throw new HttpError(400, 'A payment has to be more than nothing');
  // An unknown tender would quietly become its own column in the day's
  // takings, and only CASH is counted against the drawer at close.
  if (!PAYMENT_METHODS.some((m) => m.id === method)) {
    throw new HttpError(400, `${method} is not a way this till takes money`);
  }

  return mutateOrder(orderId, (order) => {
    order.payments.push({
      id: `pay_${randomUUID().slice(0, 12)}`,
      method,
      paise: amount,
      ref: String(ref || '').slice(0, 60),
      shareId: shareId || null,
      at: Date.now(),
      by: user.name,
    });

    // Every tender, named, with who took it. Only cash counts to the drawer,
    // so a cash payment entered as UPI is cash nobody expects to find — and
    // without this line there was nothing to find it by.
    audit('PAYMENT',
      `${method} ${(amount / 100).toFixed(2)} taken on Table ${order.tableLabel}`
      + (ref ? ` — ref ${String(ref).slice(0, 60)}` : ''),
      { actor: user.name, meta: { orderId, method, paise: amount } });
  }).order;
}

export function removePayment(orderId, paymentId, { user, approver, reason }) {
  return mutateOrder(orderId, (order) => {
    const payment = order.payments.find((p) => p.id === paymentId);
    if (!payment) throw notFound('No such payment');
    order.payments = order.payments.filter((p) => p.id !== paymentId);
    audit('PAYMENT',
      `Removed a ${payment.method} payment of ${(payment.paise / 100).toFixed(2)}`
      + ` from Table ${order.tableLabel} — ${reason}`
      + (approver ? ` (approved by ${approver.name})` : ''),
      {
        actor: user.name,
        meta: { orderId, method: payment.method, paise: payment.paise, reason },
      });
  }).order;
}

export function settleOrder(orderId, user) {
  return tx(() => {
    const order = getOrder(orderId);
    if (!order) throw notFound('That table is no longer open');
    if (order.status !== 'OPEN') throw conflict('That bill has already been settled');

    const totals = costOrder(order);
    if (totals.balance > 0) {
      throw conflict(`There is still ${(totals.balance / 100).toFixed(2)} to pay`);
    }
    if (!order.invoice) {
      const number = nextCounter('invoice', 1);
      order.invoice = {
        number,
        code: serial(NUMBERING.invoicePrefix, number, NUMBERING.padding),
        at: Date.now(),
        by: user.name,
      };
    }
    order.status = 'SETTLED';
    order.closedAt = Date.now();
    order.settledBy = user.name;
    persist(order);

    audit('SETTLE',
      `Table ${order.tableLabel} settled · ${order.invoice.code}`
      + ` · ${(totals.total / 100).toFixed(2)}`,
      { actor: user.name, meta: { orderId, total: totals.total } });
    bumpRevision();
    return order;
  });
}

/**
 * Cancel a whole table. See CANCEL_POLICY in shared/config.js for the rule.
 *
 * The order is kept, marked VOID, with the reason and who approved it. It is
 * not deleted: a table that was open for forty minutes and then cancelled is
 * something a manager may be asked about, and a row that vanished answers
 * nothing. It leaves the floor, and the table goes back to vacant.
 */
export function cancelOrder(orderId, { reason, user, approver }) {
  return tx(() => {
    const order = getOrder(orderId);
    if (!order) throw notFound('That table is no longer open');
    if (order.status === 'SETTLED') {
      throw conflict('That bill has been settled — reopen it instead');
    }
    if (order.status !== 'OPEN') throw conflict('That table is already closed');

    order.status = 'VOID';
    order.closedAt = Date.now();
    order.cancelled = {
      reason,
      by: (approver || user).name,
      at: Date.now(),
      invoice: order.invoice?.code || null,
    };
    persist(order);

    audit('CANCEL',
      `Table ${order.tableLabel} cancelled — ${reason}`
      + (order.invoice ? ` (voids bill ${order.invoice.code})` : ''),
      { actor: (approver || user).name, meta: { orderId, covers: order.covers } });
    bumpRevision();
    return order;
  });
}

/** Has the kitchen started on any of it? That is what decides who may cancel. */
export const needsApprovalToCancel = (order) =>
  Boolean(order.invoice) || order.lines.some((l) => l.status !== 'HELD' && l.status !== 'VOID');

export function reopenOrder(orderId, approver) {
  return tx(() => {
    const order = getOrder(orderId);
    if (!order) throw notFound('No such bill');
    if (order.status !== 'SETTLED') throw conflict('That bill is not settled');
    if (orderForTable(order.tableId)) {
      throw conflict(`Table ${order.tableLabel} has already been seated again`);
    }
    order.status = 'OPEN';
    order.closedAt = null;
    persist(order);
    audit('REOPEN', `Bill ${order.invoice?.code} reopened on Table ${order.tableLabel}`,
      { actor: approver.name, meta: { orderId } });
    bumpRevision();
    return order;
  });
}

/* -------------------------------------------------------- reservations --- */

export const listReservations = (day = today()) =>
  all('SELECT doc FROM reservations WHERE day = ? AND deleted_at IS NULL ORDER BY at', day)
    .map((r) => JSON.parse(r.doc));

export function saveReservation(input, user) {
  const id = input.id || `res_${randomUUID().slice(0, 12)}`;
  const at = Number(input.at) || Date.now();
  const doc = {
    id,
    name: String(input.name || '').trim().slice(0, 80),
    covers: Math.max(1, Math.min(60, Number(input.covers) || 2)),
    at,
    tableId: input.tableId || null,
    phone: String(input.phone || '').slice(0, 40),
    note: String(input.note || '').slice(0, 240),
    status: input.status || 'CONFIRMED',
  };
  if (!doc.name) throw new HttpError(400, 'A booking needs a name');

  const existed = !!one('SELECT id FROM reservations WHERE id = ?', id);
  run(
    'INSERT INTO reservations (id, at, day, status, doc, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    + ' ON CONFLICT (id) DO UPDATE SET at = excluded.at, day = excluded.day,'
    + ' status = excluded.status, doc = excluded.doc, updated_at = excluded.updated_at',
    id, at, businessDay(at, DAY_ROLLOVER_HOUR), doc.status, JSON.stringify(doc), Date.now()
  );
  audit('BOOKING', `${existed ? 'Updated' : 'Added'} booking for ${doc.name} · ${doc.covers} covers`,
    { actor: user.name, meta: { id } });
  bumpRevision();
  return doc;
}

export function dropReservation(id, user) {
  const row = one('SELECT doc FROM reservations WHERE id = ?', id);
  if (!row) throw notFound('No such booking');
  // Marked gone rather than erased, so the cloud copy learns about it too.
  // A row that simply vanishes can never be synced.
  run('UPDATE reservations SET deleted_at = ?, updated_at = ? WHERE id = ?',
    Date.now(), Date.now(), id);
  audit('BOOKING', `Removed booking for ${JSON.parse(row.doc).name}`, { actor: user.name });
  bumpRevision();
}

/* --------------------------------------------------------- working set --- */

/**
 * Everything a terminal needs to paint every screen, in one reply.
 *
 * It is deliberately one round trip. A floor plan that needs four requests to
 * draw is a floor plan that flickers, and a captain holding a tablet in a
 * dark room notices.
 */
export function workingSet() {
  const day = today();
  const settled = settledOn(day);
  return {
    revision: currentRevision(),
    businessDay: day,
    serverTime: Date.now(),
    tables: floorPlan().tables,
    sections: floorPlan().sections,
    orders: openOrders(),
    settled,
    reservations: listReservations(day),
    menu: listMenu(),
    modifierGroups: getModifierGroups(),
    settings: allSettings(),
    activity: auditLog({ day, limit: 120 }),
    shift: currentShift(),
    counters: {
      order: one("SELECT value FROM counters WHERE name = 'order'")?.value ?? 0,
      invoice: one("SELECT value FROM counters WHERE name = 'invoice'")?.value ?? 0,
    },
  };
}

/* ---------------------------------------------------------- attendance --- */

/**
 * Who is on the premises right now, per person.
 *
 * A spell that has no clock_out is still running. There can only be one of
 * those at a time for anybody, which is what stops a second tap of Clock in
 * opening a second spell and billing the restaurant for two of them.
 */
export const openSpell = (userId) =>
  one('SELECT * FROM attendance WHERE user_id = ? AND clock_out IS NULL'
    + ' ORDER BY clock_in DESC LIMIT 1', userId) || null;

export const attendanceOn = (day = today(), userId = null) =>
  (userId
    ? all('SELECT * FROM attendance WHERE day = ? AND user_id = ? ORDER BY clock_in', day, userId)
    : all('SELECT * FROM attendance WHERE day = ? ORDER BY clock_in', day))
    .map(withMinutes);

/** Minutes are derived, never stored: see the note on the table. */
const withMinutes = (row) => ({
  ...row,
  open: row.clock_out === null,
  minutes: Math.max(0, Math.round(((row.clock_out ?? Date.now()) - row.clock_in) / 60000)),
});

export function clockIn(user) {
  return tx(() => {
    if (openSpell(user.id)) throw conflict(`${user.name} is already clocked in`);
    const id = `at_${randomUUID().slice(0, 12)}`;
    const now = Date.now();
    run(
      'INSERT INTO attendance (id, user_id, user_name, role, day, clock_in, updated_at)'
      + ' VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, user.id, user.name, user.role, today(), now, now
    );
    audit('ATTENDANCE', `${user.name} clocked in`, { actor: user.name });
    bumpRevision();
    return withMinutes(one('SELECT * FROM attendance WHERE id = ?', id));
  });
}

export function clockOut(user, { note = '' } = {}) {
  return tx(() => {
    const spell = openSpell(user.id);
    if (!spell) throw conflict(`${user.name} is not clocked in`);
    const now = Date.now();
    run('UPDATE attendance SET clock_out = ?, note = ?, updated_at = ? WHERE id = ?',
      now, String(note).slice(0, 120), now, spell.id);

    const minutes = Math.round((now - spell.clock_in) / 60000);
    audit('ATTENDANCE',
      `${user.name} clocked out — ${Math.floor(minutes / 60)}h ${minutes % 60}m`,
      { actor: user.name });
    bumpRevision();
    return withMinutes(one('SELECT * FROM attendance WHERE id = ?', spell.id));
  });
}

/* -------------------------------------------------------------- shifts --- */

export const currentShift = () =>
  one('SELECT * FROM shifts WHERE closed_at IS NULL ORDER BY opened_at DESC LIMIT 1') || null;

export function openShift({ floatPaise, user }) {
  return tx(() => {
    if (currentShift()) throw conflict('A shift is already open');
    const id = `sh_${randomUUID().slice(0, 12)}`;
    const now = Date.now();
    run(
      'INSERT INTO shifts (id, day, opened_at, opened_by, float_paise, doc, updated_at)'
      + ' VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, today(), now, user.name, Math.max(0, Math.round(floatPaise || 0)), '{}', now
    );
    audit('SHIFT', `Till opened with a float of ${((floatPaise || 0) / 100).toFixed(2)}`,
      { actor: user.name });
    bumpRevision();
    return currentShift();
  });
}

export function closeShift({ countedPaise, note, user }) {
  return tx(() => {
    const shift = currentShift();
    if (!shift) throw conflict('No shift is open');
    const now = Date.now();
    run(
      'UPDATE shifts SET closed_at = ?, closed_by = ?, counted_paise = ?, doc = ?, updated_at = ?'
      + ' WHERE id = ?',
      now, user.name, Math.max(0, Math.round(countedPaise || 0)),
      JSON.stringify({ note: String(note || '').slice(0, 240) }), now, shift.id
    );
    audit('SHIFT', `Till closed and counted at ${((countedPaise || 0) / 100).toFixed(2)}`,
      { actor: user.name, meta: { shiftId: shift.id } });
    bumpRevision();
    return one('SELECT * FROM shifts WHERE id = ?', shift.id);
  });
}

export { costOrder, charges, orderStage, orderValue, currentRevision, COURSES };
