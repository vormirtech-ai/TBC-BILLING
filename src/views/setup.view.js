/**
 * Connecting the cafe to its shared database.
 *
 * This is the screen that decides whether the app is one till keeping notes to
 * itself, or a cafe system. It is written as four plain steps, checks its own
 * work at each one, and says exactly what is wrong when something is — because
 * the person doing this is a cafe owner, not a database administrator, and
 * "401 Unauthorized" helps nobody.
 */

import { el, clear, formatDateTime } from '../core/utils.js';
import { renderQrSvg, ECC } from '../lib/qrcode.js';
import { getSettings, saveSettings } from '../repositories/settings.repo.js';
import { testConnection, cloudConfig } from '../services/cloudSync.service.js';
import {
  joinSharedDatabase,
  syncNow,
  syncState,
  onSyncChange,
  pushEverything,
  resetCursor,
} from '../services/sync.service.js';
import { siteBaseUrl } from '../repositories/tables.repo.js';
import { countAll } from '../repositories/transactions.repo.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toast, reportError } from '../ui/toast.js';
import { exportBackup } from '../services/backup.service.js';

/** The one piece of SQL the whole thing needs. */
const SETUP_SQL = `-- The Baruch Cafe — shared database setup.
-- Paste this whole block into Supabase → SQL Editor → Run.

create table if not exists tbc_sync (
  kind       text        not null,
  ref        text        not null,
  payload    jsonb       not null default '{}'::jsonb,
  deleted    boolean     not null default false,
  updated_at timestamptz not null default now(),
  primary key (kind, ref)
);

-- Devices ask "what changed since?", so this is the index that matters.
create index if not exists tbc_sync_changed_idx on tbc_sync (updated_at);

-- The server stamps the time itself. A till with the wrong date must not be
-- able to hide its work from the others.
create or replace function tbc_touch() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists tbc_sync_touch on tbc_sync;
create trigger tbc_sync_touch before insert or update on tbc_sync
  for each row execute function tbc_touch();

-- Bill numbers. Postgres hands these out one at a time, so two tills billing
-- at the same moment cannot both produce bill 42.
create table if not exists tbc_counters (
  key   text   primary key,
  value bigint not null default 0
);

create or replace function tbc_next_order_no() returns bigint as $$
  insert into tbc_counters (key, value) values ('orderNo', 1)
  on conflict (key) do update set value = tbc_counters.value + 1
  returning value;
$$ language sql;

create or replace function tbc_peek_order_no() returns bigint as $$
  select coalesce((select value from tbc_counters where key = 'orderNo'), 0);
$$ language sql;

alter table tbc_sync     enable row level security;
alter table tbc_counters enable row level security;

-- Anyone holding the public key may read and write. That is deliberate: a
-- customer's phone has to place an order without an account. It is also why an
-- order is only ever a REQUEST that staff accept, why no payment happens
-- online, and why the counter prices every order from its own menu.
drop policy if exists "cafe access" on tbc_sync;
create policy "cafe access" on tbc_sync for all using (true) with check (true);

drop policy if exists "cafe counters" on tbc_counters;
create policy "cafe counters" on tbc_counters for all using (true) with check (true);

grant usage on schema public to anon;
grant all on tbc_sync, tbc_counters to anon;
grant execute on function tbc_next_order_no, tbc_peek_order_no to anon;`;

export async function renderSetup({ outlet }) {
  const settings = getSettings();
  const config = cloudConfig();

  const statusPanel = el('div.stack');
  const resultLine = el('p.hint');

  /* ------------------------------------------------------------ fields --- */

  const urlInput = el('input.input', {
    type: 'url',
    value: settings.cloudSyncUrl || '',
    placeholder: 'https://abcdefghijkl.supabase.co',
    autocapitalize: 'none',
    spellcheck: false,
  });
  const keyInput = el('input.input', {
    type: 'text',
    value: settings.cloudSyncKey || '',
    placeholder: 'The anon public key',
    autocapitalize: 'none',
    spellcheck: false,
  });

  function draftConfig() {
    return {
      url: urlInput.value.trim().replace(/\/+$/, ''),
      key: keyInput.value.trim(),
      table: settings.cloudSyncTable || 'tbc_sync',
    };
  }

  /* ------------------------------------------------------------ status --- */

  async function paintStatus() {
    const live = cloudConfig();
    const state = syncState();
    const bills = await countAll();

    clear(statusPanel).appendChild(
      el('div.setup__status', { class: live.enabled ? 'is-on' : 'is-off' }, [
        el('div.setup__statushead', {}, [
          el('span.setup__statusdot'),
          el('strong', {
            text: live.enabled
              ? 'This device is sharing the cafe database'
              : live.configured
              ? 'Set up, but sharing is switched off'
              : 'This device is storing data on its own',
          }),
        ]),
        el('p.setup__statustext', {
          text: live.enabled
            ? state.lastError
              ? `Last attempt failed: ${state.lastError}. Work carries on here and is sent when the connection returns.`
              : `Last checked ${state.lastSyncAt ? formatDateTime(state.lastSyncAt) : 'not yet'}. ${
                  state.pending ? `${state.pending} record(s) still to send.` : 'Everything here has been sent.'
                }`
            : `${bills} bill${bills === 1 ? '' : 's'} are stored in this browser only. Nothing you do here shows up on another device until the cafe database is connected.`,
        }),
      ])
    );
  }

  /* ------------------------------------------------------- connecting --- */

  async function runTest() {
    resultLine.textContent = 'Checking…';
    resultLine.className = 'hint';
    const result = await testConnection(draftConfig());
    resultLine.textContent = result.message;
    resultLine.className = result.ok ? 'hint is-positive' : 'hint is-negative';
    return result;
  }

  async function connect(event) {
    const button = event.currentTarget;
    const draft = draftConfig();

    if (!draft.url || !draft.key) {
      toast.error('Paste both the project URL and the key first.');
      return;
    }

    button.disabled = true;
    try {
      const test = await testConnection(draft);
      if (!test.ok) {
        toast.error(test.message);
        return;
      }

      // Save first: everything downstream reads the connection from settings.
      await saveSettings({
        cloudSyncUrl: draft.url,
        cloudSyncKey: draft.key,
        cloudSyncTable: draft.table,
        cloudSyncEnabled: true,
      });
      resetCursor();

      let join = await joinSharedDatabase();

      // The shared database already holds a cafe. Adopting it replaces what is
      // on this device, which is not something to do quietly.
      if (join.mode === 'JOIN_NEEDS_CONFIRMATION') {
        const proceed = await confirmDialog({
          title: 'This database already has a cafe in it',
          message:
            'That is what you want on a second device: it will take the menu, bills, stock and staff that are already there. Anything currently on THIS device is replaced.',
          detail: join.localBills
            ? `${join.localBills} bill(s) stored only on this device would be lost. Take a backup first if they matter.`
            : 'There are no bills stored only on this device.',
          confirmLabel: 'Use the cafe database',
          cancelLabel: 'Stop',
          tone: 'danger',
        });

        if (!proceed) {
          await saveSettings({ cloudSyncEnabled: false });
          toast.info('Left alone. Nothing on this device was changed.');
          await paintStatus();
          return;
        }

        if (join.localBills) {
          try {
            const backup = await exportBackup();
            toast.info(`Safety copy downloaded: ${backup.filename}`);
          } catch {
            /* the operator was warned; a failed backup must not block them */
          }
        }
        join = await joinSharedDatabase({ force: true });
      }

      if (!join.ok) {
        toast.error(join.message || 'Could not connect to the cafe database.');
        return;
      }

      if (join.mode === 'FOUNDED') {
        toast.success('Connected. This cafe’s data is now the shared database.');
        setTimeout(() => window.location.reload(), 1400);
      } else {
        toast.success('Connected. This device now shows the cafe’s data.');
        setTimeout(() => window.location.reload(), 1400);
      }
    } catch (error) {
      reportError(error);
    } finally {
      button.disabled = false;
      await paintStatus();
    }
  }

  /* --------------------------------------------------- another device --- */

  /**
   * Pairing by QR code. Typing a Supabase key on a phone keyboard is a small
   * misery and an easy way to make a typo that reads as "the key was rejected".
   */
  function showPairing() {
    const live = cloudConfig();
    if (!live.configured) {
      toast.info('Connect this device first, then you can pair others from it.');
      return;
    }

    const payload = btoa(
      JSON.stringify({ v: 1, url: live.url, key: live.key, table: live.table })
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const link = `${siteBaseUrl()}#/join?c=${payload}`;

    const linkBox = el('input.input.input--mono', {
      type: 'text',
      value: link,
      readonly: true,
      onclick: (event) => event.target.select(),
    });

    const modal = openModal({
      title: 'Add another device',
      subtitle: 'Scan this on the other device, or send it the link.',
      body: el('div.stack', {}, [
        el('div.qrpreview', {}, [
          renderQrSvg(link, { size: 240, ecc: ECC.MEDIUM, title: 'Connect a device' }),
        ]),
        el('label.field', {}, [
          el('span.field__label', { text: 'Or open this address on the other device' }),
          linkBox,
        ]),
        el('p.callout.callout--warn', {
          text:
            'This carries the key to your cafe database. Show it to your own staff and their devices, and nobody else.',
        }),
      ]),
      actions: [
        el('button.btn.btn--ghost', {
          type: 'button',
          text: 'Copy link',
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(link);
              toast.success('Link copied.');
            } catch {
              linkBox.select();
              toast.info('Press Ctrl+C to copy the selected link.');
            }
          },
        }),
        el('button.btn.btn--primary', { type: 'button', text: 'Done', onclick: () => modal.close() }),
      ],
    });
  }

  /* ---------------------------------------------------------- assembly --- */

  const sqlBox = el('pre.setup__sql', { text: SETUP_SQL });

  const page = el('div.page', {}, [
    el('div.page__head', {}, [
      el('div', {}, [
        el('h1.page__title', { text: 'The cafe database' }),
        el('p.page__sub', {
          text: 'Connect every till, phone and laptop to one set of data. Takes about five minutes, once.',
        }),
      ]),
      el('div.page__actions', {}, [
        el('a.btn.btn--ghost', { href: '#/settings', text: 'Back to settings' }),
      ]),
    ]),

    statusPanel,

    el('p.callout', {
      text:
        'Without this, every device keeps its own separate books: a bill rung up on the counter will not appear on your laptop, and an order from a customer’s phone cannot reach the till on its own. With it, they all share one cafe.',
    }),

    /* ---- step 1 ---- */
    el('section.panel.panel--wide', {}, [
      el('h2.panel__title', { text: '1. Create a free database' }),
      el('div.panel__body', {}, [
        el('p.panel__line', {
          text: 'Go to supabase.com, sign up, and create a project. Any region near you is fine, and the free plan is far more than a cafe needs. It takes a minute or two to finish setting up.',
        }),
        el('a.btn.btn--ghost.btn--sm', {
          href: 'https://supabase.com/dashboard',
          target: '_blank',
          rel: 'noopener noreferrer',
          text: 'Open Supabase',
        }),
      ]),
    ]),

    /* ---- step 2 ---- */
    el('section.panel.panel--wide', {}, [
      el('h2.panel__title', { text: '2. Create the table' }),
      el('div.panel__body', {}, [
        el('p.panel__line', {
          text: 'In your project, open the SQL Editor, paste all of this in, and press Run. You only ever do this once.',
        }),
        sqlBox,
        el('div.actionrow', {}, [
          el('button.btn.btn--primary.btn--sm', {
            type: 'button',
            text: 'Copy the SQL',
            onclick: async (event) => {
              try {
                await navigator.clipboard.writeText(SETUP_SQL);
                toast.success('SQL copied. Paste it into the Supabase SQL editor.');
              } catch {
                const range = document.createRange();
                range.selectNodeContents(sqlBox);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
                toast.info('Press Ctrl+C to copy the selected SQL.');
              }
              event.currentTarget.blur();
            },
          }),
        ]),
      ]),
    ]),

    /* ---- step 3 ---- */
    el('section.panel.panel--wide', {}, [
      el('h2.panel__title', { text: '3. Connect this device' }),
      el('div.panel__body', {}, [
        el('p.panel__line', {
          text: 'In Supabase, open Project Settings → API. Copy the Project URL and the key marked "anon public" — not the service role key, which must never leave the dashboard.',
        }),
        el('div.formgrid', {}, [
          el('label.field', {}, [el('span.field__label', { text: 'Project URL' }), urlInput]),
          el('label.field', {}, [el('span.field__label', { text: 'anon public key' }), keyInput]),
        ]),
        resultLine,
        el('div.actionrow', {}, [
          el('button.btn.btn--ghost', { type: 'button', text: 'Test the connection', onclick: runTest }),
          el('button.btn.btn--primary', { type: 'button', text: 'Connect', onclick: connect }),
        ]),
      ]),
    ]),

    /* ---- step 4 ---- */
    el('section.panel.panel--wide', {}, [
      el('h2.panel__title', { text: '4. Add your other devices' }),
      el('div.panel__body', {}, [
        el('p.panel__line', {
          text: 'On each other till, tablet or laptop, open this app and scan the pairing code. It picks up the connection and the cafe’s data, and the same staff logins work everywhere.',
        }),
        el('div.actionrow', {}, [
          el('button.btn.btn--primary', {
            type: 'button',
            text: 'Show the pairing code',
            onclick: showPairing,
            disabled: !config.configured,
          }),
        ]),
      ]),
    ]),

    /* ---- repair ---- */
    el('section.panel.panel--wide', {}, [
      el('h2.panel__title', { text: 'If something looks missing' }),
      el('div.panel__body', {}, [
        el('p.panel__line', {
          text: 'These are safe to run at any time. Neither deletes anything.',
        }),
        el('div.actionrow', {}, [
          el('button.btn.btn--ghost', {
            type: 'button',
            text: 'Check now',
            onclick: async (event) => {
              const button = event.currentTarget;
              button.disabled = true;
              try {
                const result = await syncNow();
                if (result?.ok) {
                  toast.success(
                    result.applied
                      ? `Brought in ${result.applied} record(s) from the cafe database.`
                      : 'Already up to date.'
                  );
                } else {
                  toast.error('Could not reach the cafe database.');
                }
              } finally {
                button.disabled = false;
                await paintStatus();
              }
            },
          }),
          el('button.btn.btn--ghost', {
            type: 'button',
            text: 'Send everything on this device again',
            onclick: async (event) => {
              const button = event.currentTarget;
              button.disabled = true;
              try {
                const result = await pushEverything();
                if (!result.ok) {
                  toast.error('Connect the cafe database first.');
                  return;
                }
                toast.info(`${result.queued} record(s) queued. Sending…`);
                await syncNow();
                toast.success('Everything on this device has been sent.');
              } catch (error) {
                reportError(error);
              } finally {
                button.disabled = false;
                await paintStatus();
              }
            },
          }),
        ]),
      ]),
    ]),
  ]);

  clear(outlet).appendChild(page);
  await paintStatus();

  const unsubscribe = onSyncChange(() => paintStatus());
  return () => unsubscribe();
}
