#!/usr/bin/env node
/**
 * Put a backup back.
 *
 *   sudo systemctl stop saba
 *   sudo -u saba node tools/restore.mjs /var/lib/saba/backups/saba-2026-10-09-....db
 *   sudo systemctl start saba
 *
 * Deliberately not an API endpoint. Restoring replaces every bill the
 * restaurant has ever taken, and that is not a thing anybody should be able
 * to do by tapping a screen during service — not even a manager, not even by
 * accident. It is a command run on the till itself, with the service stopped,
 * by somebody who meant it.
 *
 * The database being replaced is never deleted: it is kept beside the live
 * one as saba.replaced-<timestamp>.db, so a restore of the wrong file is
 * itself undoable.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';

import { config } from '../server/config.js';
import { openDatabase, restoreFrom, one } from '../server/db/index.js';

const source = process.argv[2];

if (!source) {
  process.stderr.write(
    '\n  Which backup?\n\n'
    + `      node tools/restore.mjs ${config.dataDir}/backups/<file>.db\n\n`
    + '  Stop the server first, and start it again afterwards.\n\n'
  );
  process.exit(2);
}

const path = resolve(source);
if (!existsSync(path)) {
  process.stderr.write(`\n  There is no file at ${path}\n\n`);
  process.exit(2);
}

openDatabase();

const live = one('SELECT count(*) AS n FROM orders')?.n ?? 0;

process.stdout.write(
  '\n  ────────────────────────────────────────────────────────────\n'
  + `   Restoring   ${path}\n`
  + `   Over        ${config.dataDir}/saba.db  (${live} orders in it now)\n`
  + '\n'
  + '   Everything the restaurant has recorded since that backup was\n'
  + '   taken will be gone from the live database. The file being\n'
  + '   replaced is kept beside it, so this can be undone.\n'
  + '  ────────────────────────────────────────────────────────────\n\n'
);

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = (await rl.question('  Type RESTORE to go ahead: ')).trim();
rl.close();

if (answer !== 'RESTORE') {
  process.stdout.write('\n  Nothing was changed.\n\n');
  process.exit(1);
}

// A restore is run by somebody whose restaurant is already not working.
// Whatever goes wrong, they get a sentence, not a stack trace.
let result;
try {
  result = restoreFrom(path);
} catch (error) {
  process.stderr.write(
    `\n  That did not work: ${error.message}\n\n`
    + '  Nothing has been changed. The live database is as it was.\n'
    + '  Check you picked a file from the backups directory, then try again\n'
    + '  — or send us this message.\n\n'
  );
  process.exit(1);
}

const now = one('SELECT count(*) AS n FROM orders')?.n ?? 0;

process.stdout.write(
  `\n  Restored ${result.restored} — ${now} orders.\n`
  + `  The database it replaced is at ${result.previous}\n\n`
  + '  Start the server again:  sudo systemctl start saba\n\n'
);
process.exit(0);
