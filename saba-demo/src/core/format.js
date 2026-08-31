/** Dates, durations and ids. Everything here is pure and locale-safe. */

export const pad = (v, n = 2) => String(v).padStart(n, '0');

export const uid = (prefix = 'id') =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/* ---------------------------------------------------------------- dates --- */

/** Local calendar day as YYYY-MM-DD. Never use toISOString here: it is UTC. */
export function dayKey(date = new Date()) {
  const d = new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function clockTime(ts) {
  const d = new Date(ts);
  const hours = d.getHours();
  const suffix = hours >= 12 ? 'pm' : 'am';
  // The hour is deliberately not zero-padded: "9:05 pm" is how a person reads
  // a clock, and "09:05 pm" looks like a mistake next to a 24-hour field.
  return `${((hours + 11) % 12) + 1}:${pad(d.getMinutes())} ${suffix}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function longDate(ts) {
  const d = new Date(ts);
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function shortDate(ts) {
  const d = new Date(ts);
  return `${pad(d.getDate())} ${MONTHS[d.getMonth()]}`;
}

export const stamp = (ts) => `${shortDate(ts)} · ${clockTime(ts)}`;

/* ------------------------------------------------------------ durations --- */

/** Whole minutes between two instants, floored — a 59-second wait is 0m. */
export const minutesSince = (from, now = Date.now()) =>
  Math.max(0, Math.floor((now - from) / 60000));

/** 0 -> "just now", 7 -> "7m", 95 -> "1h 35m". */
export function elapsed(from, now = Date.now()) {
  const mins = minutesSince(from, now);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${pad(mins % 60)}m`;
}

/** Ticking mm:ss for kitchen dockets, where seconds genuinely matter. */
export function timer(from, now = Date.now()) {
  const secs = Math.max(0, Math.floor((now - from) / 1000));
  return `${pad(Math.floor(secs / 60))}:${pad(secs % 60)}`;
}

/* -------------------------------------------------------------- strings --- */

export const initials = (name) =>
  String(name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();

/**
 * plural(3, 'cover') -> "3 covers".  English being what it is, an irregular
 * plural has to be given: plural(3, 'dish', 'dishes').
 */
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Sequence number -> "SAB-0148". */
export const serial = (prefix, n, width = 4) => `${prefix}-${pad(n, width)}`;

/** Case- and space-insensitive contains, for the menu search box. */
export function matches(haystack, needle) {
  if (!needle) return true;
  const n = needle.trim().toLowerCase();
  return String(haystack || '').toLowerCase().includes(n);
}
