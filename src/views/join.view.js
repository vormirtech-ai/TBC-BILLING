/**
 * The screen a second device lands on after scanning the pairing code.
 *
 * Its whole job is to take the connection details out of the link, check they
 * work, and adopt the cafe's data — so that by the time somebody reaches the
 * login screen, their usual username and password already exist on this device
 * and the menu is the cafe's real one.
 *
 * Public by necessity: nobody can sign in on a device that has not connected
 * yet, so this cannot sit behind a login.
 */

import { el, clear } from '../core/utils.js';
import { parseHash, navigate } from '../core/router.js';
import { saveSettingsUnguarded } from '../repositories/settings.repo.js';
import { testConnection } from '../services/cloudSync.service.js';
import { joinSharedDatabase, resetCursor } from '../services/sync.service.js';
import { countAll } from '../repositories/transactions.repo.js';
import { toast } from '../ui/toast.js';

/** Undo the URL-safe base64 the pairing code travels in. */
function decodePayload(text) {
  const normalised = String(text || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4);
  const parsed = JSON.parse(atob(padded));

  if (!parsed || parsed.v !== 1 || !parsed.url || !parsed.key) {
    throw new Error('That pairing code is not from this app.');
  }
  return { url: String(parsed.url), key: String(parsed.key), table: String(parsed.table || 'tbc_sync') };
}

export async function renderJoin({ outlet }) {
  document.body.classList.add('is-customer');
  const cleanup = () => document.body.classList.remove('is-customer');

  const { query } = parseHash();
  const card = el('div.customer__card.setup__join');
  clear(outlet).appendChild(el('div.customer', {}, [card]));

  function show(children) {
    clear(card);
    for (const child of children) if (child) card.appendChild(child);
  }

  function fail(title, message, detail) {
    show([
      el('h1.customer__title', { text: title }),
      el('p.customer__text', { text: message }),
      detail ? el('p.hint', { text: detail }) : null,
      el('a.btn.btn--ghost.btn--block', { href: '#/login', text: 'Continue without connecting' }),
    ]);
  }

  let config;
  try {
    config = decodePayload(query.c);
  } catch (error) {
    fail(
      'That code did not work',
      'Ask for a fresh pairing code from the till that is already connected: Settings → The cafe database → Add another device.',
      String(error?.message || error)
    );
    return cleanup;
  }

  show([
    el('h1.customer__title', { text: 'Connecting this device' }),
    el('p.customer__text', { text: 'Checking the cafe database…' }),
    el('div.loading', { text: '' }),
  ]);

  // Store the connection before testing anything: every service downstream
  // reads it from settings rather than being handed it.
  await saveSettingsUnguarded({
    cloudSyncUrl: config.url.replace(/\/+$/, ''),
    cloudSyncKey: config.key,
    cloudSyncTable: config.table,
    cloudSyncEnabled: true,
  });

  const test = await testConnection();
  if (!test.ok) {
    await saveSettingsUnguarded({ cloudSyncEnabled: false });
    fail('Could not reach the cafe database', test.message);
    return cleanup;
  }

  const localBills = await countAll();
  resetCursor();

  let join = await joinSharedDatabase();

  // A device that already has bills of its own is a different conversation
  // from a blank one, so it gets asked rather than told.
  if (join.mode === 'JOIN_NEEDS_CONFIRMATION') {
    if (localBills > 0) {
      show([
        el('h1.customer__title', { text: 'This device already has bills on it' }),
        el('p.customer__text', {
          text: `Connecting replaces everything stored here with the cafe's data. ${localBills} bill${
            localBills === 1 ? '' : 's'
          } saved only on this device would be lost.`,
        }),
        el('p.hint', {
          text: 'If those bills matter, sign in first and take a backup from Settings, then scan the code again.',
        }),
        el('button.btn.btn--danger.btn--block', {
          type: 'button',
          text: 'Replace and connect',
          onclick: async (event) => {
            event.currentTarget.disabled = true;
            await finish(await joinSharedDatabase({ force: true }));
          },
        }),
        el('a.btn.btn--ghost.btn--block', { href: '#/login', text: 'Stop and leave this device alone' }),
      ]);
      return cleanup;
    }
    join = await joinSharedDatabase({ force: true });
  }

  await finish(join);
  return cleanup;

  async function finish(result) {
    if (!result.ok) {
      await saveSettingsUnguarded({ cloudSyncEnabled: false });
      fail('Could not connect', result.message || 'The cafe database did not answer.');
      return;
    }

    show([
      el('div.customer__tick', { text: '✓' }),
      el('h1.customer__title', { text: 'Connected' }),
      el('p.customer__text', {
        text:
          result.mode === 'FOUNDED'
            ? 'This device is now the cafe database. Everything on it is shared with the devices you add next.'
            : 'This device now shares the cafe’s data. Sign in with your usual username and password.',
      }),
      el('button.btn.btn--pay.btn--block', {
        type: 'button',
        text: 'Sign in',
        onclick: () => {
          // A full reload so every cache starts from the data just pulled in.
          window.location.hash = '#/login';
          window.location.reload();
        },
      }),
    ]);
    toast.success('Connected to the cafe database.');
    setTimeout(() => {
      if (window.location.hash.startsWith('#/join')) navigate('/login', { replace: true });
    }, 4000);
  }
}
