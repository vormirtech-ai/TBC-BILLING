/**
 * Backup and restore.
 *
 * This is the only way data moves between devices, so it is deliberately
 * conservative: a restore validates the file first, takes a safety copy of what
 * is currently on the device, and only then replaces anything.
 */

import { APP } from '../config/app.config.js';
import { AppError, downloadBlob, readFileAsText, toDateKey } from '../core/utils.js';
import { requireAdmin } from '../core/session.js';
import { STORES, getAll } from '../db/database.js';
import * as menuRepo from '../repositories/menu.repo.js';
import * as transactionsRepo from '../repositories/transactions.repo.js';
import * as daysRepo from '../repositories/businessDays.repo.js';
import * as usersRepo from '../repositories/users.repo.js';
import * as inventoryRepo from '../repositories/inventory.repo.js';
import * as staffRepo from '../repositories/staff.repo.js';
import * as tablesRepo from '../repositories/tables.repo.js';
import * as ordersRepo from '../repositories/onlineOrders.repo.js';
import * as customersRepo from '../repositories/customers.repo.js';
import { getSettings, replaceSettings, loadSettings } from '../repositories/settings.repo.js';

const FORMAT = 'tbc-pos-backup';
/**
 * 2 added stock, staff, tables and QR orders; 3 added the customer book.
 * Version 1 and 2 files still restore — their missing sections simply come back
 * empty, which is exactly what a till that never had stock should get.
 */
const FORMAT_VERSION = 3;

export async function buildBackup() {
  const [
    menu,
    transactions,
    businessDays,
    users,
    counters,
    inventory,
    stockMovements,
    recipes,
    staff,
    shifts,
    attendance,
    tables,
    onlineOrders,
    customers,
  ] = await Promise.all([
    getAll(STORES.MENU),
    getAll(STORES.TRANSACTIONS),
    getAll(STORES.BUSINESS_DAYS),
    usersRepo.exportUsers(),
    getAll(STORES.COUNTERS),
    getAll(STORES.INVENTORY),
    getAll(STORES.STOCK_MOVEMENTS),
    getAll(STORES.RECIPES),
    getAll(STORES.STAFF),
    getAll(STORES.SHIFTS),
    getAll(STORES.ATTENDANCE),
    getAll(STORES.TABLES),
    getAll(STORES.ONLINE_ORDERS),
    getAll(STORES.CUSTOMERS),
  ]);

  return {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    appVersion: APP.version,
    exportedAt: new Date().toISOString(),
    counts: {
      menu: menu.length,
      transactions: transactions.length,
      businessDays: businessDays.length,
      users: users.length,
      inventory: inventory.length,
      staff: staff.length,
      tables: tables.length,
      customers: customers.length,
    },
    data: {
      settings: getSettings(),
      menu,
      transactions,
      businessDays,
      users,
      counters,
      inventory,
      stockMovements,
      recipes,
      staff,
      shifts,
      attendance,
      tables,
      onlineOrders,
      customers,
    },
  };
}

export async function exportBackup() {
  requireAdmin('exporting a backup');
  const backup = await buildBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const filename = `Cafe_POS_Backup_${toDateKey()}.json`;
  downloadBlob(blob, filename);
  return { filename, counts: backup.counts };
}

/** Parse and sanity-check a backup file without touching stored data. */
export async function inspectBackup(file) {
  let parsed;
  try {
    parsed = JSON.parse(await readFileAsText(file));
  } catch {
    throw new AppError('That file is not readable JSON.', 'BAD_BACKUP');
  }

  if (parsed?.format !== FORMAT) {
    throw new AppError('That file was not created by this app.', 'BAD_BACKUP');
  }
  if (Number(parsed.formatVersion) > FORMAT_VERSION) {
    throw new AppError(
      'That backup came from a newer version of the app. Update this device first.',
      'BAD_BACKUP'
    );
  }

  const data = parsed.data || {};
  const required = ['menu', 'transactions', 'businessDays'];
  for (const key of required) {
    if (!Array.isArray(data[key])) {
      throw new AppError(`The backup is missing its ${key} section.`, 'BAD_BACKUP');
    }
  }

  const badTransaction = data.transactions.find(
    (row) => !row?.id || !row?.orderNo || !Array.isArray(row.items) || !Number.isFinite(row.grandTotal)
  );
  if (badTransaction) {
    throw new AppError('The backup contains a damaged sale record and was not restored.', 'BAD_BACKUP');
  }

  const dates = data.transactions.map((row) => row.businessDate).filter(Boolean).sort();

  return {
    exportedAt: parsed.exportedAt,
    appVersion: parsed.appVersion,
    counts: {
      menu: data.menu.length,
      transactions: data.transactions.length,
      businessDays: data.businessDays.length,
      users: (data.users || []).length,
      inventory: (data.inventory || []).length,
      staff: (data.staff || []).length,
      tables: (data.tables || []).length,
      customers: (data.customers || []).length,
    },
    range: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
    data,
  };
}

/**
 * Replace everything on this device with the backup's contents.
 * Returns the safety snapshot taken beforehand so the UI can offer it back.
 */
export async function restoreBackup(inspected) {
  requireAdmin('restoring a backup');
  if (!inspected?.data) throw new AppError('Check the backup file before restoring.', 'BAD_BACKUP');

  // Safety copy first — if the restore goes wrong, the operator still has today.
  const safety = await buildBackup();
  const safetyBlob = new Blob([JSON.stringify(safety, null, 2)], { type: 'application/json' });
  const safetyName = `Cafe_POS_Before_Restore_${toDateKey()}.json`;
  downloadBlob(safetyBlob, safetyName);

  const {
    settings,
    menu,
    transactions,
    businessDays,
    users,
    counters,
    inventory,
    stockMovements,
    recipes,
    staff,
    shifts,
    attendance,
    tables,
    onlineOrders,
    customers,
  } = inspected.data;

  if (settings) await replaceSettings(settings);
  await menuRepo.replaceAll(menu);
  await transactionsRepo.replaceAll(
    transactions,
    Number(counters?.find((row) => row.key === 'orderNo')?.value || 0)
  );
  await daysRepo.replaceAll(businessDays);
  if (Array.isArray(users) && users.length) await usersRepo.replaceAll(users);

  // Sections a version 1 backup simply does not have. Passing undefined clears
  // the store, which is the right result: restoring an older file should not
  // leave today's stock sitting behind it.
  await inventoryRepo.replaceAll(inventory, stockMovements, recipes);
  await staffRepo.replaceAll(staff, shifts, attendance);
  await tablesRepo.replaceAll(tables);
  await ordersRepo.replaceAll(onlineOrders);
  await customersRepo.replaceAll(customers);

  await loadSettings();
  await menuRepo.loadMenu();

  return { safetyName, counts: inspected.counts };
}
