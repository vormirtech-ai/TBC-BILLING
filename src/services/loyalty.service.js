/**
 * Streaks and birthdays — the two reasons this cafe gives a coffee away.
 *
 * WHAT A STREAK IS
 * Days in a row that a customer came in, counted over the days the CAFE WAS
 * OPEN. That distinction is the whole trick: a cafe that shuts on Sunday would
 * otherwise break every regular's streak once a week, through no fault of the
 * regular. The business-day ledger already records exactly which days the cafe
 * traded, so it is used as the calendar.
 *
 * Today is not held against anybody. A customer on a four-day streak who has
 * not been in yet at 9 a.m. is still on four days, not zero — the streak only
 * ends when a trading day finishes without them.
 *
 * WHAT A BIRTHDAY IS
 * The day, not the year. The cafe may set a window either side of it, because
 * "come in this week for your birthday coffee" is a real thing a cafe says.
 *
 * WHAT A REWARD IS
 * One item off the bill, taken from the categories the cafe nominates. It is
 * not a percentage and not a voucher: the dearest qualifying drink in the
 * order is made free, up to a cap the cafe can set. Each treat is written down
 * on the customer's record when it is given, so it cannot be given twice.
 *
 * Everything here is a pure function of data it is handed. Nothing in this file
 * reads storage, which is why the rules can be tested without a browser.
 */

import { fromDateKey, toDateKey, pad } from '../core/utils.js';

export const REWARD_KINDS = { STREAK: 'STREAK', BIRTHDAY: 'BIRTHDAY' };

/* -------------------------------------------------------------- streaks --- */

/**
 * Every day the cafe was open, up to and including today, oldest first.
 *
 * A day somebody visited is a day the cafe was open, whatever the ledger says,
 * so the two lists are folded together rather than trusted separately.
 */
function openDays(tradingDays, visits, today) {
  const all = new Set([...(tradingDays || []), ...visits, today]);
  return [...all].filter((day) => day && day <= today).sort();
}

/**
 * How many trading days in a row this customer has come in.
 *
 * @param {object} customer
 * @param {{today:string, tradingDays?:string[], since?:string, assumeToday?:boolean}} context
 *   since        count only days after this one — a claimed streak starts again
 *   assumeToday  count today as visited; the till uses this while ringing up
 *                the visit that has not been saved yet
 * @returns {{length:number, visitedToday:boolean, startedOn:string}}
 */
export function streakOf(customer, { today, tradingDays = [], since = '', assumeToday = false } = {}) {
  const day = today || toDateKey();
  const visited = new Set(
    (customer?.visitDays || []).filter((entry) => entry <= day && (!since || entry > since))
  );
  if (assumeToday && (!since || day > since)) visited.add(day);

  const days = openDays(tradingDays, visited, day);
  let index = days.length - 1;
  const visitedToday = visited.has(day);

  // Today is still in progress, so a missing today does not end a streak.
  if (!visitedToday && days[index] === day) index -= 1;

  let length = 0;
  let startedOn = '';
  for (; index >= 0; index--) {
    if (!visited.has(days[index])) break;
    length += 1;
    startedOn = days[index];
  }

  return { length, visitedToday, startedOn };
}

/* ------------------------------------------------------------ birthdays --- */

/**
 * The customer's birthday as a real date in a given year, with 29 February
 * falling back to the 28th in the years that do not have one.
 */
function birthdayInYear(monthDay, year) {
  const [month, day] = String(monthDay).split('-').map(Number);
  if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return null;

  const date = new Date(year, month - 1, day);
  if (date.getMonth() !== month - 1) return new Date(year, month - 1 + 1, 0); // last day of that month
  return date;
}

const DAY_MS = 86400000;

/**
 * Is it their birthday, near enough?
 *
 * @returns {{has:boolean, isToday:boolean, within:boolean, daysAway:number|null, on:string}}
 */
export function birthdayStatus(customer, { today, windowDays = 0 } = {}) {
  const monthDay = String(customer?.birthday || '');
  if (!monthDay) return { has: false, isToday: false, within: false, daysAway: null, on: '' };

  const day = fromDateKey(today || toDateKey());
  const year = day.getFullYear();
  const window = Math.max(0, Math.min(60, Math.round(Number(windowDays) || 0)));

  // Look at last year, this year and next: a birthday on 1 January is two days
  // away on 30 December, not three hundred and sixty-three.
  let nearest = null;
  for (const candidate of [year - 1, year, year + 1]) {
    const date = birthdayInYear(monthDay, candidate);
    if (!date) continue;
    const away = Math.round((date.getTime() - day.getTime()) / DAY_MS);
    if (nearest === null || Math.abs(away) < Math.abs(nearest.away)) {
      nearest = { away, date };
    }
  }
  if (!nearest) return { has: false, isToday: false, within: false, daysAway: null, on: '' };

  return {
    has: true,
    isToday: nearest.away === 0,
    within: Math.abs(nearest.away) <= window,
    daysAway: nearest.away,
    on: toDateKey(nearest.date),
  };
}

/** "03-14" for a date key, for looking up whose birthday is today. */
export function monthDayOf(dateKey) {
  const parts = String(dateKey || toDateKey()).split('-');
  return parts.length === 3 ? `${pad(parts[1])}-${pad(parts[2])}` : '';
}

/* -------------------------------------------------------------- rewards --- */

/**
 * What this customer has earned but not yet been given.
 *
 * @param {object} customer
 * @param {{today:string, tradingDays?:string[], settings:object, assumeToday?:boolean}} context
 * @returns {{kind:string, label:string, detail:string}[]}
 */
export function pendingRewards(customer, { today, tradingDays = [], settings = {}, assumeToday = false } = {}) {
  if (!customer || settings.loyaltyEnabled === false) return [];

  const day = today || toDateKey();
  const label = settings.loyaltyRewardLabel || 'Free coffee';
  const rewards = customer.rewards || {};
  const earned = [];

  /* ---- birthday ---- */
  if (settings.loyaltyBirthdayEnabled !== false) {
    const birthday = birthdayStatus(customer, {
      today: day,
      windowDays: settings.loyaltyBirthdayWindowDays,
    });
    const claimedYear = Number(rewards.birthdayClaimedYear) || 0;
    const thisYear = Number(String(day).slice(0, 4)) || 0;

    if (birthday.within && claimedYear !== thisYear) {
      earned.push({
        kind: REWARD_KINDS.BIRTHDAY,
        label,
        detail: birthday.isToday
          ? 'It is their birthday today.'
          : `Their birthday is ${birthday.daysAway > 0 ? 'in' : ''} ${Math.abs(birthday.daysAway)} day${
              Math.abs(birthday.daysAway) === 1 ? '' : 's'
            }${birthday.daysAway > 0 ? '' : ' ago'}.`,
      });
    }
  }

  /* ---- streak ---- */
  const target = Math.max(2, Math.round(Number(settings.loyaltyStreakDays) || 5));
  const streak = streakOf(customer, {
    today: day,
    tradingDays,
    since: rewards.streakClaimedOn || '',
    assumeToday,
  });

  if (streak.length >= target) {
    earned.push({
      kind: REWARD_KINDS.STREAK,
      label,
      detail: `${streak.length} days in a row.`,
    });
  }

  return earned;
}

/**
 * How the streak is going, in a form a screen can show without doing sums.
 *
 * Two numbers, and they are not the same number. LENGTH is the run: how many
 * trading days in a row this customer has actually come in, which is the thing
 * worth saying out loud across a counter. CREDIT is how much of that run counts
 * towards the next free coffee — the run since the last one was given, because
 * a treat already handed over cannot be earned twice.
 *
 * They differ for exactly one customer: the one who was given a coffee
 * yesterday and came back today. Their run is long and their credit is one day,
 * and both of those are true.
 *
 * @returns {{length:number, credit:number, target:number, toGo:number, visitedToday:boolean}}
 */
export function streakProgress(customer, { today, tradingDays = [], settings = {}, assumeToday = false } = {}) {
  const target = Math.max(2, Math.round(Number(settings.loyaltyStreakDays) || 5));
  const run = streakOf(customer, { today, tradingDays, assumeToday });
  const credit = streakOf(customer, {
    today,
    tradingDays,
    since: customer?.rewards?.streakClaimedOn || '',
    assumeToday,
  });
  return {
    length: run.length,
    credit: credit.length,
    target,
    toGo: Math.max(0, target - credit.length),
    visitedToday: run.visitedToday,
  };
}

/* ------------------------------------------------- applying it to a bill --- */

/** Categories a free item may be taken from. Blank means anything on the menu. */
export function rewardCategories(settings = {}) {
  const list = settings.loyaltyRewardCategories;
  return Array.isArray(list) ? list.filter(Boolean) : [];
}

export function isRewardable(line, settings = {}) {
  const categories = rewardCategories(settings);
  if (!categories.length) return true;
  return categories.some(
    (category) => String(category).toLowerCase() === String(line?.category || '').toLowerCase()
  );
}

/** The lines in this order a free drink could be taken from. */
export function eligibleRewardLines(lines = [], settings = {}) {
  return lines.filter((line) => line.quantity > 0 && isRewardable(line, settings));
}

/**
 * Which line to make free: the dearest one that qualifies.
 *
 * A cafe that says "your coffee is on us" means the coffee in front of them,
 * and the generous reading is the one worth defending at the counter.
 */
export function chooseRewardLine(lines = [], settings = {}) {
  const eligible = eligibleRewardLines(lines, settings);
  if (!eligible.length) return null;
  return eligible.reduce((best, line) => (line.unitPrice > best.unitPrice ? line : best), eligible[0]);
}

/**
 * Build the reward that goes on the cart.
 *
 * @param {{kind:string, label?:string}} earned
 * @param {object} line  the cart line the free item comes off
 * @param {object} settings
 */
export function buildReward(earned, line, settings = {}) {
  if (!earned || !line) return null;
  const cap = Math.max(0, Math.round(Number(settings.loyaltyRewardCap) || 0));
  const amount = cap > 0 ? Math.min(line.unitPrice, cap) : line.unitPrice;

  return {
    kind: earned.kind,
    label: earned.label || settings.loyaltyRewardLabel || 'Free coffee',
    reason: earned.detail || '',
    lineId: line.lineId,
    itemId: line.itemId,
    name: line.name,
    unitPrice: line.unitPrice,
    amount,
  };
}
