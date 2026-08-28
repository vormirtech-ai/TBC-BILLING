import os from 'node:os';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { asyncHandler, badRequest } from '../lib/errors';
import { requireRole, type AuthedRequest } from '../lib/auth';
import { logActivity } from '../lib/activity';
import { PATHS } from '../lib/paths';
import {
  backupPath,
  createBackup,
  deleteBackup,
  importBackupFile,
  listBackups,
  restoreBackup,
} from '../services/backup.service';

export const backupRouter = Router();

const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 512 * 1024 * 1024 } });

backupRouter.get(
  '/',
  asyncHandler<AuthedRequest>(async (_req, res) => {
    res.json({ folder: PATHS.backupsDir, files: listBackups() });
  }),
);

backupRouter.post(
  '/',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const file = await createBackup();
    await logActivity({ actor: req.user?.username ?? 'system', action: 'BACKUP', entity: 'Database', detail: file.name });
    res.status(201).json(file);
  }),
);

backupRouter.get(
  '/:name/download',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const file = backupPath(String(req.params.name));
    res.download(file, path.basename(file));
  }),
);

backupRouter.post(
  '/upload',
  requireRole('ADMIN'),
  upload.single('backup'),
  asyncHandler<AuthedRequest>(async (req, res) => {
    if (!req.file) throw badRequest('Choose a .db backup file to upload.');
    const file = importBackupFile(req.file.path, req.file.originalname);
    res.status(201).json(file);
  }),
);

/**
 * Restoring swaps the live database file. The client is told to restart, which
 * Electron does for it — a running Prisma client would otherwise still be
 * holding the old file handle.
 */
backupRouter.post(
  '/:name/restore',
  requireRole('ADMIN'),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const result = await restoreBackup(String(req.params.name));
    await logActivity({
      actor: req.user?.username ?? 'system',
      action: 'RESTORE',
      entity: 'Database',
      detail: result.restoredFrom,
    });
    res.json({ ...result, restartRequired: true });
  }),
);

backupRouter.delete(
  '/:name',
  requireRole('ADMIN'),
  asyncHandler<AuthedRequest>(async (req, res) => {
    deleteBackup(String(req.params.name));
    res.json({ ok: true });
  }),
);
