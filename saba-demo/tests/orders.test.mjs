/**
 * Orders, courses and kitchen dockets.
 *
 * The state machine is what stops a system lying to a kitchen, so it is worth
 * pinning down: what may be edited, what may only be voided, and — the one that
 * matters most — that firing a mixed course never sends the dessert line to the
 * tandoor.
 */

import { test } from './run.mjs';
import {
  createOrder, addLine, setLineQty, removeHeldLine, voidLine, compLine,
  fireCourse, advanceKot, voidKot, reprintKot, kotLines, orderStage,
  coursePacing, seatsUsed, heldLines, heldCourses, orderValue, kotDurations,
} from '../src/domain/orders.js';
import { KOT_STATUS } from '../src/config.js';

const TABLE = { id: 't1', label: '1', sectionId: 'hall' };
const USER = { id: 'u1', name: 'Alina Rahman', role: 'captain' };

const dish = (id, station, course, price = 100000) => ({
  id, name: `Dish ${id}`, station, course, pricePaise: price,
});

const fresh = (covers = 4) => createOrder({
  number: 1, table: TABLE, covers, guestName: 'Test', user: USER,
});

/* ------------------------------------------------------------- lines --- */

test('a new order starts empty and open', (t) => {
  const order = fresh();
  t.equal(order.status, 'OPEN');
  t.equal(order.lines.length, 0);
  t.equal(order.code, 'SAB-0001');
  t.equal(orderStage(order), 'SEATED');
});

test('identical held lines stack instead of repeating', (t) => {
  const order = fresh();
  addLine(order, dish('a', 'HOT', 'MAIN'), { qty: 1, seat: 1 });
  addLine(order, dish('a', 'HOT', 'MAIN'), { qty: 2, seat: 1 });
  t.equal(order.lines.length, 1);
  t.equal(order.lines[0].qty, 3);
});

test('the same dish on a different seat is a different line', (t) => {
  const order = fresh();
  addLine(order, dish('a', 'HOT', 'MAIN'), { seat: 1 });
  addLine(order, dish('a', 'HOT', 'MAIN'), { seat: 2 });
  t.equal(order.lines.length, 2);
});

test('the same dish with different modifiers is a different line', (t) => {
  const order = fresh();
  const rare = [{ id: 'rare', label: 'Rare', deltaPaise: 0 }];
  addLine(order, dish('a', 'TANDOOR', 'MAIN'), { seat: 1, modifiers: rare });
  addLine(order, dish('a', 'TANDOOR', 'MAIN'), { seat: 1, modifiers: [] });
  t.equal(order.lines.length, 2, 'a rare steak is not a medium one');
});

test('a fired line never stacks with a new one', (t) => {
  const order = fresh();
  addLine(order, dish('a', 'HOT', 'MAIN'), { qty: 1 });
  fireCourse(order, 'MAIN', USER);
  addLine(order, dish('a', 'HOT', 'MAIN'), { qty: 1 });
  t.equal(order.lines.length, 2, 'the second is a genuinely separate order');
  t.equal(order.lines[0].status, KOT_STATUS.FIRED);
  t.equal(order.lines[1].status, KOT_STATUS.HELD);
});

test('quantity can be changed while held and not after firing', (t) => {
  const order = fresh();
  addLine(order, dish('a', 'HOT', 'MAIN'), { qty: 2 });
  setLineQty(order, order.lines[0].id, 5);
  t.equal(order.lines[0].qty, 5);

  fireCourse(order, 'MAIN', USER);
  setLineQty(order, order.lines[0].id, 9);
  t.equal(order.lines[0].qty, 5, 'food already cooking cannot be quietly edited');
});

test('setting a held line to zero removes it', (t) => {
  const order = fresh();
  addLine(order, dish('a', 'HOT', 'MAIN'), { qty: 1 });
  setLineQty(order, order.lines[0].id, 0);
  t.equal(order.lines.length, 0);
});

test('removeHeldLine refuses to touch a line in the kitchen', (t) => {
  const order = fresh();
  addLine(order, dish('a', 'HOT', 'MAIN'));
  fireCourse(order, 'MAIN', USER);
  removeHeldLine(order, order.lines[0].id);
  t.equal(order.lines.length, 1, 'it must be voided with a reason instead');
});

/* -------------------------------------------------------------- KOTs --- */

test('firing a course splits one order into one docket per station', (t) => {
  const order = fresh();
  addLine(order, dish('a', 'TANDOOR', 'MAIN'));
  addLine(order, dish('b', 'TANDOOR', 'MAIN'));
  addLine(order, dish('c', 'HOT', 'MAIN'));
  addLine(order, dish('d', 'PASTRY', 'DESSERT'));

  const { kots } = fireCourse(order, 'MAIN', USER);

  t.equal(kots.length, 2, 'tandoor and hot range, not one docket for both');
  const stations = kots.map((k) => k.station).sort();
  t.deepEqual(stations, ['HOT', 'TANDOOR']);
  t.equal(kotLines(order, kots.find((k) => k.station === 'TANDOOR')).length, 2);
  t.equal(kotLines(order, kots.find((k) => k.station === 'HOT')).length, 1);
});

test('firing one course leaves the others held', (t) => {
  const order = fresh();
  addLine(order, dish('a', 'COLD', 'STARTER'));
  addLine(order, dish('b', 'HOT', 'MAIN'));
  addLine(order, dish('c', 'PASTRY', 'DESSERT'));

  fireCourse(order, 'STARTER', USER);

  t.equal(heldLines(order).length, 2);
  t.deepEqual(heldCourses(order).map((c) => c.id), ['MAIN', 'DESSERT']);
  t.equal(order.lines.find((l) => l.itemId === 'c').status, KOT_STATUS.HELD,
    'the dessert is not cooking while they eat the mains');
});

test('the pastry section never receives the tandoor line', (t) => {
  const order = fresh();
  addLine(order, dish('steak', 'TANDOOR', 'MAIN'));
  addLine(order, dish('tart', 'PASTRY', 'MAIN'));

  const { kots } = fireCourse(order, 'MAIN', USER);
  for (const kot of kots) {
    const names = kotLines(order, kot).map((l) => l.itemId);
    if (kot.station === 'PASTRY') t.deepEqual(names, ['tart']);
    if (kot.station === 'TANDOOR') t.deepEqual(names, ['steak']);
  }
});

test('firing with no course sends everything held', (t) => {
  const order = fresh();
  addLine(order, dish('a', 'COLD', 'STARTER'));
  addLine(order, dish('b', 'HOT', 'MAIN'));
  const { kots } = fireCourse(order, null, USER);
  t.equal(kots.length, 2);
  t.equal(heldLines(order).length, 0);
});

test('firing nothing is a no-op, not an empty docket', (t) => {
  const order = fresh();
  const { kots } = fireCourse(order, 'MAIN', USER);
  t.equal(kots.length, 0);
  t.equal(order.kots.length, 0);
});

test('a docket carries its lines through ready and served', (t) => {
  const order = fresh();
  addLine(order, dish('a', 'HOT', 'MAIN'));
  const [kot] = fireCourse(order, 'MAIN', USER).kots;

  advanceKot(order, kot.id, KOT_STATUS.READY);
  t.equal(order.kots[0].status, KOT_STATUS.READY);
  t.equal(order.lines[0].status, KOT_STATUS.READY);
  t.ok(order.kots[0].readyAt, 'the bump is timestamped');

  advanceKot(order, kot.id, KOT_STATUS.SERVED);
  t.equal(order.lines[0].status, KOT_STATUS.SERVED);
  t.ok(order.lines[0].servedAt);
});

test('recalling from the pass clears the ready and served stamps', (t) => {
  const order = fresh();
  addLine(order, dish('a', 'HOT', 'MAIN'));
  const [kot] = fireCourse(order, 'MAIN', USER).kots;
  advanceKot(order, kot.id, KOT_STATUS.READY);
  advanceKot(order, kot.id, KOT_STATUS.FIRED);
  t.equal(order.kots[0].status, KOT_STATUS.FIRED);
  t.equal(order.kots[0].readyAt, null);
});

test('voiding a docket voids every line on it, with the reason', (t) => {
  const order = fresh();
  addLine(order, dish('a', 'HOT', 'MAIN'));
  addLine(order, dish('b', 'HOT', 'MAIN'));
  const [kot] = fireCourse(order, 'MAIN', USER).kots;

  voidKot(order, kot.id, 'Guest changed order', 'Farid Naqvi');

  t.equal(order.kots[0].status, KOT_STATUS.VOID);
  for (const line of order.lines) {
    t.equal(line.status, KOT_STATUS.VOID);
    t.equal(line.voidReason, 'Guest changed order');
    t.equal(line.voidBy, 'Farid Naqvi');
  }
  t.equal(orderValue(order), 0, 'a voided docket is worth nothing');
});

test('voiding the last live line closes its docket too', (t) => {
  const order = fresh();
  addLine(order, dish('a', 'HOT', 'MAIN'));
  fireCourse(order, 'MAIN', USER);
  voidLine(order, order.lines[0].id, 'Ordered in error', 'Farid Naqvi');
  t.equal(order.kots[0].status, KOT_STATUS.VOID, 'no empty docket left cooking');
});

test('a docket with one line voided out of two stays live', (t) => {
  const order = fresh();
  addLine(order, dish('a', 'HOT', 'MAIN'));
  addLine(order, dish('b', 'HOT', 'MAIN'));
  fireCourse(order, 'MAIN', USER);
  voidLine(order, order.lines[0].id, 'Ordered in error', 'Farid Naqvi');
  t.equal(order.kots[0].status, KOT_STATUS.FIRED);
});

test('reprints are counted so a duplicate docket is marked as one', (t) => {
  const order = fresh();
  addLine(order, dish('a', 'HOT', 'MAIN'));
  const [kot] = fireCourse(order, 'MAIN', USER).kots;
  t.equal(kot.printCount, 1);
  reprintKot(order, kot.id);
  t.equal(order.kots[0].printCount, 2);
});

test('docket codes are unique within an order', (t) => {
  const order = fresh();
  addLine(order, dish('a', 'HOT', 'STARTER'));
  addLine(order, dish('b', 'COLD', 'STARTER'));
  fireCourse(order, 'STARTER', USER);
  addLine(order, dish('c', 'HOT', 'MAIN'));
  fireCourse(order, 'MAIN', USER);
  const codes = order.kots.map((k) => k.code);
  t.equal(new Set(codes).size, codes.length, codes.join(', '));
});

/* ------------------------------------------------------- derivations --- */

test('a table stage follows the food, not a stored flag', (t) => {
  const order = fresh();
  t.equal(orderStage(order), 'SEATED', 'nothing ordered');

  addLine(order, dish('a', 'HOT', 'MAIN'));
  t.equal(orderStage(order), 'SEATED', 'written but not sent — still just seated');

  const [kot] = fireCourse(order, 'MAIN', USER).kots;
  t.equal(orderStage(order), 'ORDERED');

  advanceKot(order, kot.id, KOT_STATUS.SERVED);
  t.equal(orderStage(order), 'SERVED');

  order.invoice = { code: 'INV-0001' };
  t.equal(orderStage(order), 'BILLED');

  order.status = 'SETTLED';
  t.equal(orderStage(order), 'CLEANING');
});

test('course pacing reports one state per course', (t) => {
  const order = fresh();
  addLine(order, dish('a', 'COLD', 'STARTER'));
  addLine(order, dish('b', 'HOT', 'MAIN'), { qty: 3 });
  fireCourse(order, 'STARTER', USER);

  const pacing = Object.fromEntries(
    coursePacing(order).map((p) => [p.course.id, `${p.state}:${p.count}`])
  );
  t.equal(pacing.STARTER, 'FIRED:1');
  t.equal(pacing.MAIN, 'HELD:3');
  t.equal(pacing.DESSERT, 'EMPTY:0');
});

test('seats in use are listed in order and only once each', (t) => {
  const order = fresh(6);
  addLine(order, dish('a', 'HOT', 'MAIN'), { seat: 3 });
  addLine(order, dish('b', 'HOT', 'MAIN'), { seat: 1 });
  addLine(order, dish('c', 'HOT', 'MAIN'), { seat: 3 });
  addLine(order, dish('d', 'COLD', 'STARTER'), { seat: null });
  t.deepEqual(seatsUsed(order), [1, 3]);
});

test('a comped line still counts as ordered but not as revenue', (t) => {
  const order = fresh();
  addLine(order, dish('a', 'HOT', 'MAIN', 100000));
  addLine(order, dish('b', 'HOT', 'MAIN', 100000));
  compLine(order, order.lines[1].id, 'Long wait', 'Farid Naqvi');
  t.equal(orderValue(order), 100000);
  t.equal(order.lines[1].comp, true);
  t.equal(order.lines[1].compReason, 'Long wait');
});

test('station timings are only reported for dockets that finished', (t) => {
  const order = fresh();
  addLine(order, dish('a', 'HOT', 'MAIN'));
  addLine(order, dish('b', 'COLD', 'MAIN'));
  const kots = fireCourse(order, 'MAIN', USER).kots;
  const hot = kots.find((k) => k.station === 'HOT');
  hot.firedAt = Date.now() - 12 * 60000;
  advanceKot(order, hot.id, KOT_STATUS.READY);

  const durations = kotDurations(order);
  t.equal(durations.length, 1, 'the cold larder docket is still cooking');
  t.equal(durations[0].station, 'HOT');
  t.equal(durations[0].minutes, 12);
});
