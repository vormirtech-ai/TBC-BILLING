/**
 * The Day 1 / Day 2 / Day 3 ledger.
 *
 * A "business day" record is created the first time a sale is taken on a date,
 * so numbering follows trading days rather than calendar days — a closed
 * Monday does not consume a day number. The Admin sets which number the count
 * starts from in Settings before the first sale.
 */

import { STORES, getAll, getByKey, put, clearStore, putMany } from '../db/database.js';
import { requireAdmin } from '../core/session.js';
import { pad } from '../core/utils.js';

export async function listDays() {
  const days = await getAll(STORES.BUSINESS_DAYS);
  return days.sort((a, b) => b.date.localeCompare(a.date));
}

export function getDay(dateKey) {
  return getByKey(STORES.BUSINESS_DAYS, dateKey);
}

export async function getDayNumber(dateKey) {
  const day = await getDay(dateKey);
  return day?.dayNumber ?? null;
}

/** Marks a day as exported; purely informational, shown in the history screen. */
export async function markExported(dateKey) {
  const day = await getDay(dateKey);
  if (!day) return null;
  const updated = {
    ...day,
    lastExportedAt: new Date().toISOString(),
    exportCount: (day.exportCount || 0) + 1,
  };
  await put(STORES.BUSINESS_DAYS, updated);
  return updated;
}

/**
 * Rebuild every day's totals from the sales themselves. The rollups are kept
 * live during billing; this is the repair tool for the rare case where a device
 * was interrupted or data was restored from an older backup.
 */
export async function recalculateDays(transactions, startNumber = 1) {
  requireAdmin('rebuilding day totals');
  const existing = await listDays();
  const byDate = new Map(existing.map((day) => [day.date, day]));

  const dates = [...new Set(transactions.map((row) => row.businessDate))].sort();
  const rebuilt = [];
  let nextNumber = Number(startNumber) || 1;

  for (const date of dates) {
    const rows = transactions.filter((row) => row.businessDate === date);
    const live = rows.filter((row) => (row.status || 'COMPLETED') !== 'VOID');
    const previous = byDate.get(date);

    rebuilt.push({
      date,
      dayNumber: previous?.dayNumber ?? nextNumber,
      openedAt: previous?.openedAt || rows[rows.length - 1]?.createdAt || null,
      transactionCount: live.length,
      voidCount: rows.length - live.length,
      itemCount: live.reduce(
        (total, row) => total + row.items.reduce((n, item) => n + item.quantity, 0),
        0
      ),
      totalSales: live.reduce((total, row) => total + row.grandTotal, 0),
      lastTransactionAt: rows[0]?.createdAt || null,
      lastExportedAt: previous?.lastExportedAt || null,
      exportCount: previous?.exportCount || 0,
    });
    nextNumber = Math.max(nextNumber, (previous?.dayNumber ?? nextNumber) + 1);
  }

  await clearStore(STORES.BUSINESS_DAYS);
  if (rebuilt.length) await putMany(STORES.BUSINESS_DAYS, rebuilt);
  return rebuilt.length;
}

export async function replaceAll(days) {
  await clearStore(STORES.BUSINESS_DAYS);
  if (days.length) await putMany(STORES.BUSINESS_DAYS, days);
}

/** "Day 07" — the label used on export filenames and in the UI. */
export function dayLabel(dayNumber) {
  return `Day ${pad(dayNumber ?? 0, 2)}`;
}
