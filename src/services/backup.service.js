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
import { getSettings, replaceSettings, loadSettings } from '../repositories/settings.repo.js';

const FORMAT = 'tbc-pos-backup';
const FORMAT_VERSION = 1;

export async function buildBackup() {
  const [menu, transactions, businessDays, users, counters] = await Promise.all([
    getAll(STORES.MENU),
    getAll(STORES.TRANSACTIONS),
    getAll(STORES.BUSINESS_DAYS),
    usersRepo.exportUsers(),
    getAll(STORES.COUNTERS),
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
    },
    data: { settings: getSettings(), menu, transactions, businessDays, users, counters },
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

  const { settings, menu, transactions, businessDays, users, counters } = inspected.data;

  if (settings) await replaceSettings(settings);
  await menuRepo.replaceAll(menu);
  await transactionsRepo.replaceAll(
    transactions,
    Number(counters?.find((row) => row.key === 'orderNo')?.value || 0)
  );
  await daysRepo.replaceAll(businessDays);
  if (Array.isArray(users) && users.length) await usersRepo.replaceAll(users);

  await loadSettings();
  await menuRepo.loadMenu();

  return { safetyName, counts: inspected.counts };
}
