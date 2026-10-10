/**
 * The frame every screen sits inside: the navigation rail, the context bar,
 * the live-link indicator and the watermark behind all of it.
 *
 * The rail is rebuilt whenever the replica changes, so the badges — dockets
 * on the pass, tables waiting to pay — are current without any screen having
 * to remember to update them.
 */

import { h, fill, clear } from '../core/dom.js';
import { icon } from './icons.js';
import { clockTime, longDate } from '../shared/format.js';
import { APP, ASSETS, ROLE_LABELS, KOT_STATUS } from '../shared/config.js';
import { navigate, parseHash } from '../core/router.js';
import * as state from '../state.js';
import { confirm } from './components.js';
import { openGuide } from '../views/guide.view.js';

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
let linkHost = null;
let clockTimer = null;

let link = { connected: true, since: Date.now() };
let repainter = () => {};

/** main.js hands us the function that redraws the current screen. */
export const setRepainter = (fn) => { repainter = fn; };

/** Ask for the current screen to be drawn again — after a local UI change. */
export const repaint = () => repainter();

/* -------------------------------------------------------------- badges --- */

function badges() {
  const orders = state.openOrders();
  let cooking = 0;
  let onPass = 0;
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

/* --------------------------------------------------------------- shell --- */

export function buildShell() {
  if (document.querySelector('.app')) return document.querySelector('.app');

  railHost = h('nav.rail', { 'aria-label': 'Sections' });
  barHost = h('header.topbar');
  linkHost = h('div.linkstate', { hidden: true });

  const app = h('div.app', {}, [
    railHost,
    h('div.main', {}, [barHost, h('main#view.view', { tabIndex: -1 }), linkHost]),
  ]);

  if (!document.querySelector('.watermark')) {
    document.body.appendChild(h('div.watermark', { 'aria-hidden': 'true' }));
  }
  document.body.appendChild(app);

  paintRail();
  paintLink();

  clockTimer = setInterval(() => {
    const node = document.querySelector('.topbar__clock');
    if (node) node.textContent = clockTime(Date.now());
  }, 10_000);

  return app;
}

export function teardownShell() {
  clearInterval(clockTimer);
  clockTimer = null;
  document.querySelector('.app')?.remove();
  document.querySelector('.watermark')?.remove();
  railHost = null;
  barHost = null;
  linkHost = null;
}

export function paintRail() {
  if (!railHost) return;
  const user = state.session();
  if (!user) return;
  const count = badges();
  const here = parseHash().path;

  fill(railHost, [
    h('div.rail__brand', {}, [
      h('img.rail__mark', { src: ASSETS.logo, alt: '' }),
      h('span.rail__wordmark', { text: APP.name }),
    ]),

    ...NAV.filter((entry) => state.mayOpen(entry.path)).map((entry) =>
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
      type: 'button', title: 'How to walk through this', onclick: openGuide,
    }, [icon('script', { size: 20 }), 'Guide']),

    h('div.rail__user', {}, [
      h('div.rail__avatar', {
        text: user.initials,
        title: `${user.name} · ${ROLE_LABELS[user.role] || user.role}`,
      }),
      h('button.rail__item', {
        type: 'button',
        style: { padding: '6px 2px' },
        onclick: async () => {
          if (await confirm({
            title: 'Sign out?',
            message: `${user.name} will be signed out of this terminal. Open tables `
              + 'and dockets are on the till and stay exactly as they are.',
            confirmLabel: 'Sign out',
          })) {
            await state.signOut();
            navigate('/');
          }
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

/* ----------------------------------------------------------- the link --- */

/**
 * Tell the room when the till cannot be reached.
 *
 * This matters more than it looks. A captain who taps a dish and sees
 * nothing happen will tap it again, and again — so when the link is down the
 * terminal says so in a band across the bottom, and says how many commands
 * are waiting to go when it returns.
 */
export function setLinkState(status) {
  link = { ...link, ...status };
  paintLink();
}

function paintLink() {
  if (!linkHost) return;
  const net = state.networkState();
  const down = !link.connected || !net.online;
  const queued = net.queued;

  if (!down && !queued) {
    linkHost.hidden = true;
    clear(linkHost);
    return;
  }

  linkHost.hidden = false;
  fill(linkHost, h(`div.linkstate__bar${down ? '.linkstate__bar--down' : '.linkstate__bar--catching'}`, {}, [
    h('span.linkstate__dot'),
    h('span', {
      text: down
        ? 'This terminal cannot reach the till'
        : 'Catching up with the till',
    }),
    queued
      ? h('span.linkstate__count', {
        text: `${queued} ${queued === 1 ? 'command' : 'commands'} waiting`,
      })
      : null,
    down
      ? h('span.linkstate__hint', {
        text: 'Orders you take now are held and sent the moment it is back.',
      })
      : null,
  ]));
}

// Keep the band honest as commands queue and drain.
state.onNetworkChange(() => paintLink());

export const viewHost = () => document.getElementById('view');
export const shellMounted = () => !!document.querySelector('.app');

export { APP, ROLE_LABELS };
