/**
 * Optional shared backend for QR ordering.
 *
 * WHY THIS EXISTS
 * The app is a static site. A customer's phone and the counter each keep their
 * own database in their own browser, and nothing travels between them on its
 * own. For same-device and hand-the-code-over working that is fine, and the app
 * is fully usable with this switched off.
 *
 * Turn it on and orders from any phone reach the counter within seconds. It
 * speaks PostgREST, which is what a free Supabase project serves, and it needs
 * exactly one table. The SQL is in the README.
 *
 * WHAT IS SENT
 * Order lines, table names and the published menu. No takings, no bills, no
 * staff records, no passwords — those never leave the device. The key stored in
 * Settings is a public anon key: treat the table as readable by anyone who has
 * it, which is why an order is only ever a request that staff must accept.
 *
 * Nothing here is allowed to break the counter. Every call fails soft: the till
 * keeps taking money whether or not the network is there.
 */

import { getSettings } from '../repositories/settings.repo.js';

const REQUEST_TIMEOUT_MS = 12000;

export function cloudConfig() {
  const settings = getSettings();
  const url = String(settings.cloudSyncUrl || '').trim().replace(/\/+$/, '');
  const key = String(settings.cloudSyncKey || '').trim();
  const table = String(settings.cloudSyncTable || 'tbc_sync').trim();

  return {
    enabled: Boolean(settings.cloudSyncEnabled && url && key && table),
    url,
    key,
    table,
    pollSeconds: Math.max(5, Number(settings.cloudSyncPollSeconds) || 10),
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
      throw new Error(`${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 200)}` : ''}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check the settings actually work, and say plainly what is wrong if they do
 * not. Used by the "Test connection" button so an operator is never left
 * guessing whether ordering is live.
 */
export async function testConnection(overrides = {}) {
  const config = { ...cloudConfig(), ...overrides };
  if (!config.url || !config.key) {
    return { ok: false, message: 'Enter both the project URL and the key first.' };
  }
  if (!/^https:\/\//i.test(config.url)) {
    return { ok: false, message: 'The project URL must start with https://' };
  }

  try {
    await request(endpoint(config, '?select=ref&limit=1'), { headers: headers(config) });
    return { ok: true, message: 'Connected. Orders from a phone will reach this counter.' };
  } catch (error) {
    const message = String(error?.message || error);
    if (message.includes('404') || message.includes('42P01')) {
      return {
        ok: false,
        message: `Connected, but there is no table called "${config.table}". Run the setup SQL from the README.`,
      };
    }
    if (message.includes('401') || message.includes('403')) {
      return { ok: false, message: 'The key was rejected. Check you copied the anon public key.' };
    }
    if (error?.name === 'AbortError') {
      return { ok: false, message: 'The project did not answer in time. Check the URL and the connection.' };
    }
    return { ok: false, message: `Could not reach the project. ${message}` };
  }
}

/* -------------------------------------------------------------- orders --- */

function orderRow(order) {
  return {
    kind: 'order',
    ref: order.id,
    status: order.status,
    payload: order,
    updated_at: new Date().toISOString(),
  };
}

/** Send a newly placed order up. Returns false rather than throwing. */
export async function pushOrder(order) {
  const config = cloudConfig();
  if (!config.enabled) return false;

  try {
    await request(endpoint(config), {
      method: 'POST',
      headers: headers(config, { Prefer: 'return=minimal,resolution=merge-duplicates' }),
      body: JSON.stringify(orderRow(order)),
    });
    return true;
  } catch (error) {
    console.error('[TBC POS] could not send the order to the shared backend', error);
    return false;
  }
}

/** Everything placed since `since`, so the counter can pick up what it missed. */
export async function pullOrders(since) {
  const config = cloudConfig();
  if (!config.enabled) return [];

  const filters = ['kind=eq.order', 'select=payload,status,updated_at', 'order=updated_at.asc', 'limit=100'];
  if (since) filters.push(`updated_at=gt.${encodeURIComponent(since)}`);

  try {
    const rows = await request(endpoint(config, `?${filters.join('&')}`), { headers: headers(config) });
    return (rows || []).map((row) => ({ ...row.payload, status: row.status || row.payload?.status }));
  } catch (error) {
    console.error('[TBC POS] could not read orders from the shared backend', error);
    return [];
  }
}

/** Tell the customer's phone what happened to their order. */
export async function pushOrderStatus(order) {
  const config = cloudConfig();
  if (!config.enabled) return false;

  try {
    await request(endpoint(config, `?ref=eq.${encodeURIComponent(order.id)}`), {
      method: 'PATCH',
      headers: headers(config, { Prefer: 'return=minimal' }),
      body: JSON.stringify({
        status: order.status,
        payload: order,
        updated_at: new Date().toISOString(),
      }),
    });
    return true;
  } catch (error) {
    console.error('[TBC POS] could not update the order status', error);
    return false;
  }
}

/**
 * One order's current state.
 *
 * A customer's phone follows only the order it placed. It deliberately does not
 * pull the whole queue: another table's order is none of its business, and it
 * has no reason to hold a copy of it.
 */
export async function fetchOrder(id) {
  const config = cloudConfig();
  if (!config.enabled || !id) return null;

  try {
    const rows = await request(
      endpoint(config, `?kind=eq.order&ref=eq.${encodeURIComponent(id)}&select=payload,status&limit=1`),
      { headers: headers(config) }
    );
    const row = rows?.[0];
    return row ? { ...row.payload, status: row.status || row.payload?.status } : null;
  } catch (error) {
    console.error('[TBC POS] could not check the order status', error);
    return null;
  }
}

/* ---------------------------------------------------------------- menu --- */

const MENU_REF = 'published-menu';

/**
 * Publish the menu so a customer's phone shows today's prices rather than the
 * ones the app shipped with. Upsert: patch first, insert if there was nothing
 * to patch.
 */
export async function publishMenu(snapshot) {
  const config = cloudConfig();
  if (!config.enabled) return false;

  const row = {
    kind: 'menu',
    ref: MENU_REF,
    status: 'PUBLISHED',
    payload: snapshot,
    updated_at: new Date().toISOString(),
  };

  try {
    const patched = await request(endpoint(config, `?ref=eq.${MENU_REF}`), {
      method: 'PATCH',
      headers: headers(config, { Prefer: 'return=representation' }),
      body: JSON.stringify(row),
    });
    if (Array.isArray(patched) && patched.length) return true;

    await request(endpoint(config), {
      method: 'POST',
      headers: headers(config, { Prefer: 'return=minimal' }),
      body: JSON.stringify(row),
    });
    return true;
  } catch (error) {
    console.error('[TBC POS] could not publish the menu', error);
    return false;
  }
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
