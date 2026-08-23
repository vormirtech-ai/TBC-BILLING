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
import { confirmDialog } from './modal.js';
import { isEmpty } from '../services/cart.service.js';

const NAV = [
  { path: '/pos', label: 'Counter' },
  { path: '/orders', label: 'Orders', badge: 'orders', needsQrOrdering: true },
  { path: '/tables', label: 'Tables' },
  { path: '/history', label: 'Bills' },
  { path: '/dashboard', label: 'Dashboard', adminOnly: true },
  { path: '/inventory', label: 'Stock', badge: 'stock', adminOnly: true },
  { path: '/staff', label: 'Staff', adminOnly: true },
  { path: '/menu', label: 'Menu', adminOnly: true },
  { path: '/settings', label: 'Settings', adminOnly: true },
];

function navLink(entry, activePath) {
  const link = el('a.nav__link', {
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
    if (entry.needsQrOrdering && !settings.qrOrderingEnabled) return false;
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
  return header;
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
 * Counts on the nav: orders waiting to be accepted, and stock at its reorder
 * level. These are the two things a manager wants to notice without looking.
 */
export async function refreshBadges(root = document) {
  const ordersBadge = root.querySelector('.nav__badge--orders');
  if (ordersBadge) {
    try {
      const pending = await listPendingOrders();
      ordersBadge.textContent = pending.length > 99 ? '99+' : String(pending.length);
      ordersBadge.hidden = pending.length === 0;
      ordersBadge.title = `${pending.length} order${pending.length === 1 ? '' : 's'} waiting`;
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

  disposeWatchers = () => {
    unsubscribeOrders();
    unsubscribeStock();
    unsubscribeChannel();
    disposeWatchers = null;
  };
}
