/** The persistent frame around every screen: brand, nav, session controls. */

import { el, clear, businessDateKey, formatDateKeyLong } from '../core/utils.js';
import { getSession } from '../core/session.js';
import { getSettings } from '../repositories/settings.repo.js';
import { getDay, dayLabel } from '../repositories/businessDays.repo.js';
import { listPendingOrders, onOrdersChange } from '../repositories/onlineOrders.repo.js';
import { lowStockItems, onInventoryChange } from '../repositories/inventory.repo.js';
import { navigate, currentRoute } from '../core/router.js';
import { signOut } from '../services/auth.service.js';
import { subscribeOrders } from '../services/orderChannel.service.js';
import { onSyncChange, syncState, syncNow } from '../services/sync.service.js';
import { cloudConfig } from '../services/cloudSync.service.js';
import { confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { isEmpty } from '../services/cart.service.js';

const NAV = [
  { path: '/pos', label: 'Counter' },
  { path: '/orders', label: 'Orders', badge: 'orders' },
  { path: '/tables', label: 'Tables' },
  { path: '/customers', label: 'Customers', needsCustomers: true },
  { path: '/history', label: 'Bills' },
  { path: '/dashboard', label: 'Dashboard', adminOnly: true },
  { path: '/inventory', label: 'Stock', badge: 'stock', adminOnly: true },
  { path: '/staff', label: 'Staff', adminOnly: true },
  { path: '/menu', label: 'Menu', adminOnly: true },
  { path: '/settings', label: 'Settings', adminOnly: true },
];

function navLink(entry, activePath) {
  const link = el(`a.nav__link${entry.badge ? `.nav__link--${entry.badge}` : ''}`, {
    href: `#${entry.path}`,
    'aria-current': activePath === entry.path ? 'page' : null,
    class: activePath === entry.path ? 'is-active' : '',
  });
  link.appendChild(el('span', { text: entry.label }));

  // Counts are filled in after the header is mounted, so the nav paints
  // immediately rather than waiting on storage.
  if (entry.badge) {
    link.appendChild(el(`span.nav__badge.nav__badge--${entry.badge}`, { hidden: true }));
  }
  return link;
}

export function renderShell() {
  const session = getSession();
  const settings = getSettings();
  const isAdmin = session?.role === 'admin';

  const links = NAV.filter((entry) => {
    if (entry.adminOnly && !isAdmin) return false;
    if (entry.needsCustomers && !settings.customerTrackingEnabled) return false;
    if (entry.path === '/history' && !isAdmin && !settings.cashierCanViewHistory) return false;
    return true;
  });

  const header = el('header.topbar', {}, [
    el('a.brand', { href: '#/pos', 'aria-label': `${settings.cafeName} counter` }, [
      el('img.brand__mark', {
        src: 'assets/logo.jpg',
        alt: '',
        width: 40,
        height: 40,
        loading: 'eager',
      }),
      el('span.brand__text', {}, [
        el('span.brand__name', { text: settings.cafeName }),
        el('span.brand__sub', { text: 'Billing counter' }),
      ]),
    ]),

    el('nav.nav', { 'aria-label': 'Sections' }, links.map((entry) => navLink(entry, currentRoute()))),

    el('div.topbar__right', {}, [
      // Whether this device is sharing its data, at a glance. The commonest
      // support question there is, so it gets a permanent home rather than
      // living somewhere in Settings.
      el('button.syncchip', {
        id: 'syncChip',
        type: 'button',
        title: 'Check the cafe database now',
        onclick: () => {
          if (!cloudConfig().configured) {
            navigate('/setup');
            return;
          }
          syncNow();
          toast.info('Checking the cafe database…');
        },
      }, [
        el('span.syncchip__dot', { id: 'syncChipDot' }),
        el('span.syncchip__text', { id: 'syncChipText', text: '—' }),
      ]),
      el('div.daychip', { id: 'dayChip' }, [
        el('span.daychip__label', { text: 'Business day' }),
        el('span.daychip__value', { id: 'dayChipValue', text: '—' }),
      ]),
      el('div.userchip', {}, [
        el('span.userchip__name', { text: session?.displayName || session?.username || '' }),
        el('span.userchip__role', { text: isAdmin ? 'Admin' : 'Cashier' }),
      ]),
      el('button.btn.btn--ghost.btn--sm', {
        type: 'button',
        text: 'Sign out',
        onclick: handleSignOut,
      }),
    ]),
  ]);

  refreshDayChip(header);
  refreshBadges(header);
  refreshSyncChip(header);
  return header;
}

/** Relative time, kept short enough for a chip: "just now", "4m ago". */
function sinceLabel(iso) {
  if (!iso) return 'not yet';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

export function refreshSyncChip(root = document) {
  const chip = root.querySelector('#syncChip');
  const dot = root.querySelector('#syncChipDot');
  const text = root.querySelector('#syncChipText');
  if (!chip || !text) return;

  const config = cloudConfig();
  const state = syncState();

  let tone = 'ok';
  let label = 'Shared';

  if (!config.configured) {
    tone = 'off';
    label = 'This device only';
    chip.title = 'Data is stored on this device alone. Tap to set up the cafe database.';
  } else if (!state.enabled) {
    tone = 'off';
    label = 'Sharing off';
    chip.title = 'The cafe database is set up but switched off in Settings.';
  } else if (state.busy) {
    tone = 'busy';
    label = 'Syncing…';
    chip.title = 'Talking to the cafe database.';
  } else if (state.lastError) {
    tone = 'bad';
    label = state.pending ? `${state.pending} waiting` : 'Offline';
    chip.title = `${state.lastError}\nWork carries on and is sent when the connection returns.`;
  } else {
    tone = 'ok';
    label = 'Shared';
    chip.title = `Everything on this device is in the cafe database.\nLast checked ${sinceLabel(
      state.lastSyncAt
    )}.`;
  }

  chip.className = `syncchip is-${tone}`;
  if (dot) dot.className = 'syncchip__dot';
  text.textContent = label;
}

export async function refreshDayChip(root = document) {
  const value = root.querySelector('#dayChipValue');
  if (!value) return;
  const settings = getSettings();
  const key = businessDateKey(new Date(), settings.dayRolloverHour);
  const day = await getDay(key);
  value.textContent = day
    ? `${dayLabel(day.dayNumber)} · ${formatDateKeyLong(key)}`
    : `Not opened · ${formatDateKeyLong(key)}`;
}

/**
 * How many orders were waiting last time we looked. A rise means something new
 * has come in, which is worth interrupting somebody for; a fall just means it
 * was dealt with.
 */
let lastPendingCount = null;

/**
 * Counts on the nav: orders waiting to be accepted, and stock at its reorder
 * level. These are the two things a manager wants to notice without looking.
 */

export async function refreshBadges(root = document) {
  const ordersBadge = root.querySelector('.nav__badge--orders');
  const ordersLink = root.querySelector('.nav__link--orders');

  if (ordersBadge) {
    try {
      const pending = await listPendingOrders();
      const count = pending.length;

      ordersBadge.textContent = count > 99 ? '99+' : String(count);
      ordersBadge.hidden = count === 0;
      ordersBadge.title = `${count} order${count === 1 ? '' : 's'} waiting to be accepted`;

      // The whole button goes red while anything is waiting, so it is visible
      // from across the counter rather than needing to be read.
      if (ordersLink) ordersLink.classList.toggle('is-alert', count > 0);

      if (lastPendingCount !== null && count > lastPendingCount) {
        const arrived = count - lastPendingCount;
        toast.warn(
          `${arrived} new QR order${arrived === 1 ? '' : 's'} — ${pending[0]?.tableName || 'a table'} is waiting.`
        );
        chime();
      }
      lastPendingCount = count;
    } catch {
      ordersBadge.hidden = true;
    }
  }

  const stockBadge = root.querySelector('.nav__badge--stock');
  if (stockBadge) {
    const low = lowStockItems().length;
    stockBadge.textContent = low > 99 ? '99+' : String(low);
    stockBadge.hidden = low === 0;
    stockBadge.title = `${low} item${low === 1 ? '' : 's'} at or below the reorder level`;
  }
}

/**
 * A short, quiet two-note chime when an order arrives.
 *
 * Built with the browser's own oscillator rather than an audio file: no asset
 * to load, and nothing to fail on a counter with no internet. Browsers block
 * sound until the page has been interacted with, which is fine — by the time a
 * cashier is signed in, it has been.
 */
function chime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;

    const context = new Ctx();
    const play = (frequency, startAt, duration) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      // Fade in and out; a square-edged beep clicks unpleasantly.
      gain.gain.setValueAtTime(0.0001, context.currentTime + startAt);
      gain.gain.exponentialRampToValueAtTime(0.14, context.currentTime + startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + startAt + duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(context.currentTime + startAt);
      oscillator.stop(context.currentTime + startAt + duration + 0.02);
    };

    play(880, 0, 0.16);
    play(1174.7, 0.16, 0.22);
    setTimeout(() => context.close().catch(() => {}), 900);
  } catch {
    /* a cafe with sound blocked still gets the red badge and the toast */
  }
}

async function handleSignOut() {
  if (!isEmpty()) {
    const proceed = await confirmDialog({
      title: 'Sign out with an open order?',
      message:
        'The order at the counter has not been paid for. It stays saved on this device and will be here when you sign back in.',
      confirmLabel: 'Sign out',
      tone: 'primary',
    });
    if (!proceed) return;
  }
  signOut();
  navigate('/login', { replace: true });
}

let disposeWatchers = null;

export function mountShell(container) {
  clear(container).appendChild(renderShell());

  // The shell is rebuilt on every navigation, so old watchers are dropped
  // before new ones replace them.
  if (disposeWatchers) disposeWatchers();

  const update = () => refreshBadges(container);
  const unsubscribeOrders = onOrdersChange(update);
  const unsubscribeStock = onInventoryChange(update);
  const unsubscribeChannel = subscribeOrders(update);
  const unsubscribeSync = onSyncChange(() => refreshSyncChip(container));

  // "Synced 4m ago" has to keep counting, or it quietly becomes a lie.
  const clock = setInterval(() => refreshSyncChip(container), 30000);

  disposeWatchers = () => {
    unsubscribeOrders();
    unsubscribeStock();
    unsubscribeChannel();
    unsubscribeSync();
    clearInterval(clock);
    disposeWatchers = null;
  };
}
