/**
 * Completed sales.
 *
 * The important function here is `commitTransaction`. Order numbering, the sale
 * record and the day's running totals are written inside ONE IndexedDB
 * transaction, and the promise only resolves once that transaction commits. So
 * either an order gets a unique number and is durably saved, or nothing at all
 * happened — a refresh mid-save can never leave a half-written bill or burn an
 * order number.
 */

import {
  STORES,
  runTransaction,
  promisify,
  getAll,
  getAllByIndex,
  getByKey,
  clearStore,
  putMany,
} from '../db/database.js';
import { requireAdmin, requireSignedIn } from '../core/session.js';
import { AppError, uid, pad, matchesQuery } from '../core/utils.js';
import { deviceTag } from '../core/device.js';
import { enqueueForSync } from '../db/database.js';
import { applySaleToStock } from './inventory.repo.js';

const COUNTER_KEY = 'orderNo';

/* --------------------------------------------------------------- reads --- */

export function listByBusinessDate(dateKey) {
  return getAllByIndex(STORES.TRANSACTIONS, 'businessDate', dateKey).then((rows) =>
    rows.sort((a, b) => b.seq - a.seq)
  );
}

export function listAll() {
  return getAll(STORES.TRANSACTIONS).then((rows) => rows.sort((a, b) => b.seq - a.seq));
}

export function getTransaction(id) {
  return getByKey(STORES.TRANSACTIONS, id);
}

export async function getByOrderNo(orderNo) {
  const rows = await getAllByIndex(STORES.TRANSACTIONS, 'orderNo', orderNo);
  return rows[0] || null;
}

export async function countAll() {
  const rows = await getAll(STORES.TRANSACTIONS);
  return rows.length;
}

/** Client-side filtering. Fast enough for years of a single cafe's sales. */
export function filterTransactions(rows, filters = {}) {
  const { query = '', from = '', to = '', cashier = 'All', paymentMethod = 'All', status = 'All' } =
    filters;

  return rows.filter((row) => {
    if (from && row.businessDate < from) return false;
    if (to && row.businessDate > to) return false;
    if (cashier !== 'All' && row.cashier !== cashier) return false;
    if (paymentMethod !== 'All' && row.paymentMethod !== paymentMethod) return false;
    if (status !== 'All' && (row.status || 'COMPLETED') !== status) return false;
    if (!query) return true;

    return (
      matchesQuery(row.orderNo, query) ||
      matchesQuery(row.id, query) ||
      matchesQuery(row.cashier, query) ||
      matchesQuery(row.customerName, query) ||
      row.items.some((item) => matchesQuery(item.name, query))
    );
  });
}

/* -------------------------------------------------------------- commit --- */

function formatOrderNo(seq, prefix = 'ORD-', padding = 6) {
  return `${prefix}${pad(seq, padding)}`;
}

/**
 * A bill number for a till that could not reach the shared database.
 *
 * The device's own tag goes on the end. Two tills billing through a network
 * outage would otherwise both reach for the same number, and a duplicate bill
 * number is the kind of thing an accountant finds three months later.
 */
function formatLocalOrderNo(seq, prefix, padding) {
  return `${formatOrderNo(seq, prefix, padding)}-${deviceTag()}`;
}

/** Next unused business-day number, inside an open transaction. */
function nextDayNumber(daysStore, startNumber) {
  return new Promise((resolve, reject) => {
    const request = daysStore.index('dayNumber').openCursor(null, 'prev');
    request.onsuccess = () => {
      const cursor = request.result;
      resolve(cursor ? Number(cursor.value.dayNumber) + 1 : Number(startNumber) || 1);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Persist a finished order.
 *
 * @param {object} draft  fully-priced order (see order.service.js)
 * @param {{orderPrefix:string, orderNumberPadding:number, businessDayStartNumber:number,
 *          trackStock?:boolean, allocateNumber?:() => Promise<number|null>}} options
 * @returns {Promise<object>} the saved transaction, with orderNo, dayNumber and
 *   any stock shortages the sale ran into
 */
export async function commitTransaction(draft, options) {
  const session = requireSignedIn();

  if (!draft.items?.length) {
    throw new AppError('Add at least one item before taking payment.', 'EMPTY_CART');
  }
  if (!Number.isInteger(draft.grandTotal) || draft.grandTotal < 0) {
    throw new AppError('The bill total is not valid. Clear the order and try again.', 'BAD_TOTAL');
  }

  // Ask the shared database for the bill number BEFORE opening storage: a
  // storage transaction closes the moment it waits on anything that is not
  // storage, and a network call is very much not storage.
  let allocated = null;
  if (typeof options.allocateNumber === 'function') {
    try {
      allocated = await options.allocateNumber();
    } catch (error) {
      console.error('[TBC POS] could not get a shared bill number', error);
    }
  }

  // Stock moves in the same transaction as the sale, so a bill can never be
  // saved while the ingredients it used stay on the shelf.
  const storeNames = [STORES.COUNTERS, STORES.TRANSACTIONS, STORES.BUSINESS_DAYS];
  if (options.trackStock) {
    storeNames.push(STORES.RECIPES, STORES.INVENTORY, STORES.STOCK_MOVEMENTS);
  }

  return runTransaction(
    storeNames,
    'readwrite',
    async (stores) => {
      const counters = stores[STORES.COUNTERS];
      const transactions = stores[STORES.TRANSACTIONS];
      const days = stores[STORES.BUSINESS_DAYS];

      // 1. Settle on the order number.
      const counter = (await promisify(counters.get(COUNTER_KEY))) || { key: COUNTER_KEY, value: 0 };
      const localSeq = Number(counter.value || 0) + 1;
      const shared = Number.isSafeInteger(allocated) && allocated > 0;
      const seq = shared ? allocated : localSeq;

      // Keep the local counter at or ahead of whatever was used, so falling
      // back offline later cannot reuse a number the cafe has already issued.
      counters.put({
        key: COUNTER_KEY,
        value: Math.max(Number(counter.value || 0), seq),
        updatedAt: new Date().toISOString(),
      });

      // 2. Find or open the business day.
      let day = await promisify(days.get(draft.businessDate));
      if (!day) {
        day = {
          date: draft.businessDate,
          dayNumber: await nextDayNumber(days, options.businessDayStartNumber),
          openedAt: draft.createdAt,
          transactionCount: 0,
          voidCount: 0,
          itemCount: 0,
          totalSales: 0,
          lastExportedAt: null,
          exportCount: 0,
        };
      }

      // 3. Write the sale.
      const record = {
        ...draft,
        id: draft.id || uid('txn'),
        seq,
        orderNo: shared
          ? formatOrderNo(seq, options.orderPrefix, options.orderNumberPadding)
          : options.sharedNumbering
          ? formatLocalOrderNo(seq, options.orderPrefix, options.orderNumberPadding)
          : formatOrderNo(seq, options.orderPrefix, options.orderNumberPadding),
        numberSource: shared ? 'SHARED' : 'DEVICE',
        dayNumber: day.dayNumber,
        cashier: draft.cashier || session.username,
        cashierRole: session.role,
        status: 'COMPLETED',
        savedAt: new Date().toISOString(),
      };
      transactions.add(record); // add() → fails loudly if the id somehow repeats

      // 4. Roll the day's counters forward.
      const itemCount = record.items.reduce((total, item) => total + item.quantity, 0);
      days.put({
        ...day,
        transactionCount: day.transactionCount + 1,
        itemCount: day.itemCount + itemCount,
        totalSales: day.totalSales + record.grandTotal,
        lastTransactionAt: record.createdAt,
      });

      // 5. Draw down the ingredients this sale used.
      let stock = { deducted: 0, shortages: [], touched: { inventory: [], movements: [] } };
      if (options.trackStock) stock = await applySaleToStock(stores, record, -1);

      // The shortages ride along for the counter to show; they are not part of
      // the stored bill.
      return { ...record, stockShortages: stock.shortages, stockTouched: stock.touched };
    }
  ).then(async (saved) => {
    // The sale is committed. Queue everything it wrote for the shared database.
    // This runs after the transaction rather than inside it because the queue
    // for the raw-store writes above cannot be added from within them; the
    // start-up sweep catches anything a crash lands between the two.
    await queueSaleForSync(saved);
    return saved;
  });
}

/** Queue a committed sale, its day, and the stock it moved. */
async function queueSaleForSync(record) {
  try {
    await enqueueForSync(STORES.TRANSACTIONS, record.id);
    await enqueueForSync(STORES.BUSINESS_DAYS, record.businessDate);
    for (const id of record.stockTouched?.inventory || []) {
      await enqueueForSync(STORES.INVENTORY, id);
    }
    for (const id of record.stockTouched?.movements || []) {
      await enqueueForSync(STORES.STOCK_MOVEMENTS, id);
    }
  } catch (error) {
    console.error('[TBC POS] the sale was saved but could not be queued for sharing', error);
  }
}

/**
 * Cancel a sale without erasing it. The record stays in history and in exports,
 * flagged VOID and excluded from totals, so the audit trail is unbroken.
 */
export async function voidTransaction(id, reason, { trackStock = false } = {}) {
  const session = requireAdmin('voiding a bill');
  const text = String(reason || '').trim();
  if (!text) throw new AppError('Give a reason for voiding this bill.', 'VALIDATION');

  const storeNames = [STORES.TRANSACTIONS, STORES.BUSINESS_DAYS];
  if (trackStock) storeNames.push(STORES.RECIPES, STORES.INVENTORY, STORES.STOCK_MOVEMENTS);

  return runTransaction(
    storeNames,
    'readwrite',
    async (stores) => {
      const transactions = stores[STORES.TRANSACTIONS];
      const days = stores[STORES.BUSINESS_DAYS];

      const record = await promisify(transactions.get(id));
      if (!record) throw new AppError('That bill no longer exists.', 'NOT_FOUND');
      if (record.status === 'VOID') throw new AppError('That bill is already voided.', 'ALREADY_VOID');

      const voided = {
        ...record,
        status: 'VOID',
        voidedAt: new Date().toISOString(),
        voidedBy: session.username,
        voidReason: text,
      };
      transactions.put(voided);

      const day = await promisify(days.get(record.businessDate));
      if (day) {
        const itemCount = record.items.reduce((total, item) => total + item.quantity, 0);
        days.put({
          ...day,
          transactionCount: Math.max(0, day.transactionCount - 1),
          voidCount: (day.voidCount || 0) + 1,
          itemCount: Math.max(0, day.itemCount - itemCount),
          totalSales: Math.max(0, day.totalSales - record.grandTotal),
        });
      }

      // A voided bill was never sold, so its ingredients go back on the shelf.
      let stock = { touched: { inventory: [], movements: [] } };
      if (trackStock) stock = await applySaleToStock(stores, voided, 1);

      return { ...voided, stockTouched: stock.touched };
    }
  ).then(async (voided) => {
    await queueSaleForSync(voided);
    return voided;
  });
}

export async function currentCounter() {
  const counter = await getByKey(STORES.COUNTERS, COUNTER_KEY);
  return Number(counter?.value || 0);
}

/* ------------------------------------------------------- backup support --- */

export async function replaceAll(transactions, counterValue) {
  await clearStore(STORES.TRANSACTIONS);
  if (transactions.length) await putMany(STORES.TRANSACTIONS, transactions);

  const highest = transactions.reduce((max, row) => Math.max(max, Number(row.seq) || 0), 0);
  await runTransaction(STORES.COUNTERS, 'readwrite', (stores) => {
    stores[STORES.COUNTERS].put({
      key: COUNTER_KEY,
      // Never move the counter backwards: reusing an order number is worse than
      // a gap in the sequence.
      value: Math.max(Number(counterValue) || 0, highest),
      updatedAt: new Date().toISOString(),
    });
  });
}
