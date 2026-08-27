/**
 * The customer book.
 *
 * Who the regulars are, how often they come in, whose birthday is coming up,
 * and who is owed a free coffee. It is a working list rather than a report: the
 * filters answer the questions a manager actually asks at the start of a shift.
 */

import { el, clear, debounce, formatDateKeyLong, businessDateKey } from '../core/utils.js';
import { formatMoney } from '../core/money.js';
import { getSettings } from '../repositories/settings.repo.js';
import * as customersRepo from '../repositories/customers.repo.js';
import { listDays } from '../repositories/businessDays.repo.js';
import * as loyalty from '../services/loyalty.service.js';
import { customerFields } from '../ui/customerFields.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toast, reportError } from '../ui/toast.js';
import { isAdmin } from '../core/session.js';

const FILTERS = [
  { id: 'ALL', label: 'Everyone' },
  { id: 'REWARD', label: 'Free coffee due' },
  { id: 'STREAK', label: 'On a streak' },
  { id: 'BIRTHDAY', label: 'Birthday this week' },
  { id: 'LAPSED', label: 'Not seen lately' },
];

export async function renderCustomers({ outlet }) {
  const settings = getSettings();
  const symbol = settings.currencySymbol || '₹';
  const today = businessDateKey(new Date(), settings.dayRolloverHour);

  const state = { query: '', filter: 'ALL' };
  let tradingDays = [];

  const summary = el('p.page__sub');
  const list = el('div.table');
  const tabs = el('div.chips', { role: 'tablist', 'aria-label': 'Which customers' });

  const search = el('input.input.search__input', {
    type: 'search',
    placeholder: 'Search by phone or name…',
    'aria-label': 'Search customers',
    autocomplete: 'off',
  });

  /* --------------------------------------------------------- the maths --- */

  function context(customer) {
    return {
      progress: loyalty.streakProgress(customer, { today, tradingDays, settings }),
      birthday: loyalty.birthdayStatus(customer, {
        today,
        windowDays: Math.max(7, Number(settings.loyaltyBirthdayWindowDays) || 0),
      }),
      earned: loyalty.pendingRewards(customer, { today, tradingDays, settings }),
    };
  }

  function matchesFilter(customer) {
    const { progress, birthday, earned } = context(customer);
    switch (state.filter) {
      case 'REWARD':
        return earned.length > 0;
      case 'STREAK':
        return progress.length >= 2;
      case 'BIRTHDAY':
        return birthday.has && Math.abs(birthday.daysAway) <= 7;
      case 'LAPSED':
        return Boolean(customer.lastVisit) && daysSince(customer.lastVisit) >= 30;
      default:
        return true;
    }
  }

  function daysSince(dateKey) {
    const then = new Date(`${dateKey}T00:00:00`).getTime();
    const now = new Date(`${today}T00:00:00`).getTime();
    return Math.round((now - then) / 86400000);
  }

  /* ------------------------------------------------------- one customer --- */

  function openCustomer(customer) {
    const { progress, birthday, earned } = context(customer);

    const facts = el('div.factgrid', {}, [
      fact('Visits', String(customer.visitCount || 0)),
      fact('Bills', String(customer.billCount || 0)),
      fact('Spent', formatMoney(customer.totalSpend || 0, symbol)),
      fact('Streak', progress.length ? `${progress.length} day${progress.length === 1 ? '' : 's'}` : '—'),
      fact('First seen', customer.firstVisit ? formatDateKeyLong(customer.firstVisit) : '—'),
      fact('Last seen', customer.lastVisit ? formatDateKeyLong(customer.lastVisit) : '—'),
      fact('Birthday', customer.birthday ? customersRepo.formatBirthday(customer.birthday) : '—'),
      fact('Treats given', String(customer.rewards?.given || 0)),
    ]);

    const recent = (customer.visitDays || [])
      .slice(-14)
      .reverse()
      .map((day) => el('span.pill', { text: formatDateKeyLong(day) }));

    const body = el('div.stack', {}, [
      earned.length
        ? el('p.callout.callout--ok', {
            text: `${earned[0].label} due — ${earned[0].detail} It is offered at the counter as soon as this customer is attached to an order.`,
          })
        : progress.length
        ? el('p.hint', {
            text: `${progress.length} day${progress.length === 1 ? '' : 's'} in a row. ${
              progress.toGo
            } more for a ${(settings.loyaltyRewardLabel || 'free coffee').toLowerCase()}.`,
          })
        : null,
      birthday.has
        ? el('p.hint', {
            text:
              birthday.daysAway === 0
                ? 'Their birthday is today.'
                : `Their birthday is ${Math.abs(birthday.daysAway)} day${
                    Math.abs(birthday.daysAway) === 1 ? '' : 's'
                  } ${birthday.daysAway > 0 ? 'away' : 'ago'}.`,
          })
        : null,
      facts,
      customer.notes ? el('p.modal__text', { text: `“${customer.notes}”` }) : null,
      recent.length
        ? el('div', {}, [el('h3.panel__title', { text: 'Recent visits' }), el('div.pillrow', {}, recent)])
        : null,
    ]);

    const modal = openModal({
      title: customer.name || customersRepo.formatPhone(customer.phone),
      subtitle: customersRepo.formatPhone(customer.phone),
      body,
      actions: [
        isAdmin()
          ? el('button.btn.btn--danger.btn--sm', {
              type: 'button',
              text: 'Remove',
              onclick: async () => {
                const ok = await confirmDialog({
                  title: 'Remove this customer?',
                  message:
                    'Their visits and streak go with them. Bills already taken keep the name that was on them.',
                  confirmLabel: 'Remove',
                  tone: 'danger',
                });
                if (!ok) return;
                try {
                  await customersRepo.deleteCustomer(customer.id);
                  modal.close();
                  toast.success('Customer removed.');
                  paint();
                } catch (error) {
                  reportError(error);
                }
              },
            })
          : null,
        el('button.btn.btn--ghost', {
          type: 'button',
          text: 'Edit details',
          onclick: () => {
            modal.close();
            openEditor(customer);
          },
        }),
        el('button.btn.btn--primary', { type: 'button', text: 'Close', onclick: () => modal.close() }),
      ].filter(Boolean),
    });
  }

  function fact(label, value) {
    return el('div.fact', {}, [
      el('span.fact__label', { text: label }),
      el('span.fact__value', { text: value }),
    ]);
  }

  function openEditor(customer = null) {
    const fields = customerFields(customer);

    const modal = openModal({
      title: customer ? 'Edit customer' : 'Add a customer',
      subtitle: customer
        ? 'The phone number is how they are found at the counter.'
        : 'A phone number is all that is needed; the rest can wait.',
      body: fields.node,
      actions: [
        el('button.btn.btn--ghost', { type: 'button', text: 'Cancel', onclick: () => modal.close() }),
        el('button.btn.btn--primary', {
          type: 'button',
          text: 'Save',
          onclick: async () => {
            try {
              if (customer) await customersRepo.updateCustomer(customer.id, fields.read());
              else await customersRepo.saveCustomer(fields.read());
              modal.close();
              toast.success('Saved.');
              paint();
            } catch (error) {
              reportError(error);
            }
          },
        }),
      ],
    });
    requestAnimationFrame(() => fields.focus());
  }

  /* ------------------------------------------------------------- paint --- */

  function paintTabs() {
    clear(tabs);
    for (const entry of FILTERS) {
      tabs.appendChild(
        el('button.chip', {
          type: 'button',
          role: 'tab',
          text: entry.label,
          'aria-selected': state.filter === entry.id ? 'true' : 'false',
          class: state.filter === entry.id ? 'is-active' : '',
          onclick: () => {
            state.filter = entry.id;
            paintTabs();
            paint();
          },
        })
      );
    }
  }

  function paint() {
    const all = customersRepo.searchCustomers({ query: state.query });
    const rows = all.filter(matchesFilter);

    const book = customersRepo.getCustomers();
    const due = book.filter((row) => context(row).earned.length).length;
    summary.textContent = `${book.length} customer${book.length === 1 ? '' : 's'}${
      due ? ` · ${due} owed a free coffee` : ''
    }`;

    clear(list);

    if (!rows.length) {
      list.appendChild(
        el('div.empty', {}, [
          el('p', {
            text: book.length
              ? 'Nobody matches that.'
              : 'No customers yet. Attach one to an order at the counter and they appear here.',
          }),
        ])
      );
      return;
    }

    list.appendChild(
      el('div.table__head.table__row--customer', {}, [
        el('span', { text: 'Customer' }),
        el('span', { text: 'Phone' }),
        el('span', { text: 'Visits' }),
        el('span', { text: 'Streak' }),
        el('span', { text: 'Birthday' }),
        el('span', { text: 'Last seen' }),
        el('span.table__num', { text: 'Spent' }),
      ])
    );

    for (const customer of rows) {
      const { progress, birthday, earned } = context(customer);
      list.appendChild(
        el('button.table__row.table__row--customer', {
          type: 'button',
          class: earned.length ? 'is-flagged' : '',
          onclick: () => openCustomer(customer),
        }, [
          el('span', {}, [
            el('span.table__name', { text: customer.name || 'No name yet' }),
            earned.length ? el('span.pill.pill--new', { text: earned[0].label }) : null,
          ]),
          el('span.mono', { text: customersRepo.formatPhone(customer.phone) }),
          el('span', { text: String(customer.visitCount || 0) }),
          el('span', {
            text: progress.length
              ? `${progress.length} day${progress.length === 1 ? '' : 's'}`
              : '—',
          }),
          el('span', {
            text: customer.birthday
              ? `${customersRepo.formatBirthday(customer.birthday)}${
                  birthday.daysAway === 0 ? ' · today' : ''
                }`
              : '—',
          }),
          el('span', { text: customer.lastVisit ? formatDateKeyLong(customer.lastVisit) : '—' }),
          el('span.table__num', { text: formatMoney(customer.totalSpend || 0, symbol) }),
        ])
      );
    }
  }

  /* ---------------------------------------------------------- assembly --- */

  const page = el('div.page', {}, [
    el('div.page__head', {}, [
      el('div', {}, [el('h1.page__title', { text: 'Customers' }), summary]),
      el('div.page__actions', {}, [
        el('button.btn.btn--primary', {
          type: 'button',
          text: 'Add a customer',
          onclick: () => openEditor(null),
        }),
      ]),
    ]),
    el('div.pos__toolbar', {}, [el('div.search', {}, [search])]),
    tabs,
    list,
  ]);

  clear(outlet).appendChild(page);

  search.addEventListener(
    'input',
    debounce(() => {
      state.query = search.value.trim();
      paint();
    }, 120)
  );

  paintTabs();
  paint();

  // The trading calendar and the book itself, both of which a fresh device may
  // still be pulling down. The list is painted first and corrected after.
  await Promise.all([
    listDays()
      .then((rows) => {
        tradingDays = rows.map((row) => row.date);
      })
      .catch(() => {}),
    customersRepo.loadCustomers().catch(() => {}),
  ]);
  paint();

  const unsubscribe = customersRepo.onCustomersChange(() => paint());
  return () => unsubscribe();
}
