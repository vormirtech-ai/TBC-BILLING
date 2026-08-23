/** The persistent frame around every screen: brand, nav, session controls. */

import { el, clear, businessDateKey, formatDateKeyLong } from '../core/utils.js';
import { getSession } from '../core/session.js';
import { getSettings } from '../repositories/settings.repo.js';
import { getDay, dayLabel } from '../repositories/businessDays.repo.js';
import { navigate, currentRoute } from '../core/router.js';
import { signOut } from '../services/auth.service.js';
import { confirmDialog } from './modal.js';
import { isEmpty } from '../services/cart.service.js';

const NAV = [
  { path: '/pos', label: 'Counter', adminOnly: false },
  { path: '/dashboard', label: 'Dashboard', adminOnly: true },
  { path: '/history', label: 'Bills', adminOnly: false },
  { path: '/menu', label: 'Menu', adminOnly: true },
  { path: '/settings', label: 'Settings', adminOnly: true },
];

function navLink(entry, activePath) {
  return el('a.nav__link', {
    href: `#${entry.path}`,
    text: entry.label,
    'aria-current': activePath === entry.path ? 'page' : null,
    class: activePath === entry.path ? 'is-active' : '',
  });
}

export function renderShell() {
  const session = getSession();
  const settings = getSettings();
  const isAdmin = session?.role === 'admin';

  const links = NAV.filter((entry) => {
    if (entry.adminOnly && !isAdmin) return false;
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

export function mountShell(container) {
  clear(container).appendChild(renderShell());
}
