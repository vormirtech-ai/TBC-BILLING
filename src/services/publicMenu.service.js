/**
 * The menu a customer's phone sees.
 *
 * THE PROBLEM THIS SOLVES
 * The app keeps its menu in the browser's own database. That is right for the
 * counter, but a customer scanning a table code arrives with an empty browser,
 * so their phone would fall back to the menu the app shipped with — and show
 * last season's prices.
 *
 * So the cafe PUBLISHES the menu: a small JSON snapshot that every phone reads
 * before it draws anything. There are two ways to publish, and the app tries
 * them in order of freshness:
 *
 *   1. the shared backend, if cloud sync is on — one click, live immediately;
 *   2. data/menu.published.json in the site itself — download it from the Menu
 *      screen, commit it, and the next deploy carries it.
 *
 * If neither is there, the phone falls back to its local menu and the Menu
 * screen says so, rather than quietly serving stale prices.
 */

import { getMenu, menuCode } from '../repositories/menu.repo.js';
import { getSettings } from '../repositories/settings.repo.js';
import { downloadBlob, toDateKey } from '../core/utils.js';
import { requireAdmin } from '../core/session.js';
import * as cloud from './cloudSync.service.js';

export const PUBLISHED_MENU_PATH = 'data/menu.published.json';
const SNAPSHOT_VERSION = 1;

/**
 * Build the snapshot.
 *
 * Only what a customer needs to choose a drink: no cost prices, no stock
 * levels, no takings. Unavailable items are left out entirely rather than shown
 * greyed out — a menu that offers something the kitchen has run out of is worse
 * than a shorter menu.
 */
export function buildMenuSnapshot() {
  const settings = getSettings();

  return {
    format: 'tbc-published-menu',
    formatVersion: SNAPSHOT_VERSION,
    publishedAt: new Date().toISOString(),
    cafeName: settings.cafeName,
    tagline: settings.tagline,
    currencySymbol: settings.currencySymbol || '₹',
    orderingNote: settings.qrOrderNote || '',
    acceptsOrders: Boolean(settings.qrOrderingEnabled && settings.qrOrderingAcceptsOrders),
    // Prices are shown to the customer as an estimate; the counter always
    // re-prices from its own menu when the order is billed.
    taxNote: settings.taxEnabled
      ? `${settings.taxLabel || 'Tax'}${settings.priceIncludesTax ? ' included' : ' added at the counter'}`
      : '',
    items: getMenu()
      .filter((item) => item.available)
      .map((item) => ({
        code: item.code || menuCode(item.name, item.category),
        name: item.name,
        category: item.category,
        description: item.description || '',
        price: item.price,
      })),
  };
}

/** Hand the operator a file to commit alongside the site. */
export function downloadMenuSnapshot() {
  requireAdmin('publishing the menu');
  const snapshot = buildMenuSnapshot();
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  downloadBlob(blob, 'menu.published.json');
  return { filename: 'menu.published.json', count: snapshot.items.length, snapshot };
}

/** Push the same snapshot to the shared backend, where one is configured. */
export async function publishMenuToCloud() {
  requireAdmin('publishing the menu');
  const snapshot = buildMenuSnapshot();
  const sent = await cloud.publishMenu(snapshot);
  return { sent, count: snapshot.items.length };
}

/** Read the snapshot committed with the site, if there is one. */
export async function fetchPublishedFile() {
  try {
    const url = new URL(PUBLISHED_MENU_PATH, document.baseURI);
    // Revalidate rather than trust the cache: a republished menu should take
    // effect on the next scan, not whenever the browser feels like it.
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) return null;

    const snapshot = await response.json();
    if (snapshot?.format !== 'tbc-published-menu' || !Array.isArray(snapshot.items)) return null;
    return snapshot;
  } catch {
    // A missing file is the normal state before the first publish.
    return null;
  }
}

/**
 * The menu to show a customer, and where it came from.
 *
 * @returns {Promise<{snapshot:object|null, source:'cloud'|'file'|'local'}>}
 */
export async function loadPublicMenu() {
  if (cloud.isCloudEnabled()) {
    const remote = await cloud.fetchMenu();
    if (remote?.items?.length) return { snapshot: remote, source: 'cloud' };
  }

  const file = await fetchPublishedFile();
  if (file?.items?.length) return { snapshot: file, source: 'file' };

  // Last resort: whatever this device knows. On the counter that is the real
  // menu; on a customer's phone it is the one the app shipped with.
  const local = buildMenuSnapshot();
  return { snapshot: local, source: 'local' };
}

/** How stale the published menu is compared with the working one, for admins. */
export async function publishStatus() {
  const current = buildMenuSnapshot();
  const [file, remote] = await Promise.all([
    fetchPublishedFile(),
    cloud.isCloudEnabled() ? cloud.fetchMenu() : Promise.resolve(null),
  ]);

  const fingerprint = (snapshot) =>
    snapshot
      ? snapshot.items
          .map((item) => `${item.code}:${item.price}`)
          .sort()
          .join('|')
      : '';

  const currentPrint = fingerprint(current);
  return {
    itemCount: current.items.length,
    file: file
      ? { publishedAt: file.publishedAt, count: file.items.length, matches: fingerprint(file) === currentPrint }
      : null,
    cloud: remote
      ? { publishedAt: remote.publishedAt, count: remote.items.length, matches: fingerprint(remote) === currentPrint }
      : null,
    cloudEnabled: cloud.isCloudEnabled(),
    suggestedFilename: `menu.published.${toDateKey()}.json`,
  };
}
