/**
 * Test entry point.
 *
 *   node tests/all.mjs
 *
 * No framework, no dependencies, no build step — the same constraints the
 * application itself runs under.
 */

import { run } from './run.mjs';

await run([
  './pricing.test.mjs',
  './orders.test.mjs',
  './reports.test.mjs',
]);
