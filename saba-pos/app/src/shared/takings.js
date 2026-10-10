/**
 * The takings.
 *
 * Shared, because a figure a manager reads on the screen, a figure in the
 * exported CSV and a figure on the published demonstration must be the same
 * figure. The aggregation underneath is `shared/reports.js`; what this module
 * adds is the assembly — reaching back through months of settled bills, and
 * the day-end close that reconciles the cash drawer against them.
 *
 * It reaches its data through a `source` rather than a database, so the one
 * implementation serves the server over SQLite and the browser over an
 * object, and so a report can be tested without either:
 *
 *   source.settledOn(day)        settled orders on a business day
 *   source.ordersBetween(a, b)   settled orders across a window
 *   source.openOrders()          what is still on the floor
 *   source.shiftFor(day)         that day's till shift, or null
 */

import { costOrder, charges } from './pricing.js';
import { stationPerformance, exceptions } from './reports.js';
import { PAYMENT_METHODS } from './config.js';
import { itemById } from './catalogue.js';
import { dayRange } from './format.js';

const sum = (list, fn) => list.reduce((n, x) => n + (fn ? fn(x) : x), 0);
const safeDiv = (a, b) => (b ? a / b : 0);

/**
 * Turn stored orders into the flat "check" shape every chart reads.
 *
 * It is the same shape the browser builds for today's live trading, which is
 * why one set of chart functions can draw both.
 */
function toChecks(orders) {
  return orders.map((order) => {
    const t = costOrder(order);
    return {
      at: order.closedAt || order.openedAt,
      covers: order.covers,
      lines: order.lines
        .filter((l) => l.status !== 'VOID')
        .map((l) => ({
          itemId: l.itemId,
          name: l.name,
          category: itemById(l.itemId)?.category || 'mains',
          qty: l.qty,
          unitPaise: l.unitPaise,
        })),
      gross: t.gross,
      discount: t.discount,
      serviceCharge: t.serviceCharge,
      taxTotal: t.taxTotal,
      taxes: t.taxes,
      tip: t.tip,
      total: t.total,
      net: t.discounted,
      method: order.payments[0]?.method || 'CASH',
      payments: order.payments,
      durationMin: Math.round(((order.closedAt || Date.now()) - order.openedAt) / 60000),
      voided: false,
      order,
    };
  });
}

/** One business day, in the shape the chart functions expect. */
export function dayRecord(day, source) {
  const orders = source.settledOn(day);
  const checks = toChecks(orders);
  return {
    day,
    at: new Date(`${day}T12:00:00`).getTime(),
    weekday: new Date(`${day}T12:00:00`).getDay(),
    checks,
    covers: sum(checks, (c) => c.covers),
    net: sum(checks, (c) => c.net),
    total: sum(checks, (c) => c.total),
  };
}

/* --------------------------------------------------------------- range --- */

export function buildRangeReport(from, to, source) {
  // Pull the whole window in one query rather than a query per day: a
  // thirty-day report would otherwise be thirty round trips to SQLite.
  const orders = source.ordersBetween(from, to);
  const byDay = new Map(dayRange(from, to).map((day) => [day, []]));
  for (const order of orders) {
    if (!byDay.has(order.businessDay)) byDay.set(order.businessDay, []);
    byDay.get(order.businessDay).push(order);
  }

  const days = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, list]) => {
      const checks = toChecks(list);
      return {
        day,
        at: new Date(`${day}T12:00:00`).getTime(),
        weekday: new Date(`${day}T12:00:00`).getDay(),
        checks,
        covers: sum(checks, (c) => c.covers),
        net: sum(checks, (c) => c.net),
        total: sum(checks, (c) => c.total),
      };
    });

  return { from, to, days, generatedAt: Date.now() };
}

/* ----------------------------------------------------------- day close --- */

/**
 * The Z report: what the till says happened, and what is actually in it.
 *
 * This is the number a restaurant closes on. It separates takings by tender,
 * because only cash should be in the drawer — everything else settled to a
 * bank — and then states the variance plainly rather than burying it.
 */
export function buildDayReport(day, source) {
  const orders = source.settledOn(day);
  const checks = toChecks(orders);
  const openNow = source.openOrders().filter((o) => o.businessDay === day);

  const byMethod = new Map(PAYMENT_METHODS.map((m) => [m.id, {
    method: m.id, label: m.label, countsToDrawer: m.countsToDrawer, paise: 0, count: 0,
  }]));
  for (const order of orders) {
    for (const payment of order.payments) {
      const row = byMethod.get(payment.method)
        || { method: payment.method, label: payment.method, countsToDrawer: false, paise: 0, count: 0 };
      row.paise += payment.paise;
      row.count += 1;
      byMethod.set(payment.method, row);
    }
  }
  const tenders = [...byMethod.values()].filter((t) => t.count > 0);

  const taxTotals = charges().taxComponents.map((component) => ({
    id: component.id,
    label: component.label,
    bps: component.bps,
    paise: sum(checks, (c) => c.taxes.find((t) => t.id === component.id)?.paise || 0),
  }));

  const shift = source.shiftFor(day);

  const cashTaken = sum(tenders.filter((t) => t.countsToDrawer), (t) => t.paise);
  const expectedDrawer = (shift?.float_paise || 0) + cashTaken;
  const counted = shift?.counted_paise ?? null;

  const totals = {
    bills: checks.length,
    covers: sum(checks, (c) => c.covers),
    gross: sum(checks, (c) => c.gross),
    comps: sum(checks, (c) => c.order && costOrder(c.order).comps),
    discount: sum(checks, (c) => c.discount),
    net: sum(checks, (c) => c.net),
    serviceCharge: sum(checks, (c) => c.serviceCharge),
    taxTotal: sum(checks, (c) => c.taxTotal),
    tips: sum(checks, (c) => c.tip),
    roundOff: sum(checks, (c) => costOrder(c.order).roundOff),
    total: sum(checks, (c) => c.total),
  };
  totals.avgCheck = Math.round(safeDiv(totals.total, totals.bills));
  totals.perCover = Math.round(safeDiv(totals.total, totals.covers));
  totals.avgTurnMin = Math.round(safeDiv(sum(checks, (c) => c.durationMin), checks.length));

  return {
    day,
    generatedAt: Date.now(),
    totals,
    taxes: taxTotals,
    tenders,
    cash: {
      floatPaise: shift?.float_paise ?? 0,
      takenPaise: cashTaken,
      expectedPaise: expectedDrawer,
      countedPaise: counted,
      variancePaise: counted === null ? null : counted - expectedDrawer,
    },
    shift: shift && {
      id: shift.id,
      openedAt: shift.opened_at,
      openedBy: shift.opened_by,
      closedAt: shift.closed_at,
      closedBy: shift.closed_by,
      note: safeParse(shift.doc)?.note || '',
    },
    stations: stationPerformance([...orders, ...openNow]),
    exceptions: exceptions([...orders, ...openNow]),
    /** Tables still open when the report was run — a day cannot close on these. */
    stillOpen: openNow.map((o) => ({
      id: o.id,
      table: o.tableLabel,
      covers: o.covers,
      openedAt: o.openedAt,
      total: costOrder(o).total,
    })),
    staff: staffFor(orders),
  };
}

function staffFor(orders) {
  const rows = new Map();
  for (const order of orders) {
    const row = rows.get(order.captainId)
      || { id: order.captainId, name: order.captainName, bills: 0, covers: 0, total: 0 };
    row.bills += 1;
    row.covers += order.covers;
    row.total += costOrder(order).total;
    rows.set(order.captainId, row);
  }
  return [...rows.values()]
    .map((r) => ({ ...r, avgCheck: Math.round(safeDiv(r.total, r.bills)) }))
    .sort((a, b) => b.total - a.total);
}

function safeParse(json) {
  try { return JSON.parse(json); } catch { return null; }
}
