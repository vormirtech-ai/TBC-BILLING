/** Cafe settings — one record, cached in memory for fast reads during billing. */

import { DEFAULT_SETTINGS } from '../config/app.config.js';
import { STORES, getByKey, put, putFromRemote } from '../db/database.js';
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

/**
 * Save settings without asking who is signed in.
 *
 * Exists for exactly one situation: pairing a device to the cafe database. That
 * happens BEFORE anybody can sign in — the accounts live in the database this
 * is about to connect to — so requiring an admin would be a locked door with
 * the key on the other side. It is not a general-purpose back door: every other
 * settings write goes through saveSettings and its admin check.
 */
export async function saveSettingsUnguarded(patch) {
  const next = { ...getSettings(), ...patch, key: KEY, updatedAt: new Date().toISOString() };
  await put(STORES.SETTINGS, next);
  cache = next;
  listeners.forEach((fn) => fn(next));
  return next;
}

/**
 * Save settings that belong to this device and must NOT travel.
 *
 * A customer's phone picks up the cafe's connection details from the table code
 * it scanned. Writing those the usual way would queue the phone's own settings
 * — cafe name, tax rules, everything — to be pushed over the cafe's real ones.
 * This write deliberately skips that queue.
 */
export async function applyDeviceSettings(patch) {
  const next = { ...getSettings(), ...patch, key: KEY, updatedAt: new Date().toISOString() };
  await putFromRemote(STORES.SETTINGS, next);
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
