/**
 * Boot sequence.
 *
 * 1. Open the local database and run first-run seeding (menu, users, settings).
 * 2. Load the caches every screen reads from: menu, stock, staff, tables.
 * 3. Restore any session and any unpaid order left on the counter.
 * 4. Register routes with a role guard, then hand over to the router.
 *
 * One route is different from all the others. `#/order` is the customer menu
 * reached by scanning a table's QR code: it is public, it has no shell around
 * it, and it must work on a phone that has never seen this cafe before. The
 * guard below lets it through before it asks about sessions at all.
 */

import { APP, ROLES } from './config/app.config.js';
import { el, clear } from './core/utils.js';
import {
  defineRoute,
  getRoute,
  setNotFound,
  setGuard,
  startRouter,
  navigate,
  parseHash,
} from './core/router.js';
import { restoreSession, getSession, onSessionChange } from './core/session.js';
import { openDatabase, requestPersistentStorage } from './db/database.js';
import { loadSettings, getSettings } from './repositories/settings.repo.js';
import { seedMenuIfEmpty, loadMenu } from './repositories/menu.repo.js';
import { seedUsersIfEmpty } from './repositories/users.repo.js';
import { loadInventory } from './repositories/inventory.repo.js';
import { loadStaff } from './repositories/staff.repo.js';
import { loadTables } from './repositories/tables.repo.js';
import { pruneFinishedOrders } from './repositories/onlineOrders.repo.js';
import { restoreDraft } from './services/cart.service.js';
import { startOrderSync, stopOrderSync } from './services/orderChannel.service.js';
import { mountShell } from './ui/shell.js';
import { toast } from './ui/toast.js';

import { renderLogin } from './views/login.view.js';
import { renderPos } from './views/pos.view.js';
import { renderDashboard } from './views/dashboard.view.js';
import { renderHistory } from './views/history.view.js';
import { renderMenuAdmin } from './views/menu.view.js';
import { renderSettings } from './views/settings.view.js';
import { renderInventory } from './views/inventory.view.js';
import { renderStaff } from './views/staff.view.js';
import { renderTables } from './views/tables.view.js';
import { renderOrders } from './views/orders.view.js';
import { renderCustomerOrder } from './views/customer.view.js';

const shellHost = document.getElementById('shell');
const bootScreen = document.getElementById('boot');

function fatal(message, detail) {
  if (!bootScreen) return;
  bootScreen.hidden = false;
  clear(bootScreen).appendChild(
    el('div.boot__inner', {}, [
      el('img.boot__logo', { src: 'assets/logo.jpg', alt: '' }),
      el('h1.boot__title', { text: 'The counter cannot start' }),
      el('p.boot__text', { text: message }),
      detail ? el('p.boot__detail', { text: detail }) : null,
      el('button.btn.btn--primary', {
        type: 'button',
        text: 'Try again',
        onclick: () => window.location.reload(),
      }),
    ])
  );
}

/** The customer menu stands alone: no nav, no day chip, no sign-out. */
function isCustomerRoute() {
  return parseHash().path === '/order';
}

function refreshShell() {
  if (!shellHost) return;
  if (getSession() && !isCustomerRoute()) {
    shellHost.hidden = false;
    mountShell(shellHost);
  } else {
    shellHost.hidden = true;
    clear(shellHost);
  }
}

/**
 * Orders only need collecting while somebody is signed in to act on them.
 * A customer's phone should not sit polling a backend it cannot use.
 */
function refreshOrderSync() {
  const session = getSession();
  if (session && getSettings().qrOrderingEnabled) startOrderSync();
  else stopOrderSync();
}

async function boot() {
  try {
    await openDatabase();
  } catch (error) {
    fatal(
      error?.message || 'Local storage is unavailable in this browser.',
      'Bills are stored in this browser. Private windows and blocked site data prevent that.'
    );
    return;
  }

  try {
    await loadSettings();
    const [menuResult, userResult] = await Promise.all([seedMenuIfEmpty(), seedUsersIfEmpty()]);

    // Caches the screens read synchronously while painting.
    await Promise.all([loadMenu(), loadInventory(), loadStaff(), loadTables()]);

    restoreSession();
    refreshShell();
    onSessionChange(() => {
      refreshShell();
      refreshOrderSync();
    });
    document.addEventListener('route:changed', refreshShell);

    /* ---- routes ---- */

    defineRoute('/login', { render: renderLogin, public: true });
    defineRoute('/order', { render: renderCustomerOrder, public: true });
    defineRoute('/pos', { render: renderPos });
    defineRoute('/orders', { render: renderOrders });
    defineRoute('/tables', { render: renderTables });
    defineRoute('/history', { render: renderHistory });
    defineRoute('/dashboard', { render: renderDashboard, role: ROLES.ADMIN });
    defineRoute('/inventory', { render: renderInventory, role: ROLES.ADMIN });
    defineRoute('/staff', { render: renderStaff, role: ROLES.ADMIN });
    defineRoute('/menu', { render: renderMenuAdmin, role: ROLES.ADMIN });
    defineRoute('/settings', { render: renderSettings, role: ROLES.ADMIN });

    setNotFound(({ outlet }) => {
      clear(outlet).appendChild(
        el('div.empty', {}, [
          el('p', { text: 'That screen does not exist.' }),
          el('a.btn.btn--ghost.btn--sm', { href: '#/pos', text: 'Back to the counter' }),
        ])
      );
    });

    /**
     * Route guard. The repositories enforce permissions on every write, so this
     * is about not showing someone a screen they cannot use — the two layers
     * back each other up rather than one standing in for the other.
     */
    setGuard((path) => {
      const route = getRoute(path);

      // Public screens are reachable by anyone, signed in or not. A customer
      // scanning a table code is not a user of this cafe's till.
      if (route?.public && path !== '/login') return undefined;

      const session = getSession();
      if (!session) return path === '/login' ? undefined : '/login';
      if (path === '/login' || path === '/') return '/pos';

      if (route?.role && session.role !== route.role) {
        toast.warn('That section is for admins only.');
        return '/pos';
      }
      if (path === '/history' && session.role !== ROLES.ADMIN && !getSettings().cashierCanViewHistory) {
        toast.warn('Bill history is switched off for cashiers.');
        return '/pos';
      }
      if (path === '/orders' && !getSettings().qrOrderingEnabled) {
        toast.info('QR ordering is switched off in Settings.');
        return '/pos';
      }
      return undefined;
    });

    startRouter(getSession() ? '/pos' : '/login');

    if (bootScreen) bootScreen.hidden = true;
    document.body.classList.add('is-ready');

    // Everything past this point is for staff. A customer's phone stops here.
    if (isCustomerRoute()) return;

    if (menuResult.seeded) {
      toast.info(`Menu loaded with ${menuResult.count} items.`);
    }
    if (userResult.seeded) {
      toast.info('Default accounts created. Change the passwords in Settings.');
    }

    // Ask the browser to hold on to the cafe's data. Best effort, no prompt in
    // most browsers, and harmless if declined.
    requestPersistentStorage();

    // A restored draft means the last session ended mid-order.
    if (getSession() && restoreDraft()) {
      toast.info('An unpaid order was still open at the counter.');
    }

    refreshOrderSync();

    // Old accepted and rejected orders are clutter; the bill is the record that
    // matters. Failure here is harmless, so it never blocks the counter.
    pruneFinishedOrders(3).catch(() => {});
  } catch (error) {
    console.error('[TBC POS] boot failed', error);
    fatal('Something went wrong while starting up.', error?.message || String(error));
  }
}

window.addEventListener('error', (event) => {
  console.error('[TBC POS] uncaught', event.error || event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  console.error('[TBC POS] unhandled rejection', event.reason);
});

document.title = APP.name;
boot();

export { navigate };
