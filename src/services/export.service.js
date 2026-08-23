/**
 * Excel exports.
 *
 * Layout decision worth knowing: one row per ITEM, with the order-level totals
 * (subtotal, tax, discount, grand total) written only on the FIRST row of each
 * order and left blank on its remaining rows. That keeps every item tied to its
 * bill while letting you drop a plain =SUM() under the Grand Total column
 * without counting the same order twice.
 */

import { createWorkbook, STYLE } from '../lib/xlsx.js';
import { paiseToRupees } from '../core/money.js';
import { downloadBlob, formatDateKeyLong, fromDateKey, pad, sum } from '../core/utils.js';
import { requireAdmin } from '../core/session.js';
import { getSettings } from '../repositories/settings.repo.js';
import * as transactionsRepo from '../repositories/transactions.repo.js';
import * as daysRepo from '../repositories/businessDays.repo.js';
import { getMenu } from '../repositories/menu.repo.js';
import { AppError } from '../core/utils.js';
import { PAYMENT_METHODS, paymentLabel } from '../config/app.config.js';

const COLUMNS = [
  ['Transaction ID', 22],
  ['Order Number', 14],
  ['Business Day', 12],
  ['Date', 13],
  ['Time', 11],
  ['Cashier', 14],
  ['Payment Method', 15],
  ['Status', 11],
  ['Item Name', 30],
  ['Category', 18],
  ['Quantity', 9],
  ['Unit Price', 12],
  ['Item Total', 12],
  ['Item Discount', 13],
  ['Item Tax', 11],
  ['Line Total', 12],
  ['Order Subtotal', 14],
  ['Order Discount', 14],
  ['Order Tax', 12],
  ['Round Off', 11],
  ['Grand Total', 14],
  ['Customer', 18],
  ['Note', 26],
];

function money(paise) {
  return { v: paiseToRupees(paise), s: STYLE.CURRENCY };
}
function moneyBold(paise) {
  return { v: paiseToRupees(paise), s: STYLE.CURRENCY_BOLD };
}

function transactionRows(transactions) {
  const rows = [COLUMNS.map(([label]) => ({ v: label, s: STYLE.HEADER }))];

  // Oldest first: an export reads like the day actually happened.
  const ordered = [...transactions].sort((a, b) => a.seq - b.seq);

  for (const txn of ordered) {
    const created = new Date(txn.createdAt);
    txn.items.forEach((item, index) => {
      const first = index === 0;
      rows.push([
        txn.id,
        txn.orderNo,
        { v: txn.dayNumber ?? null, s: STYLE.INTEGER },
        { v: created, t: 'd', s: STYLE.DATE },
        { v: created, t: 't', s: STYLE.TIME },
        txn.cashierName || txn.cashier,
        paymentLabel(txn.paymentMethod),
        txn.status || 'COMPLETED',
        item.name,
        item.category,
        { v: item.quantity, s: STYLE.INTEGER },
        money(item.unitPrice),
        money(item.lineTotal),
        money(item.discountAmount || 0),
        money(item.taxAmount || 0),
        money(item.total),
        first ? money(txn.subtotal) : null,
        first ? money(txn.discountAmount) : null,
        first ? money(txn.taxAmount) : null,
        first ? money(txn.roundOff || 0) : null,
        first ? moneyBold(txn.grandTotal) : null,
        first ? txn.customerName || '' : null,
        first ? { v: [txn.note, item.note].filter(Boolean).join(' | '), s: STYLE.WRAP } : item.note || null,
      ]);
    });
  }
  return rows;
}

function summaryRows(transactions, { title, subtitle }) {
  const settings = getSettings();
  const live = transactions.filter((txn) => (txn.status || 'COMPLETED') !== 'VOID');
  const voided = transactions.length - live.length;

  const totalSales = sum(live, (t) => t.grandTotal);
  const totalItems = sum(live, (t) => sum(t.items, (i) => i.quantity));
  const average = live.length ? Math.round(totalSales / live.length) : 0;

  const rows = [
    [{ v: settings.cafeName, s: STYLE.TITLE }],
    [{ v: title, s: STYLE.BOLD }],
    [subtitle],
    [],
    [{ v: 'Sales', s: STYLE.BOLD }],
    ['Total sales', moneyBold(totalSales)],
    ['Orders completed', { v: live.length, s: STYLE.INTEGER }],
    ['Orders voided', { v: voided, s: STYLE.INTEGER }],
    ['Items sold', { v: totalItems, s: STYLE.INTEGER }],
    ['Average order value', money(average)],
    ['Discounts given', money(sum(live, (t) => t.discountAmount))],
    [`${settings.taxLabel || 'Tax'} collected`, money(sum(live, (t) => t.taxAmount))],
    [],
    [{ v: 'Payment methods', s: STYLE.BOLD }],
  ];

  for (const method of PAYMENT_METHODS) {
    const forMethod = live.filter((txn) => txn.paymentMethod === method.id);
    rows.push([method.label, money(sum(forMethod, (t) => t.grandTotal)), { v: forMethod.length, s: STYLE.INTEGER }]);
  }

  // ---- top sellers -------------------------------------------------------
  const tally = new Map();
  for (const txn of live) {
    for (const item of txn.items) {
      const entry = tally.get(item.name) || { name: item.name, category: item.category, qty: 0, value: 0 };
      entry.qty += item.quantity;
      entry.value += item.total;
      tally.set(item.name, entry);
    }
  }
  const top = [...tally.values()].sort((a, b) => b.qty - a.qty || b.value - a.value).slice(0, 15);

  rows.push([], [{ v: 'Top selling items', s: STYLE.BOLD }]);
  rows.push(
    ['Item', 'Category', 'Quantity', 'Value'].map((label) => ({ v: label, s: STYLE.HEADER }))
  );
  for (const entry of top) {
    rows.push([entry.name, entry.category, { v: entry.qty, s: STYLE.INTEGER }, money(entry.value)]);
  }

  rows.push(
    [],
    [{ v: 'Cashier split', s: STYLE.BOLD }],
    ['Cashier', 'Orders', 'Value'].map((label) => ({ v: label, s: STYLE.HEADER }))
  );
  const cashiers = [...new Set(live.map((txn) => txn.cashierName || txn.cashier))];
  for (const cashier of cashiers) {
    const forCashier = live.filter((txn) => (txn.cashierName || txn.cashier) === cashier);
    rows.push([cashier, { v: forCashier.length, s: STYLE.INTEGER }, money(sum(forCashier, (t) => t.grandTotal))]);
  }

  rows.push(
    [],
    [{ v: 'Generated', s: STYLE.BOLD }, new Date().toLocaleString('en-IN')],
    ['Note', { v: 'Order totals appear once per order, on its first item row.', s: STYLE.WRAP }]
  );

  return rows;
}

function buildWorkbook(transactions, meta) {
  return createWorkbook([
    {
      name: 'Transactions',
      rows: transactionRows(transactions),
      columns: COLUMNS.map(([, width]) => width),
      freezeRow: 1,
      autoFilterRow: 1,
    },
    {
      name: 'Daily Summary',
      rows: summaryRows(transactions, meta),
      columns: [30, 18, 14, 14],
    },
  ]);
}

/* -------------------------------------------------------------- public --- */

/** Cafe_Billing_Day_01.xlsx for one business date. */
export async function exportBusinessDay(dateKey) {
  requireAdmin('exporting billing data');

  const transactions = await transactionsRepo.listByBusinessDate(dateKey);
  if (!transactions.length) {
    throw new AppError(`No sales are recorded for ${formatDateKeyLong(dateKey)}.`, 'NO_DATA');
  }

  const day = await daysRepo.getDay(dateKey);
  const dayNumber = day?.dayNumber ?? transactions[0].dayNumber ?? 1;

  const blob = buildWorkbook(transactions, {
    title: `${daysRepo.dayLabel(dayNumber)} — ${formatDateKeyLong(dateKey)}`,
    subtitle: `Business day ${dayNumber} · ${transactions.length} bill${
      transactions.length === 1 ? '' : 's'
    }`,
  });

  const filename = `Cafe_Billing_Day_${pad(dayNumber, 2)}.xlsx`;
  downloadBlob(blob, filename);
  await daysRepo.markExported(dateKey);
  return { filename, count: transactions.length };
}

/** One workbook covering an inclusive date range. */
export async function exportDateRange(fromKey, toKey) {
  requireAdmin('exporting billing data');
  if (fromKey > toKey) throw new AppError('The start date is after the end date.', 'VALIDATION');

  const all = await transactionsRepo.listAll();
  const transactions = all.filter((txn) => txn.businessDate >= fromKey && txn.businessDate <= toKey);
  if (!transactions.length) throw new AppError('No sales fall in that date range.', 'NO_DATA');

  const blob = buildWorkbook(transactions, {
    title: `${formatDateKeyLong(fromKey)} to ${formatDateKeyLong(toKey)}`,
    subtitle: `${transactions.length} bills across ${
      new Set(transactions.map((t) => t.businessDate)).size
    } trading days`,
  });

  const filename = `Cafe_Billing_${fromKey}_to_${toKey}.xlsx`;
  downloadBlob(blob, filename);
  return { filename, count: transactions.length };
}

/** Every sale ever recorded on this device. */
export async function exportEverything() {
  requireAdmin('exporting billing data');
  const transactions = await transactionsRepo.listAll();
  if (!transactions.length) throw new AppError('There are no sales to export yet.', 'NO_DATA');

  const dates = transactions.map((t) => t.businessDate).sort();
  const blob = buildWorkbook(transactions, {
    title: 'All recorded sales',
    subtitle: `${formatDateKeyLong(dates[0])} to ${formatDateKeyLong(dates[dates.length - 1])}`,
  });
  const filename = `Cafe_Billing_All_${dates[dates.length - 1]}.xlsx`;
  downloadBlob(blob, filename);
  return { filename, count: transactions.length };
}

/** The current menu as a spreadsheet — handy for printing or price reviews. */
export async function exportMenu() {
  requireAdmin('exporting the menu');
  const items = getMenu();
  if (!items.length) throw new AppError('The menu is empty.', 'NO_DATA');

  const header = ['Item Name', 'Category', 'Price', 'Available', 'Tax Rate %', 'Description'];
  const rows = [header.map((label) => ({ v: label, s: STYLE.HEADER }))];
  for (const item of items) {
    rows.push([
      item.name,
      item.category,
      money(item.price),
      item.available ? 'Yes' : 'No',
      item.taxRate === null || item.taxRate === undefined
        ? 'Default'
        : { v: item.taxRate / 100, s: STYLE.DEFAULT },
      { v: item.description || '', s: STYLE.WRAP },
    ]);
  }

  const blob = createWorkbook([
    { name: 'Menu', rows, columns: [32, 20, 12, 11, 12, 60], freezeRow: 1, autoFilterRow: 1 },
  ]);
  const filename = `Cafe_Menu_${new Date().toISOString().slice(0, 10)}.xlsx`;
  downloadBlob(blob, filename);
  return { filename, count: items.length };
}

export { fromDateKey };
