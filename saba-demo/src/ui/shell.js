/**
 * The frame every screen sits inside: the navigation rail, the context bar, and
 * the watermark behind both.
 *
 * The rail is rebuilt whenever the store changes so the badges — dockets on the
 * pass, tables waiting to pay — are always current without any screen having to
 * remember to update them.
 */

import { h, fill, clear } from '../core/dom.js';
import { icon } from './icons.js';
import { clockTime, longDate } from '../core/format.js';
import { APP, ASSETS, RESTAURANT, ROLE_LABELS, KOT_STATUS } from '../config.js';
import { navigate, parseHash } from '../core/router.js';
import { session, mayOpen, openOrders, signOut } from '../state.js';
import { confirm } from './components.js';
import { openDemoScript } from '../views/script.view.js';

const NAV = [
  { path: '/floor', label: 'Floor', glyph: 'floor' },
  { path: '/order', label: 'Order', glyph: 'order' },
  { path: '/kds', label: 'Kitchen', glyph: 'kds' },
  { path: '/bill', label: 'Bills', glyph: 'bill' },
  { path: '/reservations', label: 'Book', glyph: 'book' },
  { path: '/reports', label: 'Reports', glyph: 'reports' },
  { path: '/menu', label: 'Menu', glyph: 'menu' },
  { path: '/settings', label: 'Setup', glyph: 'settings' },
];

let railHost = null;
let barHost = null;
let clockTimer = null;

/** Counts that sit on the rail as badges. */
function badges() {
  const orders = openOrders();
  let onPass = 0;
  let cooking = 0;
  for (const order of orders) {
    for (const kot of order.kots) {
      if (kot.status === KOT_STATUS.READY) onPass += 1;
      else if (kot.status === KOT_STATUS.FIRED) cooking += 1;
    }
  }
  return {
    '/kds': cooking + onPass,
    '/bill': orders.filter((o) => o.invoice).length,
  };
}

export function buildShell() {
  railHost = h('nav.rail', { 'aria-label': 'Sections' });
  barHost = h('header.topbar');

  const app = h('div.app', {}, [
    railHost,
    h('div.main', {}, [barHost, h('main#view.view', { tabIndex: -1 })]),
  ]);

  document.body.append(h('div.watermark', { 'aria-hidden': 'true' }), app);
  paintRail();

  clockTimer = setInterval(() => {
    const node = document.querySelector('.topbar__clock');
    if (node) node.textContent = clockTime(Date.now());
  }, 10000);

  return app;
}

export function paintRail() {
  if (!railHost) return;
  const user = session();
  if (!user) return;
  const count = badges();
  const here = parseHash().path;

  fill(railHost, [
    h('div.rail__brand', {}, [
      h('img.rail__mark', { src: ASSETS.logo, alt: '' }),
      h('span.rail__wordmark', { text: 'Saba' }),
    ]),

    ...NAV.filter((entry) => mayOpen(entry.path)).map((entry) =>
      h('button.rail__item', {
        type: 'button',
        'aria-current': here === entry.path ? 'page' : null,
        onclick: () => navigate(entry.path),
      }, [
        icon(entry.glyph, { size: 21 }),
        entry.label,
        count[entry.path]
          ? h('span.rail__badge', { text: String(count[entry.path]) })
          : null,
      ])),

    h('div.rail__spacer'),

    h('button.rail__item', {
      type: 'button', title: 'Demo walkthrough', onclick: openDemoScript,
    }, [icon('script', { size: 20 }), 'Guide']),

    h('div.rail__user', {}, [
      h('div.rail__avatar', { text: user.initials, title: user.name }),
      h('button.rail__item', {
        type: 'button',
        style: { padding: '6px 2px' },
        onclick: async () => {
          if (await confirm({
            title: 'Sign out?',
            message: `${user.name} will be signed out. Open tables and dockets stay exactly as they are.`,
            confirmLabel: 'Sign out',
          })) { signOut(); navigate('/'); }
        },
      }, [icon('logout', { size: 18 }), 'Out']),
    ]),
  ]);
}

/**
 * Every screen calls this once with its own title and buttons, so the bar is
 * owned by the view rather than guessed at by the shell.
 */
export function setTopbar({ title, subtitle, actions = [] }) {
  if (!barHost) return;
  fill(barHost, [
    h('div.u-grow', {}, [
      h('h1.topbar__title', { text: title }),
      subtitle ? h('p.topbar__sub', { text: subtitle }) : null,
    ]),
    ...actions,
    h('div.u-col', { style: { alignItems: 'flex-end' } }, [
      h('span.topbar__clock', { text: clockTime(Date.now()) }),
      h('span.topbar__sub', { text: longDate(Date.now()) }),
    ]),
  ]);
}

export const viewHost = () => document.getElementById('view');

export function mountView(node) {
  const host = viewHost();
  if (!host) return;
  clear(host).appendChild(node);
  host.scrollTop = 0;
}

export function teardownShell() {
  clearInterval(clockTimer);
  clockTimer = null;
  document.querySelector('.app')?.remove();
  document.querySelector('.watermark')?.remove();
  railHost = null;
  barHost = null;
}

export const shellMounted = () => !!document.querySelector('.app');

export { APP, RESTAURANT, ROLE_LABELS };
