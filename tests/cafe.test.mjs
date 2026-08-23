/**
 * Tests for the cafe-floor logic added on top of the billing counter.
 *
 * Everything here is pure: quantity arithmetic, shift and attendance maths, the
 * handoff code that carries an order between two devices, and the stable menu
 * codes those handoffs depend on. The parts that need a browser — IndexedDB,
 * the views — are covered by driving the real app instead.
 */

import {
  parseQuantity,
  toQuantity,
  quantityToNumber,
  formatQuantity,
  formatQuantityWithUnit,
  multiplyQuantity,
  QUANTITY_SCALE,
} from '../src/core/quantity.js';
import {
  parseTimeOfDay,
  formatTimeOfDay,
  formatDuration,
  minutesBetween,
  shiftMinutes,
  attendanceMinutes,
  summariseHours,
} from '../src/repositories/staff.repo.js';
import { encodeHandoff, decodeHandoff } from '../src/services/orderChannel.service.js';
import { menuCode } from '../src/repositories/menu.repo.js';
import { MENU_SEED } from '../src/data/menu.seed.js';

let pass = 0;
let fail = 0;

function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else {
    fail++;
    console.log(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  }
}

function ok(name, condition, detail = '') {
  if (condition) pass++;
  else {
    fail++;
    console.log(`FAIL ${name}${detail ? `\n  ${detail}` : ''}`);
  }
}

function throws(name, fn) {
  try {
    fn();
    fail++;
    console.log(`FAIL ${name}\n  expected it to be rejected, but it was accepted`);
  } catch {
    pass++;
  }
}

/* ------------------------------------------------------- quantities --- */

eq('scale is thousandths', QUANTITY_SCALE, 1000);
eq('parse whole', parseQuantity('250'), 250000);
eq('parse decimal', parseQuantity('1.5'), 1500);
eq('parse three places', parseQuantity('0.125'), 125);
eq('parse with comma', parseQuantity('1,250'), 1250000);
eq('parse blank', parseQuantity(''), null);
eq('parse letters', parseQuantity('abc'), null);
eq('parse negative', parseQuantity('-5'), null);
eq('parse over-precise', parseQuantity('0.1255'), null);
eq('toQuantity', toQuantity(2.5), 2500);
eq('quantityToNumber', quantityToNumber(1500), 1.5);

eq('format trims zeros', formatQuantity(1500), '1.5');
eq('format whole', formatQuantity(250000), '250');
eq('format zero', formatQuantity(0), '0');
eq('format small', formatQuantity(125), '0.125');
eq('format with unit', formatQuantityWithUnit(1500, 'kg'), '1.5 kg');

// The reason quantities are integers at all. A shot of syrup is 0.018 of a
// litre; take that off a 1000-litre figure four hundred times in floating
// point and the answer stops matching the shelf.
let shelf = toQuantity(1000);
for (let i = 0; i < 400; i++) shelf -= toQuantity(0.018);
eq('400 deductions leave an exact figure', shelf, toQuantity(1000) - 400 * 18);
ok('and it is still an integer', Number.isInteger(shelf));

// A cappuccino's worth of milk, sold three times.
eq('multiply by portions', multiplyQuantity(toQuantity(150), 3), toQuantity(450));
eq('multiply by zero', multiplyQuantity(toQuantity(150), 0), 0);

/* ------------------------------------------------ shifts and hours --- */

eq('parse time', parseTimeOfDay('09:30'), 570);
eq('parse midnight', parseTimeOfDay('00:00'), 0);
eq('parse single-digit hour', parseTimeOfDay('9:05'), 545);
eq('reject 24:00', parseTimeOfDay('24:00'), null);
eq('reject 12:60', parseTimeOfDay('12:60'), null);
eq('reject nonsense', parseTimeOfDay('lunchtime'), null);
eq('format time', formatTimeOfDay(570), '09:30');
eq('format wraps past midnight', formatTimeOfDay(1500), '01:00');

eq('duration hours and minutes', formatDuration(570), '9h 30m');
eq('duration whole hours', formatDuration(480), '8h');
eq('duration minutes only', formatDuration(45), '45m');
eq('duration zero', formatDuration(0), '0m');

eq('ordinary shift', minutesBetween('09:00', '17:00'), 480);
// The late shift is the case that turns into a negative day if it is ignored.
eq('shift over midnight', minutesBetween('22:00', '02:00'), 240);
eq('shift ending at midnight', minutesBetween('18:00', '00:00'), 360);
eq('same time is nothing', minutesBetween('09:00', '09:00'), 0);

eq('shift less its break', shiftMinutes({ start: '09:00', end: '17:00', breakMinutes: 30 }), 450);
eq('shift with no break', shiftMinutes({ start: '09:00', end: '17:00' }), 480);
eq(
  'late shift less its break',
  shiftMinutes({ start: '22:00', end: '06:00', breakMinutes: 60 }),
  420
);
eq('a break longer than the shift cannot go negative', shiftMinutes({ start: '09:00', end: '10:00', breakMinutes: 120 }), 0);

const day = (h, m = 0) => new Date(2026, 0, 5, h, m).toISOString();
eq(
  'attendance from clock times',
  attendanceMinutes({ clockIn: day(9, 5), clockOut: day(17, 10), breakMinutes: 30 }),
  455
);
eq('still clocked in counts nothing yet', attendanceMinutes({ clockIn: day(9), clockOut: null }), 0);
eq('no record counts nothing', attendanceMinutes(null), 0);
eq(
  'a clock-out before the clock-in is not negative time',
  attendanceMinutes({ clockIn: day(17), clockOut: day(9) }),
  0
);
eq(
  'attendance across midnight',
  attendanceMinutes({
    clockIn: new Date(2026, 0, 5, 22, 0).toISOString(),
    clockOut: new Date(2026, 0, 6, 2, 0).toISOString(),
    breakMinutes: 0,
  }),
  240
);

const staff = [
  { id: 's1', name: 'Aarav', jobTitle: 'Barista', hourlyRate: 15000 },
  { id: 's2', name: 'Meera', jobTitle: 'Manager', hourlyRate: 25000 },
];
const attendance = [
  { staffId: 's1', date: '2026-01-05', status: 'PRESENT', clockIn: day(9), clockOut: day(17), breakMinutes: 30 },
  { staffId: 's1', date: '2026-01-06', status: 'ABSENT', clockIn: null, clockOut: null, breakMinutes: 0 },
  { staffId: 's2', date: '2026-01-05', status: 'LEAVE', clockIn: null, clockOut: null, breakMinutes: 0 },
  // Outside the range, so it must not be counted.
  { staffId: 's1', date: '2026-02-01', status: 'PRESENT', clockIn: day(9), clockOut: day(17), breakMinutes: 0 },
];
const shifts = [
  { staffId: 's1', date: '2026-01-05', start: '09:00', end: '17:00', breakMinutes: 30 },
  { staffId: 's2', date: '2026-01-05', start: '12:00', end: '20:00', breakMinutes: 45 },
];
const summary = summariseHours(staff, attendance, shifts, { from: '2026-01-05', to: '2026-01-11' });

eq('summary covers everyone', summary.length, 2);
eq('days present', summary[0].days, 1);
eq('absences counted', summary[0].absent, 1);
eq('leave counted', summary[1].leave, 1);
eq('minutes worked in range only', summary[0].minutes, 450);
eq('rostered minutes', summary[0].rosteredMinutes, 450);
// 450 minutes = 7.5 hours at 150.00 an hour = 1125.00, in paise.
eq('pay from hours actually worked', summary[0].pay, 112500);
eq('no hours means no pay', summary[1].pay, 0);

/* --------------------------------------------------- handoff codes --- */

const order = {
  tableToken: 'zinhqmm3j7c9',
  code: 'WY36',
  customerName: 'Riya',
  note: 'Extra hot please',
  lines: [
    { code: '1xogwyr', quantity: 2 },
    { code: 'abc1234', quantity: 1 },
  ],
};

const encoded = encodeHandoff(order);
ok('handoff stays short enough for a small QR code', encoded.length < 160, `${encoded.length} characters`);
ok('handoff is plain ASCII', /^[\x20-\x7e]+$/.test(encoded), encoded);

const decoded = decodeHandoff(encoded);
eq('table survives the round trip', decoded.tableToken, order.tableToken);
eq('order code survives', decoded.code, order.code);
eq('customer name survives', decoded.customerName, order.customerName);
eq('note survives', decoded.note, order.note);
eq('lines survive', decoded.lines, [
  { code: '1xogwyr', quantity: 2 },
  { code: 'abc1234', quantity: 1 },
]);

// Prices are deliberately absent: the counter prices from its own menu, so a
// stale price on a customer's phone can never decide what is charged.
const priced = encodeHandoff({
  ...order,
  estimatedTotal: 71900,
  lines: [
    { code: '1xogwyr', quantity: 2, unitPrice: 18000, name: 'Cappuccino' },
    { code: 'abc1234', quantity: 1, unitPrice: 35900, name: 'Lotus Cloud' },
  ],
});
ok('unit prices do not travel in the code', !priced.includes('18000') && !priced.includes('35900'), priced);
ok('the order total does not travel either', !priced.includes('71900'), priced);
eq('and it still decodes to the right quantities', decodeHandoff(priced).lines, [
  { code: '1xogwyr', quantity: 2 },
  { code: 'abc1234', quantity: 1 },
]);

// Names with the delimiter in them must not corrupt the code.
const awkward = encodeHandoff({
  ...order,
  customerName: 'Ana | Bob',
  note: 'no | pipes, please',
});
eq('a name containing the delimiter survives', decodeHandoff(awkward).customerName, 'Ana | Bob');
eq('a note containing the delimiter survives', decodeHandoff(awkward).note, 'no | pipes, please');

const emptyExtras = encodeHandoff({ ...order, customerName: '', note: '' });
eq('blank name round trips', decodeHandoff(emptyExtras).customerName, '');

throws('a mistyped code is rejected', () => decodeHandoff(encoded.replace('*2', '*3')));
throws('a truncated code is rejected', () => decodeHandoff(encoded.slice(0, -4)));
throws('a code from somewhere else is rejected', () => decodeHandoff('https://example.com'));
throws('an empty code is rejected', () => decodeHandoff(''));
throws('a code with no items is rejected', () => decodeHandoff('TBC1|tok||||CODE|000000'));

/* ------------------------------------------------------ menu codes --- */

// The whole QR ordering path rests on this: two devices that have never met
// must agree on what an item is, without sharing generated ids.
eq('code is stable', menuCode('Cappuccino', 'Hot'), menuCode('Cappuccino', 'Hot'));
eq('code ignores surrounding space', menuCode('  Cappuccino ', 'Hot'), menuCode('Cappuccino', 'Hot'));
eq('code ignores case', menuCode('CAPPUCCINO', 'hot'), menuCode('Cappuccino', 'Hot'));
ok('a different item gets a different code', menuCode('Latte', 'Hot') !== menuCode('Cappuccino', 'Hot'));
ok('the same name in another category differs', menuCode('Latte', 'Iced') !== menuCode('Latte', 'Hot'));
ok('codes are short and URL-safe', /^[a-z0-9]{7}$/.test(menuCode('Cappuccino', 'Hot')), menuCode('Cappuccino', 'Hot'));

// A collision would send a customer's order to the wrong drink.
const codes = MENU_SEED.map((item) => menuCode(item.name, item.category));
eq('every item on the shipped menu has its own code', new Set(codes).size, MENU_SEED.length);

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
