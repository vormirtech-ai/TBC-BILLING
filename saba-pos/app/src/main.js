/**
 * Boot.
 *
 *   1. Ask the server who we are. Signed out → the lock screen, and nothing
 *      else is loaded.
 *   2. Signed in → open the live link, pull the working set, build the shell.
 *   3. Hand over to the router.
 *
 * The one structural idea here is the repaint loop. A terminal does not own
 * its state any more: the kitchen bumps a docket, the server broadcasts, and
 * this terminal's floor plan has to change colour without anybody touching
 * it. So the current screen is re-rendered whenever the replica changes,
 * and `mountView` below is careful to make that invisible — the caret stays
 * in the search box, the list stays where it was scrolled to.
 */

import { APP, ASSETS } from './shared/config.js';
import { h, fill, $ } from './core/dom.js';
import {
  defineRoute, setGuard, setNotFound, startRouter, navigate, parseHash,
} from './core/router.js';
import * as state from './state.js';
import {
  buildShell, paintRail, setLinkState, viewHost, teardownShell, setRepainter,
} from './ui/shell.js';
import { toast } from './ui/components.js';

import { renderLock } from './views/lock.view.js';
import { renderFloor } from './views/floor.view.js';
import { renderOrder } from './views/order.view.js';
import { renderKds, stopKdsClock } from './views/kds.view.js';
import { renderBillView } from './views/bill.view.js';
import { renderReservations } from './views/reservations.view.js';
import { renderReports } from './views/reports.view.js';
import { renderMenuAdmin } from './views/menu.view.js';
import { renderSettings } from './views/settings.view.js';

const boot = document.getElementById('boot');

/** The screen currently on display, so it can be repainted on a change. */
let current = null;
let repainting = false;

function fatal(message, detail, { retry = true } = {}) {
  if (!boot) return;
  boot.hidden = false;
  fill(boot, h('div.boot__inner', {}, [
    h('img.boot__logo', { src: ASSETS.logo, alt: '' }),
    h('h1.boot__title', { text: 'This terminal cannot start' }),
    h('p.boot__text', { text: message }),
    detail ? h('p.boot__detail', { text: String(detail) }) : null,
    retry ? h('button.btn.btn--primary', {
      type: 'button', text: 'Try again', onclick: () => window.location.reload(),
    }) : null,
  ]));
}

/* --------------------------------------------------------- the screen --- */

/**
 * Put a view on screen, keeping the things a repaint would otherwise throw
 * away: where the list was scrolled to, and which field had the caret.
 */
function mountView(node, { preserve }) {
  const host = viewHost();
  if (!host) return;

  const scrolled = preserve ? capture(host) : null;
  fill(host, node);
  if (scrolled) restore(host, scrolled);
  else host.scrollTop = 0;
}

function capture(host) {
  const active = document.activeElement;
  const inside = active && host.contains(active);
  const scrollers = [host, ...host.querySelectorAll('.u-scroll, .dishes, .pad__lines, .kds__board, .settle__left, .settle__right')];
  return {
    tops: scrollers.map((el) => [selectorFor(el, host), el.scrollTop, el.scrollLeft]),
    focus: inside ? {
      selector: selectorFor(active, host),
      start: active.selectionStart ?? null,
      end: active.selectionEnd ?? null,
    } : null,
  };
}

function restore(host, snapshot) {
  for (const [selector, top, left] of snapshot.tops) {
    const el = selector === ':host' ? host : host.querySelector(selector);
    if (el) { el.scrollTop = top; el.scrollLeft = left; }
  }
  if (!snapshot.focus) return;
  const el = host.querySelector(snapshot.focus.selector);
  if (!el || el === document.activeElement) return;
  el.focus({ preventScroll: true });
  if (snapshot.focus.start !== null && el.setSelectionRange) {
    try { el.setSelectionRange(snapshot.focus.start, snapshot.focus.end); } catch { /* not a text field */ }
  }
}

/** A stable-enough way to find the same element again after a repaint. */
function selectorFor(el, host) {
  if (el === host) return ':host';
  if (el.id) return `#${CSS.escape(el.id)}`;
  const bits = [];
  let node = el;
  while (node && node !== host && bits.length < 4) {
    const tag = node.tagName.toLowerCase();
    const cls = [...node.classList].filter((c) => !c.includes('--')).slice(0, 2)
      .map((c) => `.${CSS.escape(c)}`).join('');
    const parent = node.parentElement;
    const index = parent ? [...parent.children].indexOf(node) + 1 : 1;
    bits.unshift(`${tag}${cls}:nth-child(${index})`);
    node = parent;
  }
  return bits.join(' > ') || ':host';
}

/**
 * Wrap a view so it gets the same lifecycle every time, whether it is being
 * opened by the router or repainted because something changed in the kitchen.
 */
const screen = (render, name) => (params) => {
  current = { render, params, name };
  paint({ preserve: false });
};

function paint({ preserve }) {
  if (!current || repainting) return;
  const host = viewHost();
  if (!host) return;

  repainting = true;
  try {
    stopKdsClock();
    // Views render into a detached node, which is then swapped in; a
    // half-drawn screen never reaches the glass.
    const holder = h('div.view__mount');
    current.render(holder, current.params);
    mountView(holder.firstElementChild || holder, { preserve });
    paintRail();
  } catch (error) {
    console.error('[saba] a screen failed to draw', error);
    fill(viewHost(), h('div.view__pad', {}, [
      h('p.notice.notice--danger', {
        text: `This screen could not be drawn: ${error.message}`,
      }),
      h('button.btn.btn--primary', {
        type: 'button', text: 'Reload the terminal',
        onclick: () => window.location.reload(),
      }),
    ]));
  } finally {
    repainting = false;
  }
}

/* -------------------------------------------------------------- routes --- */

function registerRoutes() {
  defineRoute('/', () => {
    teardownShell();
    const host = document.getElementById('lock') || document.body.appendChild(h('div#lock'));
    host.hidden = false;
    renderLock(host, {
      onSignedIn: () => {
        const user = state.session();
        navigate(state.homeFor(user.role));
      },
    });
  });

  defineRoute('/floor', screen(renderFloor, 'floor'));
  defineRoute('/order', screen(renderOrder, 'order'));
  defineRoute('/kds', screen(renderKds, 'kds'));
  defineRoute('/bill', screen(renderBillView, 'bill'));
  defineRoute('/reservations', screen(renderReservations, 'book'));
  defineRoute('/reports', screen(renderReports, 'reports'));
  defineRoute('/menu', screen(renderMenuAdmin, 'menu'));
  defineRoute('/settings', screen(renderSettings, 'settings'));

  setNotFound(() => {
    const user = state.session();
    navigate(user ? state.homeFor(user.role) : '/');
  });

  setGuard((route) => {
    const user = state.session();

    if (!user) return route.path === '/' ? true : '/';
    if (route.path === '/') return state.homeFor(user.role);

    if (!state.mayOpen(route.path)) {
      toast(`A ${user.role} cannot open that screen`, 'warn');
      return state.homeFor(user.role);
    }

    document.getElementById('lock')?.replaceChildren();
    const lock = document.getElementById('lock');
    if (lock) lock.hidden = true;
    if (!document.querySelector('.app')) buildShell();
    return true;
  });
}

/* ---------------------------------------------------------------- boot --- */

async function main() {
  document.title = `${APP.name} · ${APP.descriptor}`;
  registerRoutes();

  // A view that changes something purely local — the selected seat, the
  // open category — asks for itself to be drawn again through here.
  setRepainter(() => paint({ preserve: true }));

  // Being signed out at any moment — session expiry, a manager revoking the
  // account, the server being rebuilt — drops straight back to the lock
  // screen rather than leaving a dead-looking terminal.
  state.onSignedOut(() => {
    current = null;
    toast('This terminal has been signed out', 'warn');
    navigate('/');
  });

  // Any change anywhere in the building repaints whatever is on screen.
  state.subscribe(() => {
    if (current) paint({ preserve: true });
  });

  state.onLinkChange((status) => setLinkState(status));

  let signedIn = false;
  try {
    await state.api.session();
    signedIn = true;
    state.noteSignedIn();
  } catch (error) {
    if (error.status && error.status !== 401) {
      fatal('The till did not answer.', error.message);
      return;
    }
  }

  if (signedIn) {
    try {
      await state.start();
    } catch (error) {
      fatal('The till is not reachable from this terminal.', error.message);
      return;
    }
    buildShell();
  }

  startRouter();
  boot?.setAttribute('hidden', '');
}

window.addEventListener('error', (event) => {
  console.error('[saba]', event.error || event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  // A command that was refused and not awaited would otherwise vanish
  // silently; the staff deserve to be told it did not happen.
  const reason = event.reason;
  if (reason?.name === 'ApiError' && reason.status !== 401) {
    toast(reason.message, 'bad', 5000);
    event.preventDefault();
  }
});

// The browser tab coming back to life after a sleep is the commonest way a
// terminal ends up showing a stale room.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.session()) {
    state.refresh({ reason: 'woke' });
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main, { once: true });
} else {
  main();
}
