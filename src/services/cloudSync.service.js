/**
 * The shared database.
 *
 * WHAT THIS IS
 * The cafe's real storage. Bills, the menu, stock, staff, tables and QR orders
 * all live here, so a manager signing in on a laptop at home sees the same
 * numbers as the till on the counter.
 *
 * The device keeps its own copy in the browser too. That is not a fallback that
 * gets in the way — it is what lets the till keep taking money when the wi-fi
 * drops, with everything catching up by itself once it returns. See
 * sync.service.js for how the two are kept in step.
 *
 * It speaks PostgREST, which is what a free Supabase project serves, and needs
 * one table and one small function. The SQL is in the README and inside the
 * app's own setup screen.
 *
 * Nothing in this file is allowed to break the counter. Every call fails soft
 * and returns a result rather than throwing, because a till that stops selling
 * coffee when a network hiccups is worse than a till that syncs a minute late.
 */

import { getSettings } from '../repositories/settings.repo.js';

const REQUEST_TIMEOUT_MS = 15000;

/** Rows fetched per page. Large enough that one page is normally the lot. */
export const PULL_PAGE_SIZE = 1000;

export function cloudConfig() {
  const settings = getSettings();
  const url = String(settings.cloudSyncUrl || '').trim().replace(/\/+$/, '');
  const key = String(settings.cloudSyncKey || '').trim();
  const table = String(settings.cloudSyncTable || 'tbc_sync').trim();

  return {
    enabled: Boolean(settings.cloudSyncEnabled && url && key && table),
    configured: Boolean(url && key),
    url,
    key,
    table,
    pollSeconds: Math.max(3, Number(settings.cloudSyncPollSeconds) || 8),
  };
}

export function isCloudEnabled() {
  return cloudConfig().enabled;
}

function endpoint(config, query = '') {
  return `${config.url}/rest/v1/${config.table}${query}`;
}

function headers(config, extra = {}) {
  return {
    apikey: config.key,
    Authorization: `Bearer ${config.key}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

/** Fetch with a timeout, so a dead network cannot wedge the counter. */
async function request(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const error = new Error(
        `${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 300)}` : ''}`
      );
      error.status = response.status;
      throw error;
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------- health --- */

/**
 * Check the settings actually work, and say plainly what is wrong if they do
 * not. Used by the setup screen, so the wording has to be worth reading.
 */
export async function testConnection(overrides = {}) {
  const config = { ...cloudConfig(), ...overrides };
  if (!config.url || !config.key) {
    return { ok: false, reason: 'INCOMPLETE', message: 'Enter both the project URL and the key first.' };
  }
  // https everywhere, with one exception: a database running on this machine,
  // which is how the app is developed and tested. Anything else on plain http
  // would put the cafe's key on the wire in the clear.
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(config.url);
  if (!/^https:\/\//i.test(config.url) && !isLocal) {
    return { ok: false, reason: 'BAD_URL', message: 'The project URL must start with https://' };
  }

  try {
    await request(endpoint(config, '?select=ref&limit=1'), { headers: headers(config) });
  } catch (error) {
    const message = String(error?.message || error);
    if (error?.status === 404 || message.includes('42P01')) {
      return {
        ok: false,
        reason: 'NO_TABLE',
        message: `Connected to the project — the address and key are right. It just has no "${config.table}" table yet: run the setup SQL in step 2, then test again.`,
      };
    }
    if (error?.status === 401 || error?.status === 403) {
      return { ok: false, reason: 'BAD_KEY', message: 'The key was rejected. Check you copied the anon public key.' };
    }
    if (error?.name === 'AbortError') {
      return { ok: false, reason: 'TIMEOUT', message: 'The project did not answer in time. Check the address and the connection.' };
    }
    return { ok: false, reason: 'UNREACHABLE', message: `Could not reach the project. ${message}` };
  }

  // The table is there; make sure the bill-number function is too, because a
  // missing one is not obvious until two tills produce the same bill number.
  try {
    await request(`${config.url}/rest/v1/rpc/tbc_peek_order_no`, {
      method: 'POST',
      headers: headers(config),
      body: '{}',
    });
  } catch (error) {
    if (error?.status === 404) {
      return {
        ok: false,
        reason: 'NO_FUNCTION',
        message:
          'The table is there, but the bill-numbering function is missing — only part of the SQL ran. Run the whole block in step 2 again, then test again.',
      };
    }
    // Anything else here is not worth blocking on: numbering falls back to
    // per-device numbers and the rest of the sync works.
  }

  return { ok: true, reason: 'OK', message: 'Connected. This device now shares the cafe database.' };
}

/* ------------------------------------------------------------ records --- */

/**
 * Write records to the shared database.
 *
 * @param {{kind:string, ref:string, payload:object, deleted?:boolean}[]} rows
 * @returns {Promise<{ok:boolean, count:number, message?:string}>}
 */
export async function pushRecords(rows) {
  const config = cloudConfig();
  if (!config.enabled || !rows.length) return { ok: true, count: 0 };

  const body = rows.map((row) => ({
    kind: row.kind,
    ref: String(row.ref),
    payload: row.payload ?? {},
    deleted: Boolean(row.deleted),
  }));

  try {
    // Upsert on (kind, ref): re-sending a record that is already there updates
    // it rather than failing, which is what makes a retry after a dropped
    // connection safe.
    await request(endpoint(config, '?on_conflict=kind,ref'), {
      method: 'POST',
      headers: headers(config, { Prefer: 'return=minimal,resolution=merge-duplicates' }),
      body: JSON.stringify(body),
    });
    return { ok: true, count: rows.length };
  } catch (error) {
    console.error('[TBC POS] could not send records to the shared database', error);
    return { ok: false, count: 0, message: String(error?.message || error) };
  }
}

/**
 * Read everything changed since a point in time.
 *
 * The cursor is the server's own clock, never the device's — a till with a
 * wrong date must not be able to skip other people's work.
 *
 * @param {string} since  RFC3339 timestamp, or '' for everything
 */
export async function pullRecords(since, limit = PULL_PAGE_SIZE) {
  const config = cloudConfig();
  if (!config.enabled) return { ok: true, rows: [], cursor: since, done: true };

  const filters = [
    'select=kind,ref,payload,deleted,updated_at',
    'order=updated_at.asc,kind.asc,ref.asc',
    `limit=${limit}`,
  ];
  if (since) filters.push(`updated_at=gt.${encodeURIComponent(since)}`);

  try {
    const rows = (await request(endpoint(config, `?${filters.join('&')}`), {
      headers: headers(config),
    })) || [];

    if (!rows.length) return { ok: true, rows: [], cursor: since, done: true };

    // A page can end in the middle of one batch of writes, which all share a
    // single timestamp. Moving the cursor past that timestamp would skip the
    // rest of the batch, so trailing rows sharing the last timestamp are left
    // for the next page.
    const full = rows.length >= limit;
    const lastStamp = rows[rows.length - 1].updated_at;
    let kept = rows;

    if (full) {
      const trimmed = rows.filter((row) => row.updated_at !== lastStamp);
      // Unless the whole page shares one timestamp, in which case take it and
      // move on: leaving it would stall the cursor forever.
      if (trimmed.length) kept = trimmed;
    }

    return {
      ok: true,
      rows: kept,
      cursor: kept[kept.length - 1].updated_at,
      done: !full,
    };
  } catch (error) {
    console.error('[TBC POS] could not read from the shared database', error);
    return { ok: false, rows: [], cursor: since, done: true, message: String(error?.message || error) };
  }
}

/* ------------------------------------------------------- bill numbers --- */

/**
 * Take the next bill number from the shared database.
 *
 * This is the one thing that genuinely cannot be worked out locally: two tills
 * billing at the same moment would otherwise both decide they were on bill 42.
 * Postgres hands them out one at a time, so they never collide.
 *
 * @returns {Promise<number|null>} null when offline or not set up, so the
 *   caller can fall back to a number of its own.
 */
export async function nextOrderNumber() {
  const config = cloudConfig();
  if (!config.enabled) return null;

  try {
    const result = await request(`${config.url}/rest/v1/rpc/tbc_next_order_no`, {
      method: 'POST',
      headers: headers(config),
      body: '{}',
    });
    const value = Number(Array.isArray(result) ? result[0] : result);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  } catch (error) {
    console.error('[TBC POS] could not get a bill number from the shared database', error);
    return null;
  }
}

/* ---------------------------------------------------------------- menu --- */

const MENU_REF = 'published-menu';

/**
 * Publish the menu customers see when they scan a table code. Stored in the
 * same table under its own kind, so there is still only one thing to set up.
 */
export async function publishMenu(snapshot) {
  const result = await pushRecords([{ kind: 'menu', ref: MENU_REF, payload: snapshot }]);
  return result.ok;
}

export async function fetchMenu() {
  const config = cloudConfig();
  if (!config.enabled) return null;

  try {
    const rows = await request(
      endpoint(config, `?kind=eq.menu&ref=eq.${MENU_REF}&select=payload&limit=1`),
      { headers: headers(config) }
    );
    return rows?.[0]?.payload || null;
  } catch (error) {
    console.error('[TBC POS] could not fetch the published menu', error);
    return null;
  }
}

/* -------------------------------------------------- targeted fetching --- */

/**
 * Everything of one kind, regardless of the sync cursor.
 *
 * Used at start-up for the two things needed before anyone can sign in: the
 * staff accounts and the cafe's settings. A brand-new device has no local copy
 * of either, and must not show a login screen it cannot honour.
 */
export async function fetchKind(kind) {
  const config = cloudConfig();
  if (!config.enabled) return null;

  try {
    const rows = await request(
      endpoint(config, `?kind=eq.${encodeURIComponent(kind)}&deleted=is.false&select=ref,payload&limit=500`),
      { headers: headers(config) }
    );
    return (rows || []).map((row) => row.payload);
  } catch (error) {
    console.error(`[TBC POS] could not fetch ${kind} from the shared database`, error);
    return null;
  }
}

/**
 * One order's current state, for a customer's phone following the order it
 * placed. It deliberately fetches just that one: another table's order is none
 * of this phone's business, and it has no reason to hold a copy of it.
 */
export function fetchOrder(id) {
  return fetchRecord('onlineOrders', id);
}

/** One record, by kind and key. */
export async function fetchRecord(kind, ref) {
  const config = cloudConfig();
  if (!config.enabled || !ref) return null;

  try {
    const rows = await request(
      endpoint(
        config,
        `?kind=eq.${encodeURIComponent(kind)}&ref=eq.${encodeURIComponent(ref)}&select=payload,deleted&limit=1`
      ),
      { headers: headers(config) }
    );
    const row = rows?.[0];
    return row && !row.deleted ? row.payload : null;
  } catch (error) {
    console.error('[TBC POS] could not fetch a record from the shared database', error);
    return null;
  }
}
