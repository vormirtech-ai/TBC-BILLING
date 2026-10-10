/**
 * What syncs, and which way.
 *
 * One table here, so the answer to "does this reach the cloud, and can the
 * cloud change it?" is a line you can read rather than a trail through the
 * code. Nothing syncs unless it is listed.
 *
 * The direction is the whole safety argument:
 *
 *   push   The till is the only writer. Bills, dockets, the audit trail and
 *          the day's shifts are facts about what happened in the restaurant;
 *          they can never conflict, because nothing else creates them.
 *
 *   both   Configuration. An owner may change a price or take somebody off
 *          the rota from the Supabase table editor, and the till picks it up.
 *          Last write wins on `updated_at`, and the till wins a tie — see
 *          sync/index.js.
 *
 * `sessions` and `pin_attempts` are deliberately absent: a session token is a
 * live credential and a failed-PIN log is a security record, and neither has
 * any business leaving the building.
 */

/**
 * Columns never sent, whatever else a row carries.
 *
 * A PIN's hash and salt stay on the till. Pulling them back would mean the
 * cloud could set somebody's PIN, which turns a compromised Supabase project
 * into a way into the restaurant's till. A manager can be renamed, demoted or
 * switched off from the cloud; their PIN can only be changed in the building.
 */
export const NEVER_SEND = new Set(['pin_hash', 'pin_salt']);

/**
 * Figures the cloud gets that the till does not store.
 *
 * A bill's totals are computed, never saved: `costOrder` is the one place
 * that adds a bill up, and storing its answer beside the lines would be a
 * second copy to drift. That is right on the till, where the function is
 * always at hand — and wrong in Postgres, where re-deriving tax in SQL would
 * mean a second implementation of the arithmetic that an auditor checks
 * first.
 *
 * So the sync runs the very same function on its way out and sends the
 * result. The cloud's tax column is the figure that was printed on the
 * guest's bill, by definition.
 */
import { costOrder } from '../../app/src/shared/pricing.js';

export const TABLES = [
  {
    name: 'orders',
    direction: 'push',
    key: 'id',
    /** The column a high-water mark is kept against. */
    cursor: 'updated_at',
    columns: ['id', 'number', 'code', 'business_day', 'table_id', 'status',
      'invoice_no', 'opened_at', 'closed_at', 'total_paise', 'covers', 'doc',
      'updated_at'],
    json: ['doc'],
    derive: (row, doc) => ({ totals: costOrder(doc) }),
  },
  {
    name: 'audit',
    direction: 'push',
    key: 'id',
    // Append-only and never updated, so its own id is the cursor: rows only
    // ever arrive with a higher one.
    cursor: 'id',
    columns: ['id', 'at', 'day', 'kind', 'actor', 'message', 'meta'],
    json: ['meta'],
  },
  {
    name: 'shifts',
    direction: 'push',
    key: 'id',
    cursor: 'updated_at',
    columns: ['id', 'day', 'opened_at', 'opened_by', 'closed_at', 'closed_by',
      'float_paise', 'counted_paise', 'doc', 'updated_at'],
    json: ['doc'],
  },
  {
    name: 'counters',
    direction: 'push',
    key: 'name',
    // No timestamp of its own, and two rows in total. Sent whole every time,
    // because a backup without the next invoice number is a backup a
    // restaurant cannot trade from.
    cursor: null,
    columns: ['name', 'value'],
  },
  {
    name: 'reservations',
    direction: 'push',
    key: 'id',
    cursor: 'updated_at',
    columns: ['id', 'at', 'day', 'status', 'doc', 'updated_at', 'deleted_at'],
    json: ['doc'],
  },
  {
    name: 'eighty_six',
    direction: 'push',
    key: 'item_id',
    // What is off tonight. Small, and rows disappear when a dish goes back
    // on, so it is mirrored whole rather than by watermark.
    cursor: null,
    mirror: true,
    columns: ['item_id', 'by_name', 'note', 'at'],
  },

  {
    name: 'menu_items',
    direction: 'both',
    key: 'id',
    cursor: 'updated_at',
    columns: ['id', 'category', 'station', 'sort', 'active', 'doc', 'updated_at'],
    json: ['doc'],
  },
  {
    name: 'settings',
    direction: 'both',
    key: 'key',
    cursor: 'updated_at',
    columns: ['key', 'value', 'updated_at'],
    json: ['value'],
  },
  {
    name: 'users',
    direction: 'both',
    key: 'id',
    cursor: 'updated_at',
    // No pin_hash, no pin_salt: see NEVER_SEND above.
    columns: ['id', 'name', 'initials', 'role', 'active', 'created_at', 'updated_at'],
  },
];

export const byName = (name) => TABLES.find((t) => t.name === name);
export const pushed = () => TABLES.filter((t) => t.direction === 'push' || t.direction === 'both');
export const pulled = () => TABLES.filter((t) => t.direction === 'both');

/* ----------------------------------------------------------- shapes --- */

/**
 * A local row, as the cloud should hold it.
 *
 * SQLite has no boolean and no JSON type, so an `active` column arrives as 0
 * or 1 and a document as a string. Postgres has both, and a column typed
 * `jsonb` is the difference between a report you can write in SQL and a
 * column of text nobody can query.
 */
export function toRemote(table, row) {
  const out = {};
  let doc = null;

  for (const column of table.columns) {
    if (NEVER_SEND.has(column)) continue;
    let value = row[column];
    if (table.json?.includes(column) && typeof value === 'string') {
      try { value = JSON.parse(value); } catch { /* store what we have */ }
      if (column === 'doc') doc = value;
    }
    if (column === 'active') value = !!value;
    out[column] = value === undefined ? null : wholeNumbers(value);
  }

  if (table.derive && doc) Object.assign(out, table.derive(row, doc));
  return out;
}

/**
 * JavaScript has one number type; Postgres has several.
 *
 * Every number Saba stores in a column is a whole one — milliseconds since
 * the epoch, paise, a count — and SQLite, being loosely typed, will quietly
 * keep a fractional one if some arithmetic produces it. Postgres will not:
 * it rejects the whole batch. Rounding at the boundary is the marshalling
 * this crossing needs, not a cover for bad data, and the seed that first
 * produced a fractional timestamp was fixed at its source.
 */
const wholeNumbers = (value) =>
  (typeof value === 'number' && Number.isFinite(value) && !Number.isInteger(value)
    ? Math.round(value)
    : value);

/** And back again, for the configuration the cloud is allowed to change. */
export function toLocal(table, row) {
  const out = {};
  for (const column of table.columns) {
    if (NEVER_SEND.has(column)) continue;
    let value = row[column];
    if (table.json?.includes(column) && value !== null && typeof value === 'object') {
      value = JSON.stringify(value);
    }
    if (column === 'active') value = value ? 1 : 0;
    out[column] = value === undefined ? null : value;
  }
  return out;
}
