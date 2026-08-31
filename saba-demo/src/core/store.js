/**
 * The whole application state, one object, one place.
 *
 * Views never mutate it directly. They call `update()` with a function that
 * changes the draft; the store then persists and notifies every subscriber, so
 * a table freed on the floor plan and the same table on the kitchen display can
 * never disagree about what is happening.
 *
 * Persistence is best-effort on purpose. This build must survive being opened
 * straight from a folder, from a USB stick, or in a private window — all of
 * which can refuse local storage. When that happens the app runs perfectly well
 * from memory for the length of the session and simply says so.
 */

import { APP } from '../config.js';

let state = null;
let persistent = true;
const listeners = new Set();
let flushTimer = null;

/* ------------------------------------------------------------- storage --- */

function readStored() {
  try {
    const raw = window.localStorage.getItem(APP.storageKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    persistent = false;
    return null;
  }
}

function writeStored(value) {
  if (!persistent) return;
  try {
    window.localStorage.setItem(APP.storageKey, JSON.stringify(value));
  } catch {
    // Quota, private mode, or an opaque file:// origin. Carry on in memory.
    persistent = false;
    notify();
  }
}

/** False when the browser refused local storage; the shell shows a note. */
export const isPersistent = () => persistent;

/* --------------------------------------------------------------- store --- */

/**
 * @param {() => object} makeInitial  builds a fresh state, used on first run
 *                                    and whenever the demo is reset
 */
export function initStore(makeInitial) {
  const stored = readStored();
  // A stored state from an older build would break views that expect newer
  // fields, so the schema version gates reuse rather than a migration path:
  // this is a demo, and a clean reseed is the honest answer.
  state = stored && stored.schema === APP.storageKey ? stored : makeInitial();
  if (state.schema !== APP.storageKey) state.schema = APP.storageKey;
  writeStored(state);
  return state;
}

export const getState = () => state;

/**
 * Apply a change. `mutator` receives the live state and may edit it in place or
 * return a replacement. Subscribers run once, after the write.
 */
export function update(mutator) {
  const next = mutator(state);
  if (next && next !== state) state = next;
  schedulePersist();
  notify();
  return state;
}

/** Same as update() but for changes that must not touch the disk (ticks). */
export function touch() {
  notify();
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  for (const listener of [...listeners]) {
    try { listener(state); } catch (error) { console.error('[store]', error); }
  }
}

/**
 * Writing on every keystroke of a guest name would serialise the whole state
 * dozens of times a second, so writes are coalesced into the next idle moment.
 */
function schedulePersist() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    writeStored(state);
  }, 180);
}

/** Force a write now — used before print, reset and page unload. */
export function flush() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  writeStored(state);
}

export function resetStore(makeInitial) {
  state = makeInitial();
  state.schema = APP.storageKey;
  flush();
  notify();
  return state;
}

/* ----------------------------------------------------------- audit log --- */

/**
 * Anything a manager might later be asked to explain — a void, a discount, a
 * comped course, a reopened bill — is appended here with who did it. The log is
 * capped so a long demo session cannot grow the saved state without bound.
 */
export function logActivity(kind, message, meta = {}) {
  update((s) => {
    s.activity.unshift({
      id: `a_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      at: Date.now(),
      kind,
      message,
      by: s.session?.name || 'System',
      ...meta,
    });
    if (s.activity.length > 400) s.activity.length = 400;
  });
}
