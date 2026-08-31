/**
 * Orders, courses and kitchen dockets.
 *
 * The model that makes fine dining different from a counter till:
 *
 *   • A line is written against a COURSE and a SEAT, not just a table. The
 *     kitchen needs the course to pace the meal; the till needs the seat to
 *     split the bill later without the captain re-typing anything.
 *
 *   • A line sits HELD until its course is FIRED. Firing a course is the moment
 *     the kitchen is told to cook, and it is deliberately a separate action
 *     from taking the order — otherwise the mains are plated while the guests
 *     are still on the starters.
 *
 *   • Firing produces one KOT PER STATION. The tandoor's docket must not carry
 *     the dessert line. This is the single most common thing cheap systems get
 *     wrong, and it is why food arrives cold.
 *
 * Every function here is pure: it takes an order and returns a new one, so the
 * store can apply it and the tests can assert on it without a browser.
 */

import { KOT_STATUS, NUMBERING, stationById, courseById, COURSES } from '../config.js';
import { uid, serial } from '../core/format.js';
import { lineGross } from './pricing.js';

/* --------------------------------------------------------------- create --- */

export function createOrder({ number, table, covers, guestName, user, reservationId = null }) {
  return {
    id: uid('ord'),
    number,
    code: serial(NUMBERING.orderPrefix, number, NUMBERING.padding),
    tableId: table.id,
    tableLabel: table.label,
    sectionId: table.sectionId,
    covers: Math.max(1, Number(covers) || 2),
    guestName: guestName || '',
    reservationId,
    captainId: user.id,
    captainName: user.name,
    openedAt: Date.now(),
    closedAt: null,
    status: 'OPEN',
    lines: [],
    kots: [],
    kotSeq: 0,
    charges: {
      serviceCharge: true,
      discount: { mode: 'NONE', value: 0, reason: '', approvedBy: '' },
      tipPaise: 0,
    },
    payments: [],
    split: null,
    invoice: null,
    notes: '',
  };
}

export function createLine(item, { qty = 1, course, seat = null, modifiers = [], notes = '' } = {}) {
  return {
    id: uid('ln'),
    itemId: item.id,
    name: item.name,
    station: item.station,
    course: course || item.course,
    seat,
    qty: Math.max(1, Number(qty) || 1),
    unitPaise: item.pricePaise,
    modifiers: modifiers.map((m) => ({ id: m.id, label: m.label, deltaPaise: m.deltaPaise || 0 })),
    notes,
    status: KOT_STATUS.HELD,
    kotId: null,
    comp: false,
    compReason: '',
    voidReason: '',
    voidBy: '',
    addedAt: Date.now(),
    firedAt: null,
    readyAt: null,
    servedAt: null,
  };
}

/* ---------------------------------------------------------------- lines --- */

/**
 * Adding the same item, same course, same seat and same modifiers should bump
 * the quantity instead of stacking identical rows — but only while it is still
 * HELD. Once a line is in the kitchen it is a historical fact and the new one
 * is a genuinely separate order.
 */
export function addLine(order, item, options = {}) {
  const candidate = createLine(item, options);
  const twin = order.lines.find(
    (l) => l.status === KOT_STATUS.HELD
      && l.itemId === candidate.itemId
      && l.course === candidate.course
      && l.seat === candidate.seat
      && l.notes === candidate.notes
      && sameModifiers(l.modifiers, candidate.modifiers)
  );
  if (twin) {
    twin.qty += candidate.qty;
    return order;
  }
  order.lines.push(candidate);
  return order;
}

const sameModifiers = (a, b) =>
  a.length === b.length
  && a.map((m) => m.id).sort().join('|') === b.map((m) => m.id).sort().join('|');

export function setLineQty(order, lineId, qty) {
  const line = order.lines.find((l) => l.id === lineId);
  if (!line) return order;
  if (line.status !== KOT_STATUS.HELD) return order; // fired food must be voided, not edited
  if (qty <= 0) order.lines = order.lines.filter((l) => l.id !== lineId);
  else line.qty = qty;
  return order;
}

/** Remove a held line outright; nothing was cooked so nothing needs auditing. */
export function removeHeldLine(order, lineId) {
  order.lines = order.lines.filter((l) => !(l.id === lineId && l.status === KOT_STATUS.HELD));
  return order;
}

/**
 * Kill a line that has already reached the kitchen. It stays on the order with
 * a reason and an approver so the void shows up in the day's report — deleting
 * it would hide food that was genuinely cooked and thrown away.
 */
export function voidLine(order, lineId, reason, approvedBy) {
  const line = order.lines.find((l) => l.id === lineId);
  if (!line || line.status === KOT_STATUS.VOID) return order;
  line.status = KOT_STATUS.VOID;
  line.voidReason = reason;
  line.voidBy = approvedBy;
  line.voidedAt = Date.now();
  syncKotStatus(order, line.kotId);
  return order;
}

export function compLine(order, lineId, reason, approvedBy) {
  const line = order.lines.find((l) => l.id === lineId);
  if (!line) return order;
  line.comp = !line.comp;
  line.compReason = line.comp ? reason : '';
  line.compBy = line.comp ? approvedBy : '';
  return order;
}

export function moveLineToSeat(order, lineId, seat) {
  const line = order.lines.find((l) => l.id === lineId);
  if (line) line.seat = seat;
  return order;
}

/* ----------------------------------------------------------------- KOTs --- */

export const heldLines = (order, courseId = null) =>
  order.lines.filter(
    (l) => l.status === KOT_STATUS.HELD && (!courseId || l.course === courseId)
  );

/** Courses that currently have something waiting to be sent. */
export function heldCourses(order) {
  const ids = new Set(heldLines(order).map((l) => l.course));
  return COURSES.filter((c) => ids.has(c.id));
}

/**
 * Send held lines to the kitchen.
 *
 * @param {string|null} courseId  fire one course, or null for everything held
 * @returns {{ order: object, kots: object[] }} the dockets that were created,
 *          so the caller can print them
 */
export function fireCourse(order, courseId, user) {
  const lines = heldLines(order, courseId);
  if (!lines.length) return { order, kots: [] };

  const byStation = new Map();
  for (const line of lines) {
    if (!byStation.has(line.station)) byStation.set(line.station, []);
    byStation.get(line.station).push(line);
  }

  const now = Date.now();
  const created = [];
  for (const [station, stationLines] of byStation) {
    order.kotSeq += 1;
    const kot = {
      id: uid('kot'),
      code: `${NUMBERING.kotPrefix}${order.code.split('-')[1]}-${order.kotSeq}`,
      orderId: order.id,
      orderCode: order.code,
      tableLabel: order.tableLabel,
      covers: order.covers,
      station,
      // A docket can hold more than one course only when a captain fires
      // everything at once; the ticket then prints a course heading per group.
      courses: [...new Set(stationLines.map((l) => l.course))],
      lineIds: stationLines.map((l) => l.id),
      status: KOT_STATUS.FIRED,
      firedAt: now,
      firedBy: user?.name || '',
      readyAt: null,
      servedAt: null,
      printCount: 1,
      voidReason: '',
    };
    for (const line of stationLines) {
      line.status = KOT_STATUS.FIRED;
      line.kotId = kot.id;
      line.firedAt = now;
    }
    order.kots.push(kot);
    created.push(kot);
  }

  return { order, kots: created };
}

/** Kitchen bumps a docket: FIRED -> READY -> SERVED. */
export function advanceKot(order, kotId, to) {
  const kot = order.kots.find((k) => k.id === kotId);
  if (!kot || kot.status === KOT_STATUS.VOID) return order;
  const now = Date.now();

  if (to === KOT_STATUS.READY) { kot.status = to; kot.readyAt = now; }
  else if (to === KOT_STATUS.SERVED) {
    kot.status = to;
    kot.readyAt = kot.readyAt || now;
    kot.servedAt = now;
  } else if (to === KOT_STATUS.FIRED) {
    // Recall from the pass — the runner never took it.
    kot.status = to; kot.readyAt = null; kot.servedAt = null;
  }

  for (const line of order.lines) {
    if (line.kotId !== kotId || line.status === KOT_STATUS.VOID) continue;
    line.status = kot.status;
    line.readyAt = kot.readyAt;
    line.servedAt = kot.servedAt;
  }
  return order;
}

export function voidKot(order, kotId, reason, approvedBy) {
  const kot = order.kots.find((k) => k.id === kotId);
  if (!kot) return order;
  kot.status = KOT_STATUS.VOID;
  kot.voidReason = reason;
  kot.voidBy = approvedBy;
  kot.voidedAt = Date.now();
  for (const line of order.lines) {
    if (line.kotId === kotId) {
      line.status = KOT_STATUS.VOID;
      line.voidReason = reason;
      line.voidBy = approvedBy;
      line.voidedAt = Date.now();
    }
  }
  return order;
}

export function reprintKot(order, kotId) {
  const kot = order.kots.find((k) => k.id === kotId);
  if (kot) kot.printCount += 1;
  return order;
}

/** After a line is voided its docket may have nothing live left on it. */
function syncKotStatus(order, kotId) {
  if (!kotId) return;
  const kot = order.kots.find((k) => k.id === kotId);
  if (!kot) return;
  const live = order.lines.filter(
    (l) => l.kotId === kotId && l.status !== KOT_STATUS.VOID
  );
  if (!live.length) kot.status = KOT_STATUS.VOID;
}

export const kotLines = (order, kot) =>
  kot.lineIds.map((id) => order.lines.find((l) => l.id === id)).filter(Boolean);

/* ---------------------------------------------------------- derivations --- */

/**
 * What the floor plan should paint for a table, worked out from the order
 * rather than stored separately — two sources of truth would drift apart the
 * first time a docket was voided.
 */
export function orderStage(order) {
  if (!order) return 'VACANT';
  if (order.status === 'SETTLED') return 'CLEANING';
  if (order.invoice) return 'BILLED';

  const live = order.lines.filter((l) => l.status !== KOT_STATUS.VOID);
  if (!live.length) return 'SEATED';
  // Nothing has reached a kitchen yet: the captain is still writing. The table
  // is seated, not waiting on food, and the floor plan should not imply it is.
  if (live.every((l) => l.status === KOT_STATUS.HELD)) return 'SEATED';
  if (live.some((l) => l.status === KOT_STATUS.HELD || l.status === KOT_STATUS.FIRED)) {
    return 'ORDERED';
  }
  if (live.every((l) => l.status === KOT_STATUS.SERVED)) return 'SERVED';
  return 'ORDERED';
}

/** Course-by-course progress, for the pacing strip on the order screen. */
export function coursePacing(order) {
  return COURSES.map((course) => {
    const lines = order.lines.filter(
      (l) => l.course === course.id && l.status !== KOT_STATUS.VOID
    );
    if (!lines.length) return { course, state: 'EMPTY', count: 0 };
    const state = lines.every((l) => l.status === KOT_STATUS.SERVED) ? 'SERVED'
      : lines.some((l) => l.status === KOT_STATUS.HELD) ? 'HELD'
        : lines.some((l) => l.status === KOT_STATUS.FIRED) ? 'FIRED' : 'READY';
    return { course, state, count: lines.reduce((n, l) => n + l.qty, 0) };
  });
}

/** Distinct seats used on this order, for the seat picker and seat splits. */
export function seatsUsed(order) {
  const seats = new Set(
    order.lines.filter((l) => l.seat).map((l) => l.seat)
  );
  return [...seats].sort((a, b) => a - b);
}

/** How long each station took, feeding the kitchen performance report. */
export function kotDurations(order) {
  return order.kots
    .filter((k) => k.status !== KOT_STATUS.VOID && k.readyAt)
    .map((k) => ({
      station: k.station,
      stationLabel: stationById(k.station).label,
      minutes: Math.max(0, Math.round((k.readyAt - k.firedAt) / 60000)),
      sla: stationById(k.station).slaMinutes,
      firedAt: k.firedAt,
    }));
}

export const orderValue = (order) =>
  order.lines.filter((l) => l.status !== KOT_STATUS.VOID && !l.comp)
    .reduce((total, l) => total + lineGross(l), 0);

export const courseLabel = (id) => courseById(id).label;
