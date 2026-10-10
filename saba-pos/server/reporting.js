/**
 * The takings, over SQLite.
 *
 * The assembly itself lives in `app/src/shared/takings.js` so that the
 * published demonstration and anything else embedding Saba produce the very
 * same report. This file is only the part that knows where the orders are
 * kept.
 */

import { all, one } from './db/index.js';
import * as store from './store.js';

import {
  buildDayReport as assembleDay,
  buildRangeReport as assembleRange,
  dayRecord as assembleDayRecord,
} from '../app/src/shared/takings.js';

/** Where this process reads its history from. */
const source = {
  settledOn: (day) => store.settledOn(day),
  ordersBetween: (from, to) => store.ordersBetween(from, to),
  openOrders: () => store.openOrders(),
  shiftFor: (day) =>
    one('SELECT * FROM shifts WHERE day = ? ORDER BY opened_at DESC LIMIT 1', day) || null,
};

export const dayRecord = (day) => assembleDayRecord(day, source);
export const buildRangeReport = (from, to) => assembleRange(from, to, source);
export const buildDayReport = (day) => assembleDay(day, source);

/** Which days have any trading at all — used to drive a date picker. */
export const tradingDays = () =>
  all("SELECT business_day AS day, count(*) AS bills FROM orders"
    + " WHERE status = 'SETTLED' GROUP BY business_day ORDER BY business_day DESC");
