/**
 * Reports and seeded data.
 *
 * The point of these is that a manager's figures never quietly disagree with
 * the bills they came from, and that the opening state of the demo is coherent
 * — a demo whose kitchen report says the tandoor takes seventy minutes is worse
 * than no demo at all.
 */

import { test } from './run.mjs';
import { buildInitialState } from '../src/data/seed.js';
import { buildHistory } from '../src/data/history.js';
import {
  daysInRange, previousWindow, headline, byHour, byCategory, byPayment,
  topItems, stationPerformance, openTickets, allDay, exceptions, byStaff,
  todayAsDay,
} from '../src/domain/reports.js';
import { costOrder } from '../src/domain/pricing.js';
import { orderStage } from '../src/domain/orders.js';
import { STATIONS, KOT_STATUS, COURSES } from '../src/config.js';
import { MENU_ITEMS, itemById } from '../src/data/menu.seed.js';
import { TABLES, tableById } from '../src/data/floor.seed.js';

const state = buildInitialState();
const sum = (list, fn) => list.reduce((n, x) => n + fn(x), 0);

/* ------------------------------------------------------------ ranges --- */

test('a one-day range is one day, not the whole month', (t) => {
  // slice(-0) returns the whole array, which is exactly the trap here.
  t.equal(daysInRange(state, 1).length, 1);
  t.equal(daysInRange(state, 7).length, 7);
  t.equal(daysInRange(state, 30).length, 30);
});

test('the previous window sits immediately behind the current one', (t) => {
  const before = previousWindow(state, 7);
  t.equal(before.length, 7);
  const current = daysInRange(state, 7);
  t.ok(before.at(-1).at < current[0].at, 'and does not overlap it');
});

test('today is always the last day in a range', (t) => {
  const days = daysInRange(state, 30);
  t.equal(days.at(-1).day, state.businessDay);
});

/* -------------------------------------------------------- consistency --- */

test('the headline total equals the sum of the bills behind it', (t) => {
  const days = daysInRange(state, 30);
  const stats = headline(days);
  const fromChecks = sum(
    days.flatMap((d) => d.checks).filter((c) => !c.voided),
    (c) => c.total
  );
  t.equal(stats.total, fromChecks);
});

test("today's report is built from today's settled bills", (t) => {
  const today = todayAsDay(state);
  t.equal(today.checks.length, state.settled.length);
  for (const check of today.checks) {
    t.equal(check.total, costOrder(check.order).total, `bill ${check.order.code}`);
  }
});

test('the payment mix accounts for every settled bill exactly once', (t) => {
  const days = daysInRange(state, 30);
  const stats = headline(days);
  const mix = byPayment(days);
  t.equal(sum(mix, (m) => m.count), stats.checks);
  t.equal(sum(mix, (m) => m.total), stats.total);
});

test('sales by hour account for every bill', (t) => {
  const days = daysInRange(state, 7);
  const stats = headline(days);
  t.equal(sum(byHour(days), (h) => h.checks), stats.checks);
  t.equal(sum(byHour(days), (h) => h.total), stats.total);
});

test('category and item breakdowns agree with each other', (t) => {
  const days = daysInRange(state, 7);
  const byCat = sum(byCategory(days), (c) => c.value);
  const byItem = sum(topItems(days, 999), (i) => i.value);
  t.equal(byCat, byItem);
});

test('every dish sold exists on the carte', (t) => {
  for (const item of topItems(daysInRange(state, 30), 999)) {
    t.ok(itemById(item.itemId), `unknown item ${item.itemId}`);
  }
});

test('captain figures cover every order on the books', (t) => {
  const rows = byStaff(state);
  t.equal(sum(rows, (r) => r.checks), state.orders.length + state.settled.length);
});

/* -------------------------------------------------------- generation --- */

test('the trading history is the same every time it is built', (t) => {
  const a = buildHistory(30, new Date('2026-06-15T12:00:00'));
  const b = buildHistory(30, new Date('2026-06-15T12:00:00'));
  t.equal(JSON.stringify(a), JSON.stringify(b));
});

test('trade is heavier at the weekend than midweek', (t) => {
  const days = buildHistory(60, new Date('2026-06-15T12:00:00'));
  const average = (weekdays) => {
    const rows = days.filter((d) => weekdays.includes(d.weekday));
    return rows.length ? sum(rows, (d) => d.total) / rows.length : 0;
  };
  t.ok(average([5, 6]) > average([1, 2]) * 1.2,
    'Friday and Saturday should clearly outrun Monday and Tuesday');
});

test('average check lands in the range a fine-dining room would expect', (t) => {
  const stats = headline(daysInRange(state, 30));
  const perCoverRupees = stats.perCover / 100;
  t.ok(perCoverRupees > 1500 && perCoverRupees < 6000,
    `₹${perCoverRupees.toFixed(0)} per cover is outside the plausible band`);
});

/* ---------------------------------------------------- opening state --- */

test('every open table sits on a real table in a real section', (t) => {
  for (const order of state.orders) {
    t.ok(tableById(order.tableId), `unknown table ${order.tableId}`);
    t.equal(tableById(order.tableId).label, order.tableLabel);
  }
});

test('no two open orders claim the same table', (t) => {
  const ids = state.orders.map((o) => o.tableId);
  t.equal(new Set(ids).size, ids.length);
});

test('the opening state shows a room in several different states', (t) => {
  const stages = new Set(state.orders.map(orderStage));
  t.ok(stages.size >= 4, `only ${[...stages].join(', ')}`);
  t.ok(stages.has('ORDERED'), 'something should be cooking');
  t.ok(stages.has('BILLED'), 'something should be waiting to pay');
});

test('every fired line belongs to a docket for its own station', (t) => {
  for (const order of [...state.orders, ...state.settled]) {
    for (const line of order.lines) {
      if (line.status === KOT_STATUS.HELD) { t.equal(line.kotId, null); continue; }
      const kot = order.kots.find((k) => k.id === line.kotId);
      t.ok(kot, `line ${line.name} has no docket`);
      t.equal(kot.station, line.station, `${line.name} routed to ${kot.station}`);
    }
  }
});

test('no docket was ready before it was fired', (t) => {
  for (const order of [...state.orders, ...state.settled]) {
    for (const kot of order.kots) {
      if (kot.readyAt) t.ok(kot.readyAt >= kot.firedAt, `${kot.code} ready before fired`);
      if (kot.servedAt) t.ok(kot.servedAt >= kot.readyAt, `${kot.code} served before ready`);
      t.ok(kot.firedAt >= order.openedAt, `${kot.code} fired before the table sat down`);
    }
  }
});

test('seeded prep times are plausible against each station target', (t) => {
  for (const row of stationPerformance([...state.orders, ...state.settled])) {
    if (!row.tickets) continue;
    t.ok(row.avgMinutes > 0, `${row.label} averages zero minutes`);
    t.ok(row.avgMinutes < row.sla * 2,
      `${row.label} averages ${row.avgMinutes} min against a ${row.sla} min target`);
  }
});

test('the pass has work on it, including something already plated', (t) => {
  const tickets = openTickets(state.orders);
  t.ok(tickets.length >= 3, `only ${tickets.length} dockets live`);
  t.ok(tickets.some((x) => x.kot.status === KOT_STATUS.READY),
    'nothing is sitting on the pass, so the demo has no story to tell there');
});

test('all-day counts only include food still cooking', (t) => {
  const rows = allDay(state.orders);
  const cooking = state.orders.flatMap((o) => o.lines)
    .filter((l) => l.status === KOT_STATUS.FIRED);
  t.equal(sum(rows, (r) => r.qty), sum(cooking, (l) => l.qty));
});

test('the opening state has exceptions for the audit tab to show', (t) => {
  const rows = exceptions([...state.orders, ...state.settled]);
  t.ok(rows.length > 0, 'no voids, comps or discounts to demonstrate');
  for (const row of rows) t.ok(row.reason, `${row.kind} on ${row.table} has no reason`);
});

test('every settled bill was paid in full', (t) => {
  for (const order of state.settled) {
    const totals = costOrder(order);
    t.equal(totals.balance, 0, `${order.invoice?.code} left ${totals.balance} outstanding`);
    t.ok(order.invoice, `${order.code} was settled without an invoice number`);
  }
});

test('invoice numbers are unique and the counter is ahead of them', (t) => {
  const codes = [...state.settled, ...state.orders]
    .filter((o) => o.invoice).map((o) => o.invoice.number);
  t.equal(new Set(codes).size, codes.length, 'duplicate invoice number');
  t.ok(state.invoiceSeq >= Math.max(...codes), 'the next invoice would collide');
});

test('order numbers are unique and the counter is ahead of them', (t) => {
  const numbers = [...state.settled, ...state.orders].map((o) => o.number);
  t.equal(new Set(numbers).size, numbers.length);
  t.ok(state.orderSeq >= Math.max(...numbers));
});

/* --------------------------------------------------------- the carte --- */

test('every dish routes to a real station and a real course', (t) => {
  const stations = new Set(STATIONS.map((s) => s.id));
  const courses = new Set(COURSES.map((c) => c.id));
  for (const item of MENU_ITEMS) {
    t.ok(stations.has(item.station), `${item.name} routes to ${item.station}`);
    t.ok(courses.has(item.course), `${item.name} is on course ${item.course}`);
    t.ok(item.pricePaise > 0, `${item.name} has no price`);
    t.ok(item.costPaise < item.pricePaise, `${item.name} sells at a loss`);
  }
});

test('dish ids are unique', (t) => {
  const ids = MENU_ITEMS.map((i) => i.id);
  t.equal(new Set(ids).size, ids.length);
});

test('table ids and labels are unique', (t) => {
  t.equal(new Set(TABLES.map((x) => x.id)).size, TABLES.length);
  t.equal(new Set(TABLES.map((x) => x.label)).size, TABLES.length);
});

test('every table sits inside the plan', (t) => {
  for (const table of TABLES) {
    t.ok(table.x >= 0 && table.x <= 100, `${table.label} is off the plan (x)`);
    t.ok(table.y >= 0 && table.y <= 100, `${table.label} is off the plan (y)`);
    t.ok(table.seats > 0, `${table.label} has no seats`);
  }
});

test('every reservation points at a table that exists', (t) => {
  for (const row of state.reservations) {
    if (!row.tableId) continue;
    t.ok(tableById(row.tableId), `booking for ${row.name} points at ${row.tableId}`);
  }
});
