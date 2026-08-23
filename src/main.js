/**
 * Boot sequence.
 *
 * 1. Open the local database and run first-run seeding (menu, users, settings).
 * 2. Restore any session and any unpaid order left on the counter.
 * 3. Register routes with a role guard, then hand over to the router.
 */

import { APP, ROLES } from './config/app.config.js';
import { el, clear } from './core/utils.js';
import { defineRoute, setNotFound, setGuard, startRouter, navigate } from './core/router.js';
import { restoreSession, getSession, onSessionChange } from './core/session.js';
import { openDatabase, requestPersistentStorage } from './db/database.js';
import { loadSettings, getSettings } from './repositories/settings.repo.js';
import { seedMenuIfEmpty, loadMenu } from './repositories/menu.repo.js';
import { seedUsersIfEmpty } from './repositories/users.repo.js';
import { restoreDraft } from './services/cart.service.js';
import { mountShell } from './ui/shell.js';
import { toast } from './ui/toast.js';

import { renderLogin } from './views/login.view.js';
import { renderPos } from './views/pos.view.js';
import { renderDashboard } from './views/dashboard.view.js';
import { renderHistory } from './views/history.view.js';
import { renderMenuAdmin } from './views/menu.view.js';
import { renderSettings } from './views/settings.view.js';

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

function refreshShell() {
  if (!shellHost) return;
  if (getSession()) {
    shellHost.hidden = false;
    mountShell(shellHost);
  } else {
    shellHost.hidden = true;
    clear(shellHost);
  }
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
    await loadMenu();

    restoreSession();
    refreshShell();
    onSessionChange(refreshShell);
    document.addEventListener('route:changed', refreshShell);

    /* ---- routes ---- */

    defineRoute('/login', { render: renderLogin, public: true });
    defineRoute('/pos', { render: renderPos });
    defineRoute('/dashboard', { render: renderDashboard, role: ROLES.ADMIN });
    defineRoute('/history', { render: renderHistory });
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
      const session = getSession();
      if (!session) return path === '/login' ? undefined : '/login';
      if (path === '/login' || path === '/') return '/pos';

      const routeConfig = {
        '/dashboard': ROLES.ADMIN,
        '/menu': ROLES.ADMIN,
        '/settings': ROLES.ADMIN,
      };
      if (routeConfig[path] && session.role !== routeConfig[path]) {
        toast.warn('That section is for admins only.');
        return '/pos';
      }
      if (path === '/history' && session.role !== ROLES.ADMIN && !getSettings().cashierCanViewHistory) {
        toast.warn('Bill history is switched off for cashiers.');
        return '/pos';
      }
      return undefined;
    });

    startRouter(getSession() ? '/pos' : '/login');

    if (bootScreen) bootScreen.hidden = true;
    document.body.classList.add('is-ready');

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
