#!/usr/bin/env node
/**
 * Take a backup and tidy the old ones.
 *
 *   node tools/backup.mjs
 *
 * Run from cron or the systemd timer the installer sets up. It writes a
 * complete, already-compacted copy of the database — safe to run while the
 * restaurant is trading, because SQLite's VACUUM INTO produces one consistent
 * file rather than three that were copied at slightly different moments.
 */

import { readdirSync, statSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { config } from '../server/config.js';
import { openDatabase, closeDatabase, backupTo } from '../server/db/index.js';
import { log } from '../server/log.js';
import { dayKey } from '../app/src/shared/format.js';

const dir = join(config.dataDir, 'backups');
mkdirSync(dir, { recursive: true });

openDatabase();
try {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const name = `saba-${dayKey()}-${stamp}.db`;
  backupTo(join(dir, name));
  log.info('backup written', { name });

  // Keep the most recent N and delete the rest, so a till with a small disk
  // does not quietly fill up over a year of nightly backups.
  const kept = readdirSync(dir)
    .filter((f) => f.startsWith('saba-') && f.endsWith('.db'))
    .map((f) => ({ f, at: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.at - a.at);

  for (const old of kept.slice(config.backupKeep)) {
    rmSync(join(dir, old.f));
    log.info('old backup removed', { name: old.f });
  }
  log.info('backups on disk', { count: Math.min(kept.length, config.backupKeep) });
} catch (error) {
  log.error('backup failed', { error: error.message });
  process.exitCode = 1;
} finally {
  closeDatabase();
}
