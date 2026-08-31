/**
 * Boot.
 *
 *   1. Open (or seed) the local state.
 *   2. Register the routes, each guarded by the signed-in role.
 *   3. Build the shell, then hand over to the router.
 *
 * The lock screen is the one route that renders outside the shell — until
 * somebody has signed in there is no rail to draw, no badges to count, and no
 * user whose permissions could decide what to show.
 */

import { APP, ASSETS } from './config.js';
import { h, fill } from './core/dom.js';
import { initStore, subscribe, flush } from './core/store.js';
import { buildInitialState } from './data/seed.js';
import {
  defineRoute, setGuard, setNotFound, startRouter, navigate, } from './core/router.js';
import { session, mayOpen, homeFor } from './state.js';
import { buildShell, paintRail, viewHost } from './ui/shell.js';
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
let lockHost = null;
let teardownLock = null;

function fatal(message, detail) {
  if (!boot) return;
  boot.hidden = false;
  fill(boot, h('div.boot__inner', {}, [
    h('img.boot__logo', { src: ASSETS.logo, alt: '' }),
    h('h1.boot__title', { text: 'The terminal cannot start' }),
    h('p.boot__text', { text: message }),
    detail ? h('p.boot__detail', { text: String(detail) }) : null,
    h('button.btn.btn--primary', {
      type: 'button', text: 'Try again', onclick: () => window.location.reload(),
    }),
  ]));
}

/* ------------------------------------------------------------ routes --- */

/** Wrap a view so every screen gets the same lifecycle for free. */
const screen = (render) => (params) => {
  stopKdsClock();
  const host = viewHost();
  if (!host) return;
  render(host, params);
  paintRail();
};

function registerRoutes() {
  defineRoute('/', () => {
    // The lock screen owns the whole document while nobody is signed in.
    document.querySelector('.app')?.setAttribute('hidden', '');
    if (!lockHost) {
      lockHost = h('div#lock');
      document.body.appendChild(lockHost);
    }
    lockHost.hidden = false;
    teardownLock?.();
    teardownLock = renderLock(lockHost);
  });

  defineRoute('/floor', screen(renderFloor));
  defineRoute('/order', screen(renderOrder));
  defineRoute('/kds', screen(renderKds));
  defineRoute('/bill', screen(renderBillView));
  defineRoute('/reservations', screen(renderReservations));
  defineRoute('/reports', screen(renderReports));
  defineRoute('/menu', screen(renderMenuAdmin));
  defineRoute('/settings', screen(renderSettings));

  setNotFound(() => navigate(session() ? homeFor(session().role) : '/'));

  setGuard((route) => {
    const user = session();

    if (!user) return route.path === '/' ? true : '/';

    if (route.path === '/') return homeFor(user.role);

    if (!mayOpen(route.path)) {
      toast(`A ${user.role} cannot open that screen`, 'warn');
      return homeFor(user.role);
    }

    // Signed in and allowed: make sure the shell is showing.
    teardownLock?.();
    teardownLock = null;
    if (lockHost) { lockHost.hidden = true; lockHost.replaceChildren(); }
    document.querySelector('.app')?.removeAttribute('hidden');
    return true;
  });
}

/* -------------------------------------------------------------- boot --- */

function start() {
  try {
    initStore(buildInitialState);
  } catch (error) {
    fatal('The demo could not build its opening state.', error?.message);
    return;
  }

  buildShell();
  registerRoutes();

  // The rail carries live counts, so it repaints whenever anything changes.
  subscribe(() => { if (session()) paintRail(); });

  // A half-written order should survive a stray tab close during a demo.
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);

  startRouter();

  boot?.setAttribute('hidden', '');
  document.title = `${APP.name} · ${APP.descriptor}`;
}

window.addEventListener('error', (event) => {
  console.error('[saba]', event.error || event.message);
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
