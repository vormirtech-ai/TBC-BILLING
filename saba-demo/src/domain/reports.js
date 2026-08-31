/**
 * Everything the reports screen shows, derived on demand from orders and the
 * trading history. Nothing here is stored — a report that can drift out of step
 * with the bills it summarises is worse than no report.
 */

import { STATIONS, stationById, KOT_STATUS } from '../config.js';
import { costOrder, lineGross } from './pricing.js';
import { itemById, CATEGORIES } from '../data/menu.seed.js';
import { dayKey } from '../core/format.js';

const sum = (list, fn) => list.reduce((n, x) => n + (fn ? fn(x) : x), 0);
const safeDiv = (a, b) => (b ? a / b : 0);

/* ------------------------------------------------------------ today --- */

/**
 * Turn today's settled bills into the same shape a history day uses, so every
 * chart below works on one record type whether the day is finished or not.
 */
export function todayAsDay(state) {
  const checks = state.settled.map((order) => {
    const totals = costOrder(order);
    return {
      at: order.closedAt || order.openedAt,
      covers: order.covers,
      lines: order.lines
        .filter((l) => l.status !== KOT_STATUS.VOID)
        .map((l) => ({
          itemId: l.itemId,
          name: l.name,
          category: itemById(l.itemId)?.category || 'mains',
          qty: l.qty,
          unitPaise: l.unitPaise,
        })),
      gross: totals.gross,
      discount: totals.discount,
      serviceCharge: totals.serviceCharge,
      taxTotal: totals.taxTotal,
      tip: totals.tip,
      total: totals.total,
      net: totals.discounted,
      method: order.payments[0]?.method || 'CASH',
      durationMin: Math.round(((order.closedAt || Date.now()) - order.openedAt) / 60000),
      voided: false,
      order,
    };
  });
  return {
    day: state.businessDay,
    at: Date.now(),
    weekday: new Date().getDay(),
    checks,
    covers: sum(checks, (c) => c.covers),
    net: sum(checks, (c) => c.net),
    total: sum(checks, (c) => c.total),
  };
}

/**
 * Days for a window ending today, oldest first. Today's live figures are always
 * the last entry.
 *
 * The zero case has to be spelled out: `slice(-0)` is `slice(0)`, which returns
 * the whole array rather than none of it, so a one-day window would silently
 * report the entire month.
 */
export function daysInRange(state, days) {
  const back = Math.max(0, days - 1);
  const past = back ? state.history.slice(-back) : [];
  return [...past, todayAsDay(state)];
}

/* --------------------------------------------------------- headline --- */

export function headline(days) {
  const checks = days.flatMap((d) => d.checks).filter((c) => !c.voided);
  const covers = sum(checks, (c) => c.covers);
  const net = sum(checks, (c) => c.net);
  const total = sum(checks, (c) => c.total);
  return {
    checks: checks.length,
    covers,
    net,
    total,
    tax: sum(checks, (c) => c.taxTotal),
    serviceCharge: sum(checks, (c) => c.serviceCharge),
    discount: sum(checks, (c) => c.discount),
    tips: sum(checks, (c) => c.tip),
    avgCheck: Math.round(safeDiv(total, checks.length)),
    perCover: Math.round(safeDiv(total, covers)),
    avgTurnMin: Math.round(safeDiv(sum(checks, (c) => c.durationMin), checks.length)),
    voids: days.flatMap((d) => d.checks).filter((c) => c.voided).length,
  };
}

/** Same window, immediately before this one — for the "vs last period" chips. */
export function previousWindow(state, days) {
  const end = Math.max(0, state.history.length - (days - 1));
  const start = Math.max(0, end - days);
  return state.history.slice(start, end);
}

export function delta(current, previous) {
  if (!previous) return null;
  return safeDiv(current - previous, previous) * 100;
}

/* ----------------------------------------------------------- series --- */

/** Sales by hour of service, for the trading-pattern bars. */
export function byHour(days) {
  const buckets = new Map();
  for (const check of days.flatMap((d) => d.checks)) {
    if (check.voided) continue;
    const hour = new Date(check.at).getHours();
    const row = buckets.get(hour) || { hour, total: 0, covers: 0, checks: 0 };
    row.total += check.total;
    row.covers += check.covers;
    row.checks += 1;
    buckets.set(hour, row);
  }
  return [...buckets.values()].sort((a, b) => a.hour - b.hour);
}

/** One point per day, for the trend line. */
export function byDay(days) {
  return days.map((d) => ({
    day: d.day,
    at: d.at,
    total: sum(d.checks.filter((c) => !c.voided), (c) => c.total),
    covers: d.covers,
  }));
}

export function byCategory(days) {
  const buckets = new Map();
  for (const check of days.flatMap((d) => d.checks)) {
    if (check.voided) continue;
    for (const line of check.lines) {
      const row = buckets.get(line.category) || { id: line.category, qty: 0, value: 0 };
      row.qty += line.qty;
      row.value += line.unitPaise * line.qty;
      buckets.set(line.category, row);
    }
  }
  return [...buckets.values()]
    .map((row) => ({ ...row, label: CATEGORIES.find((c) => c.id === row.id)?.label || row.id }))
    .sort((a, b) => b.value - a.value);
}

export function byPayment(days) {
  const buckets = new Map();
  for (const check of days.flatMap((d) => d.checks)) {
    if (check.voided) continue;
    const row = buckets.get(check.method) || { method: check.method, total: 0, count: 0 };
    row.total += check.total;
    row.count += 1;
    buckets.set(check.method, row);
  }
  return [...buckets.values()].sort((a, b) => b.total - a.total);
}

export function topItems(days, limit = 10) {
  const buckets = new Map();
  for (const check of days.flatMap((d) => d.checks)) {
    if (check.voided) continue;
    for (const line of check.lines) {
      const row = buckets.get(line.itemId)
        || { itemId: line.itemId, name: line.name, qty: 0, value: 0 };
      row.qty += line.qty;
      row.value += line.unitPaise * line.qty;
      buckets.set(line.itemId, row);
    }
  }
  return [...buckets.values()]
    .map((row) => {
      const item = itemById(row.itemId);
      const cost = (item?.costPaise || 0) * row.qty;
      return { ...row, cost, margin: row.value - cost, marginPct: safeDiv(row.value - cost, row.value) * 100 };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

/* ---------------------------------------------------------- kitchen --- */

/**
 * How long each station is taking against its own service target. This is the
 * number a head chef actually asks for, and it only exists because every docket
 * is timestamped when it is fired and again when it is bumped.
 */
export function stationPerformance(orders) {
  const rows = STATIONS.map((station) => ({
    station: station.id,
    label: station.label,
    sla: station.slaMinutes,
    tickets: 0,
    open: 0,
    totalMinutes: 0,
    breaches: 0,
    late: 0,
  }));
  const index = new Map(rows.map((r) => [r.station, r]));

  for (const order of orders) {
    for (const kot of order.kots) {
      const row = index.get(kot.station);
      if (!row || kot.status === KOT_STATUS.VOID) continue;
      if (kot.readyAt) {
        const minutes = Math.max(0, Math.round((kot.readyAt - kot.firedAt) / 60000));
        row.tickets += 1;
        row.totalMinutes += minutes;
        if (minutes > row.sla) row.breaches += 1;
      } else {
        // Still cooking. It counts against the "running late" figure the pass
        // watches, but not against on-time %, which can only be judged on
        // dockets that have actually finished.
        row.open += 1;
        if (Math.round((Date.now() - kot.firedAt) / 60000) > row.sla) row.late += 1;
      }
    }
  }

  return rows.map((row) => ({
    ...row,
    avgMinutes: row.tickets ? Math.round(row.totalMinutes / row.tickets) : 0,
    onTimePct: row.tickets ? Math.round(((row.tickets - row.breaches) / row.tickets) * 100) : 100,
  }));
}

/** Every docket still live in a kitchen, oldest first — the pass at a glance. */
export function openTickets(orders, stationId = null) {
  const tickets = [];
  for (const order of orders) {
    for (const kot of order.kots) {
      if (kot.status !== KOT_STATUS.FIRED && kot.status !== KOT_STATUS.READY) continue;
      if (stationId && kot.station !== stationId) continue;
      tickets.push({ order, kot, ageMs: Date.now() - kot.firedAt, sla: stationById(kot.station).slaMinutes });
    }
  }
  return tickets.sort((a, b) => b.ageMs - a.ageMs);
}

/** All-day counts: how many of each dish the kitchen still owes the room. */
export function allDay(orders, stationId = null) {
  const buckets = new Map();
  for (const order of orders) {
    for (const line of order.lines) {
      if (line.status !== KOT_STATUS.FIRED) continue;
      if (stationId && line.station !== stationId) continue;
      const row = buckets.get(line.itemId) || { name: line.name, qty: 0, station: line.station };
      row.qty += line.qty;
      buckets.set(line.itemId, row);
    }
  }
  return [...buckets.values()].sort((a, b) => b.qty - a.qty);
}

/* ------------------------------------------------------- exceptions --- */

/** Voids, comps and discounts on today's orders — the manager's audit page. */
export function exceptions(orders) {
  const rows = [];
  for (const order of orders) {
    for (const line of order.lines) {
      if (line.status === KOT_STATUS.VOID) {
        rows.push({
          kind: 'Void', at: line.voidedAt || order.openedAt, table: order.tableLabel,
          detail: `${line.qty} × ${line.name}`, reason: line.voidReason,
          by: line.voidBy, value: lineGross(line),
        });
      } else if (line.comp) {
        rows.push({
          kind: 'Comp', at: order.openedAt, table: order.tableLabel,
          detail: `${line.qty} × ${line.name}`, reason: line.compReason,
          by: line.compBy, value: lineGross(line),
        });
      }
    }
    const discount = order.charges?.discount;
    if (discount && discount.mode !== 'NONE' && discount.value) {
      rows.push({
        kind: 'Discount', at: order.closedAt || order.openedAt, table: order.tableLabel,
        detail: discount.mode === 'PCT' ? `${discount.value}% off bill` : `Flat off bill`,
        reason: discount.reason, by: discount.approvedBy,
        value: costOrder(order).discount,
      });
    }
  }
  return rows.sort((a, b) => b.at - a.at);
}

/** Sales credited to the captain who opened the table. */
export function byStaff(state) {
  const buckets = new Map();
  for (const order of [...state.settled, ...state.orders]) {
    const row = buckets.get(order.captainId)
      || { id: order.captainId, name: order.captainName, checks: 0, covers: 0, total: 0 };
    row.checks += 1;
    row.covers += order.covers;
    row.total += costOrder(order).total;
    buckets.set(order.captainId, row);
  }
  return [...buckets.values()]
    .map((r) => ({ ...r, avgCheck: Math.round(safeDiv(r.total, r.checks)) }))
    .sort((a, b) => b.total - a.total);
}

export { dayKey };
