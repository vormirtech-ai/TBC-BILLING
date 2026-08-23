/**
 * Runs every test file and reports one verdict.
 *
 *   node tests/run.mjs
 *
 * Each file is a plain script that prints its own tally and exits non-zero on a
 * failure, so they can also be run one at a time while working on something.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort();

let failed = 0;
for (const file of files) {
  process.stdout.write(`\n── ${file} ${'─'.repeat(Math.max(0, 52 - file.length))}\n`);
  const result = spawnSync(process.execPath, [join(here, file)], { stdio: 'inherit' });
  if (result.status !== 0) failed++;
}

console.log(
  failed
    ? `\n${failed} of ${files.length} test file(s) FAILED`
    : `\nAll ${files.length} test files passed.`
);
process.exit(failed ? 1 : 0);
