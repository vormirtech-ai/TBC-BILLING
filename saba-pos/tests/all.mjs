/**
 * Test entry point.
 *
 *   node tests/all.mjs            everything
 *   node tests/all.mjs unit       the domain only, no server
 *   node tests/all.mjs api        the API only
 *   node tests/all.mjs till       the published demonstration only
 *   node tests/all.mjs sync       the cloud copy only
 *
 * No framework, no dependencies, no build step — the same constraints the
 * application itself runs under.
 */

import { run } from './run.mjs';

const only = process.argv[2];

const UNIT = [
  './unit/pricing.test.mjs',
  './unit/orders.test.mjs',
];

const API = [
  './api/server.test.mjs',
];

/** The published demonstration, held against the product it demonstrates. */
const TILL = [
  './till/parity.test.mjs',
];

/** The cloud copy, against a stand-in for Supabase. */
const SYNC = [
  './sync/sync.test.mjs',
];

const files = only === 'unit' ? UNIT
  : only === 'api' ? API
    : only === 'till' ? TILL
      : only === 'sync' ? SYNC
        : [...UNIT, ...API, ...TILL, ...SYNC];

await run(files);
