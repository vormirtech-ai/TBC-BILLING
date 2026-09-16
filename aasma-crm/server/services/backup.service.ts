import fs from 'node:fs';
import path from 'node:path';
import { PATHS, ensureDirectories } from '../lib/paths';
import { prisma } from '../lib/prisma';
import { HttpError, badRequest, notFound } from '../lib/errors';
import type { BackupFile } from '../../shared/types';

const PREFIX = 'CRM_Backup_';

/**
 * Backups are a straight file copy of the SQLite database. `VACUUM INTO` is used
 * so the copy is a consistent, compacted snapshot even while the app is running
 * and the write-ahead log has uncommitted pages.
 */
export async function createBackup(): Promise<BackupFile> {
  ensureDirectories();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = `${PREFIX}${stamp}.db`;
  const target = path.join(PATHS.backupsDir, fileName);

  // VACUUM INTO refuses to overwrite, which is exactly the behaviour we want.
  await prisma.$executeRawUnsafe(`VACUUM INTO '${target.split(path.sep).join('/').replace(/'/g, "''")}'`);

  const stats = fs.statSync(target);
  return { name: fileName, size: stats.size, createdAt: stats.birthtime.toISOString() };
}

export function listBackups(): BackupFile[] {
  ensureDirectories();
  return fs
    .readdirSync(PATHS.backupsDir)
    .filter((name) => name.endsWith('.db'))
    .map((name) => {
      const stats = fs.statSync(path.join(PATHS.backupsDir, name));
      return { name, size: stats.size, createdAt: stats.birthtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function resolveBackup(name: string): string {
  // Never let a caller escape the backups folder.
  const safe = path.basename(name);
  if (!safe.endsWith('.db')) throw badRequest('That is not a backup file.');
  const target = path.join(PATHS.backupsDir, safe);
  if (!fs.existsSync(target)) throw notFound('Backup');
  return target;
}

export function backupPath(name: string): string {
  return resolveBackup(name);
}

/**
 * Restores a backup over the live database. The current database is copied to a
 * "pre-restore" backup first, so a mistaken restore is itself recoverable. The
 * caller is expected to restart the app afterwards.
 */
export async function restoreBackup(name: string): Promise<{ restoredFrom: string; safetyCopy: string }> {
  const source = resolveBackup(name);
  const stats = fs.statSync(source);
  if (stats.size < 1024) throw new HttpError(422, 'That backup file looks empty or corrupted.');

  const safetyName = `${PREFIX}pre-restore-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.db`;
  const safetyTarget = path.join(PATHS.backupsDir, safetyName);
  await prisma.$executeRawUnsafe(`VACUUM INTO '${safetyTarget.split(path.sep).join('/').replace(/'/g, "''")}'`);

  await prisma.$disconnect();

  // Remove the WAL/shm side files, otherwise SQLite would replay them on top of
  // the freshly restored database.
  for (const suffix of ['-wal', '-shm']) {
    const sideFile = `${PATHS.databaseFile}${suffix}`;
    if (fs.existsSync(sideFile)) fs.rmSync(sideFile);
  }
  fs.copyFileSync(source, PATHS.databaseFile);

  return { restoredFrom: path.basename(source), safetyCopy: safetyName };
}

export function deleteBackup(name: string): void {
  fs.rmSync(resolveBackup(name));
}

export function importBackupFile(tempPath: string, originalName: string): BackupFile {
  ensureDirectories();
  const safe = `${PREFIX}imported-${Date.now()}-${path.basename(originalName).replace(/[^A-Za-z0-9._-]/g, '_')}`;
  const target = path.join(PATHS.backupsDir, safe.endsWith('.db') ? safe : `${safe}.db`);
  fs.copyFileSync(tempPath, target);
  fs.rmSync(tempPath, { force: true });
  const stats = fs.statSync(target);
  return { name: path.basename(target), size: stats.size, createdAt: stats.birthtime.toISOString() };
}
