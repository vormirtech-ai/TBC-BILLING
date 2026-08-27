/**
 * Tests for the customer book and the treats that hang off it.
 *
 * Two things are worth being strict about here, because both of them are
 * promises made out loud to a customer:
 *
 *   A STREAK IS COUNTED ON TRADING DAYS. A cafe that shuts on Sunday must not
 *   quietly cancel a regular's streak every week.
 *
 *   A FREE COFFEE IS FREE. Whatever else is on the bill — a percentage
 *   discount, tax, rounding — the reward must come off in full, and the parts
 *   must still add up to the total exactly.
 */

import {
  streakOf,
  streakProgress,
  birthdayStatus,
  pendingRewards,
  chooseRewardLine,
  buildReward,
  isRewardable,
  monthDayOf,
} from '../src/services/loyalty.service.js';
import {
  normalisePhone,
  formatPhone,
  isValidPhone,
  customerId,
  parseBirthday,
  formatBirthday,
} from '../src/repositories/customers.repo.js';
import { priceOrder } from '../src/services/pricing.js';

let pass = 0;
let fail = 0;

function eq(name, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
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

const settings = {
  loyaltyEnabled: true,
  loyaltyStreakDays: 5,
  loyaltyBirthdayEnabled: true,
  loyaltyBirthdayWindowDays: 0,
  loyaltyRewardLabel: 'Free coffee',
  loyaltyRewardCategories: ['Hot', 'Iced'],
  loyaltyRewardCap: 0,
};

const customer = (visitDays, extra = {}) => ({
  id: 'cus_9876543210',
  phone: '9876543210',
  name: 'Riya',
  birthday: '',
  visitDays,
  visitCount: visitDays.length,
  rewards: {},
  ...extra,
});

/* ------------------------------------------------------------- phones --- */

eq('phone: spaces and dashes', normalisePhone('98765-43210'), '9876543210');
eq('phone: +91', normalisePhone('+91 98765 43210'), '9876543210');
eq('phone: trunk zero', normalisePhone('098765 43210'), '9876543210');
eq('phone: formatted for reading', formatPhone('919876543210'), '98765 43210');
eq('phone: a short one is left alone', formatPhone('12345'), '12345');
ok('phone: ten digits is valid', isValidPhone('9876543210'));
ok('phone: four digits is not', !isValidPhone('9876'));
// The id is derived, so two tills that never met still agree on who this is.
eq('phone: same id from either spelling', customerId('+91 98765 43210'), customerId('09876543210'));

/* ---------------------------------------------------------- birthdays --- */

eq('birthday: day first', parseBirthday('14/03'), { birthday: '03-14', birthYear: null });
eq('birthday: with a year', parseBirthday('14/03/1994'), { birthday: '03-14', birthYear: 1994 });
eq('birthday: ISO from a date field', parseBirthday('1994-03-14'), {
  birthday: '03-14',
  birthYear: 1994,
});
eq('birthday: 29 February survives', parseBirthday('29/02').birthday, '02-29');
eq('birthday: blank is allowed', parseBirthday(''), { birthday: '', birthYear: null });
throws('birthday: 31 February is a typo', () => parseBirthday('31/02'));
throws('birthday: month 13', () => parseBirthday('01/13'));
throws('birthday: nonsense', () => parseBirthday('sometime in March'));
eq('birthday: read back', formatBirthday('03-14'), '14 March');
eq('monthDayOf', monthDayOf('2026-03-14'), '03-14');

const birthdayGuy = customer([], { birthday: '03-14' });

ok('birthday: on the day', birthdayStatus(birthdayGuy, { today: '2026-03-14' }).isToday);
eq('birthday: two days off', birthdayStatus(birthdayGuy, { today: '2026-03-12' }).daysAway, 2);
ok(
  'birthday: outside the window',
  !birthdayStatus(birthdayGuy, { today: '2026-03-12', windowDays: 1 }).within
);
ok(
  'birthday: inside a birthday week',
  birthdayStatus(birthdayGuy, { today: '2026-03-12', windowDays: 3 }).within
);
// 30 December is two days from 1 January, not three hundred and sixty-three.
eq(
  'birthday: across the new year',
  birthdayStatus(customer([], { birthday: '01-01' }), { today: '2025-12-30' }).daysAway,
  2
);
// A birthday the calendar does not have that year falls back to the 28th.
eq(
  'birthday: 29 February in a normal year',
  birthdayStatus(customer([], { birthday: '02-29' }), { today: '2026-02-28' }).daysAway,
  0
);

/* ------------------------------------------------------------ streaks --- */

const week = ['2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13'];

eq(
  'streak: five days in a row',
  streakOf(customer(week), { today: '2026-03-13', tradingDays: week }).length,
  5
);

// Today is still in progress: a regular who has not been in yet at 9 a.m. is
// not on zero.
eq(
  'streak: today does not count against them',
  streakOf(customer(week), { today: '2026-03-14', tradingDays: [...week, '2026-03-14'] }).length,
  5
);

// A whole trading day passed without them, and the streak is over.
eq(
  'streak: a missed trading day ends it',
  streakOf(customer(week), { today: '2026-03-15', tradingDays: [...week, '2026-03-14', '2026-03-15'] })
    .length,
  0
);

// The cafe shut on the 14th, so nobody could have come in. That is not a miss.
eq(
  'streak: a day the cafe was shut does not break it',
  streakOf(customer([...week, '2026-03-15']), {
    today: '2026-03-15',
    tradingDays: [...week, '2026-03-15'],
  }).length,
  6
);

// An old visit does not join up with a recent one across a day they missed.
eq(
  'streak: counts back only as far as the first day missed',
  streakOf(customer(['2026-03-01', '2026-03-09', '2026-03-10']), {
    today: '2026-03-10',
    tradingDays: ['2026-03-01', '2026-03-08', '2026-03-09', '2026-03-10'],
  }).length,
  2
);

// Once a treat has been given, the count starts again from the next visit.
eq(
  'streak: restarts after a treat is claimed',
  streakOf(customer(week), {
    today: '2026-03-13',
    tradingDays: week,
    since: '2026-03-11',
  }).length,
  2
);

eq(
  'streak: the till counts the visit being rung up',
  streakOf(customer(week.slice(0, 4)), {
    today: '2026-03-13',
    tradingDays: week,
    assumeToday: true,
  }).length,
  5
);

eq('streak: nobody has no streak', streakOf(customer([]), { today: '2026-03-13' }).length, 0);

eq(
  'streak progress: how many more to go',
  streakProgress(customer(week.slice(0, 3)), {
    today: '2026-03-11',
    tradingDays: week,
    settings,
  }),
  { length: 3, credit: 3, target: 5, toGo: 2, visitedToday: true }
);

// A treat given yesterday does not shorten the run the customer is actually on;
// it only resets what counts towards the next one.
eq(
  'streak progress: the run and the credit are different numbers',
  streakProgress(customer(week, { rewards: { streakClaimedOn: '2026-03-11' } }), {
    today: '2026-03-13',
    tradingDays: week,
    settings,
  }),
  { length: 5, credit: 2, target: 5, toGo: 3, visitedToday: true }
);

/* ------------------------------------------------------------ rewards --- */

const earned = pendingRewards(customer(week), { today: '2026-03-13', tradingDays: week, settings });
eq('reward: five days earns one', earned.map((entry) => entry.kind), ['STREAK']);
eq('reward: it is called what the cafe calls it', earned[0].label, 'Free coffee');

eq(
  'reward: not earned at four days',
  pendingRewards(customer(week.slice(0, 4)), {
    today: '2026-03-12',
    tradingDays: week,
    settings,
  }).length,
  0
);

eq(
  'reward: not given twice for one streak',
  pendingRewards(customer(week, { rewards: { streakClaimedOn: '2026-03-13' } }), {
    today: '2026-03-13',
    tradingDays: week,
    settings,
  }).length,
  0
);

eq(
  'reward: a birthday earns one on its own',
  pendingRewards(customer([], { birthday: '03-13' }), {
    today: '2026-03-13',
    tradingDays: week,
    settings,
  }).map((entry) => entry.kind),
  ['BIRTHDAY']
);

eq(
  'reward: a birthday is once a year',
  pendingRewards(customer([], { birthday: '03-13', rewards: { birthdayClaimedYear: 2026 } }), {
    today: '2026-03-13',
    tradingDays: week,
    settings,
  }).length,
  0
);

eq(
  'reward: the same birthday comes round again next year',
  pendingRewards(customer([], { birthday: '03-13', rewards: { birthdayClaimedYear: 2025 } }), {
    today: '2026-03-13',
    tradingDays: week,
    settings,
  }).length,
  1
);

eq(
  'reward: switched off gives nothing',
  pendingRewards(customer(week), {
    today: '2026-03-13',
    tradingDays: week,
    settings: { ...settings, loyaltyEnabled: false },
  }).length,
  0
);

/* ------------------------------------------------- picking what is free --- */

const lines = [
  { lineId: 'a', itemId: 'i1', name: 'Espresso', category: 'Hot', unitPrice: 14000, quantity: 1 },
  { lineId: 'b', itemId: 'i2', name: 'Cappuccino', category: 'Hot', unitPrice: 18000, quantity: 2 },
  { lineId: 'c', itemId: 'i3', name: 'Fries', category: 'Fries', unitPrice: 14900, quantity: 1 },
];

ok('eligible: a coffee is', isRewardable(lines[0], settings));
ok('eligible: chips are not', !isRewardable(lines[2], settings));
ok('eligible: everything is, when no categories are named', isRewardable(lines[2], { ...settings, loyaltyRewardCategories: [] }));
eq('choose: the dearest qualifying drink', chooseRewardLine(lines, settings).lineId, 'b');
eq('choose: nothing qualifies', chooseRewardLine([lines[2]], settings), null);

eq(
  'build: worth one unit, not the whole line',
  buildReward({ kind: 'STREAK' }, lines[1], settings).amount,
  18000
);
eq(
  'build: capped where the cafe caps it',
  buildReward({ kind: 'STREAK' }, lines[1], { ...settings, loyaltyRewardCap: 15000 }).amount,
  15000
);

/* -------------------------------------------------- the reward on a bill --- */

const billing = {
  taxEnabled: true,
  priceIncludesTax: false,
  defaultTaxRate: 500,
  discountEnabled: true,
  maxDiscountPercent: 100,
  roundOffEnabled: false,
  taxLabel: 'GST',
};

const reward = buildReward({ kind: 'STREAK' }, lines[1], settings);
const priced = priceOrder(lines, billing, { type: 'PERCENT', value: 0 }, reward);

eq('bill: subtotal is untouched', priced.subtotal, 14000 + 36000 + 14900);
eq('bill: one cup is free', priced.rewardAmount, 18000);
eq('bill: the free cup comes off its own line', priced.items[1].rewardAmount, 18000);
eq('bill: nothing comes off the others', priced.items[0].rewardAmount, 0);
eq(
  'bill: total is the rest plus tax',
  priced.grandTotal,
  14000 + 18000 + 14900 + Math.round((14000 + 18000 + 14900) * 0.05)
);
eq(
  'bill: the lines add up to the total',
  priced.items.reduce((total, line) => total + line.total, 0),
  priced.grandTotal
);

// A discount on top may only be taken from what is actually being paid for.
const both = priceOrder(lines, billing, { type: 'PERCENT', value: 1000 }, reward);
eq('bill: discount ignores the free item', both.discountAmount, Math.round((14000 + 18000 + 14900) * 0.1));
eq(
  'bill: reward and discount both land',
  both.items.reduce((total, line) => total + line.total, 0),
  both.grandTotal
);

// A reward pointing at a line that has since been taken off the order is worth
// nothing, rather than coming off something else.
const gone = priceOrder(lines, billing, { type: 'PERCENT', value: 0 }, {
  ...reward,
  lineId: 'nope',
  itemId: 'nope',
});
eq('bill: a reward with no line is worth nothing', gone.rewardAmount, 0);

// A reward can never be worth more than the line it sits on.
const oversized = priceOrder([lines[0]], billing, { type: 'PERCENT', value: 0 }, {
  ...reward,
  lineId: 'a',
  amount: 99000,
});
eq('bill: never worth more than the item', oversized.rewardAmount, 14000);
eq('bill: a wholly free order costs nothing', oversized.grandTotal, 0);

// Rounding still balances with a reward in play.
const rounded = priceOrder(lines, { ...billing, roundOffEnabled: true }, { type: 'PERCENT', value: 733 }, reward);
eq(
  'bill: rounding still balances',
  rounded.subtotal - rounded.rewardAmount - rounded.discountAmount + rounded.taxAmount + rounded.roundOff,
  rounded.grandTotal
);

console.log(`\nloyalty: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
