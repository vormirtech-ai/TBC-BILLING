/** Cafe settings — one record, cached in memory for fast reads during billing. */

import { DEFAULT_SETTINGS } from '../config/app.config.js';
import { STORES, getByKey, put } from '../db/database.js';
import { requireAdmin } from '../core/session.js';

const KEY = 'app';
let cache = null;
const listeners = new Set();

export async function loadSettings() {
  const stored = await getByKey(STORES.SETTINGS, KEY);
  cache = { ...DEFAULT_SETTINGS, ...(stored || {}), key: KEY };
  return cache;
}

/** Synchronous read of the cached settings — safe after app boot. */
export function getSettings() {
  return cache || { ...DEFAULT_SETTINGS, key: KEY };
}

export async function saveSettings(patch) {
  requireAdmin('changing settings');
  const next = { ...getSettings(), ...patch, key: KEY, updatedAt: new Date().toISOString() };
  await put(STORES.SETTINGS, next);
  cache = next;
  listeners.forEach((fn) => fn(next));
  return next;
}

/** Used by restore/seed paths that legitimately replace the whole record. */
export async function replaceSettings(record) {
  const next = { ...DEFAULT_SETTINGS, ...record, key: KEY };
  await put(STORES.SETTINGS, next);
  cache = next;
  listeners.forEach((fn) => fn(next));
  return next;
}

export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function currencySymbol() {
  return getSettings().currencySymbol || '₹';
}
