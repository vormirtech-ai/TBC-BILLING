/** Aggregations for the dashboard. Pure functions over already-loaded sales. */

import { PAYMENT_METHODS } from '../config/app.config.js';
import { sum } from '../core/utils.js';

export function liveOnly(transactions) {
  return transactions.filter((txn) => (txn.status || 'COMPLETED') !== 'VOID');
}

export function summarise(transactions) {
  const live = liveOnly(transactions);
  const totalSales = sum(live, (t) => t.grandTotal);
  const itemCount = sum(live, (t) => sum(t.items, (i) => i.quantity));

  return {
    orderCount: live.length,
    voidCount: transactions.length - live.length,
    totalSales,
    itemCount,
    averageOrder: live.length ? Math.round(totalSales / live.length) : 0,
    discountTotal: sum(live, (t) => t.discountAmount),
    taxTotal: sum(live, (t) => t.taxAmount),
  };
}

export function paymentBreakdown(transactions) {
  const live = liveOnly(transactions);
  const total = sum(live, (t) => t.grandTotal);

  return PAYMENT_METHODS.map((method) => {
    const rows = live.filter((txn) => txn.paymentMethod === method.id);
    const value = sum(rows, (t) => t.grandTotal);
    return {
      id: method.id,
      label: method.label,
      count: rows.length,
      value,
      share: total ? value / total : 0,
    };
  });
}

export function topItems(transactions, limit = 6) {
  const tally = new Map();
  for (const txn of liveOnly(transactions)) {
    for (const item of txn.items) {
      const entry = tally.get(item.name) || {
        name: item.name,
        category: item.category,
        quantity: 0,
        value: 0,
      };
      entry.quantity += item.quantity;
      entry.value += item.total;
      tally.set(item.name, entry);
    }
  }
  return [...tally.values()]
    .sort((a, b) => b.quantity - a.quantity || b.value - a.value)
    .slice(0, limit);
}

export function categoryBreakdown(transactions) {
  const tally = new Map();
  for (const txn of liveOnly(transactions)) {
    for (const item of txn.items) {
      const entry = tally.get(item.category) || { category: item.category, quantity: 0, value: 0 };
      entry.quantity += item.quantity;
      entry.value += item.total;
      tally.set(item.category, entry);
    }
  }
  const rows = [...tally.values()].sort((a, b) => b.value - a.value);
  const total = sum(rows, (r) => r.value);
  return rows.map((row) => ({ ...row, share: total ? row.value / total : 0 }));
}

/** Sales per hour of the trading day, for the activity strip. */
export function hourlySales(transactions) {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, value: 0, count: 0 }));
  for (const txn of liveOnly(transactions)) {
    const hour = new Date(txn.createdAt).getHours();
    buckets[hour].value += txn.grandTotal;
    buckets[hour].count += 1;
  }
  return buckets;
}

/** Last N trading days, oldest first, for the trend strip. */
export function dailyTrend(days, limit = 14) {
  return [...days]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-limit)
    .map((day) => ({
      date: day.date,
      dayNumber: day.dayNumber,
      value: day.totalSales,
      count: day.transactionCount,
    }));
}
