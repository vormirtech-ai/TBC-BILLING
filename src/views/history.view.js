/** Bill history: search, filter, inspect, reprint, export, void. */

import {
  el,
  clear,
  debounce,
  formatDate,
  formatTime,
  formatDateKeyLong,
  toDateKey,
} from '../core/utils.js';
import { formatMoney } from '../core/money.js';
import { getSettings } from '../repositories/settings.repo.js';
import * as transactionsRepo from '../repositories/transactions.repo.js';
import * as daysRepo from '../repositories/businessDays.repo.js';
import { summarise } from '../services/reports.service.js';
import { exportBusinessDay, exportDateRange, exportEverything } from '../services/export.service.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { renderReceipt, printReceipt } from '../ui/receipt.js';
import { toast, reportError } from '../ui/toast.js';
import { isAdmin } from '../core/session.js';
import { PAYMENT_METHODS, paymentLabel } from '../config/app.config.js';

const PAGE_SIZE = 40;

export async function renderHistory({ outlet, query: routeQuery }) {
  const settings = getSettings();
  const symbol = settings.currencySymbol || '₹';
  const admin = isAdmin();

  clear(outlet).appendChild(el('div.loading', { text: 'Loading bills…' }));

  let all = await transactionsRepo.listAll();
  const days = await daysRepo.listDays();

  const filters = {
    query: routeQuery?.bill || '',
    from: '',
    to: '',
    cashier: 'All',
    paymentMethod: 'All',
    status: 'All',
  };
  let visibleCount = PAGE_SIZE;

  const cashiers = ['All', ...new Set(all.map((txn) => txn.cashier))];

  /* --------------------------------------------------------- controls --- */

  const searchInput = el('input.input', {
    type: 'search',
    placeholder: 'Bill number, transaction id, item or customer…',
    'aria-label': 'Search bills',
    value: filters.query,
  });
  searchInput.addEventListener(
    'input',
    debounce(() => {
      filters.query = searchInput.value.trim();
      visibleCount = PAGE_SIZE;
      paint();
    }, 150)
  );

  const fromInput = el('input.input', { type: 'date', 'aria-label': 'From date' });
  const toInput = el('input.input', { type: 'date', 'aria-label': 'To date' });
  fromInput.addEventListener('change', () => {
    filters.from = fromInput.value;
    paint();
  });
  toInput.addEventListener('change', () => {
    filters.to = toInput.value;
    paint();
  });

  function select(label, options, onChange) {
    const node = el(
      'select.input',
      { 'aria-label': label, onchange: (event) => onChange(event.target.value) },
      options.map((option) =>
        el('option', {
          value: typeof option === 'string' ? option : option.value,
          text: typeof option === 'string' ? option : option.label,
        })
      )
    );
    return node;
  }

  const cashierSelect = select('Cashier', cashiers, (value) => {
    filters.cashier = value;
    paint();
  });
  const paymentSelect = select(
    'Payment method',
    ['All', ...PAYMENT_METHODS.map((method) => ({ value: method.id, label: method.label }))],
    (value) => {
      filters.paymentMethod = value;
      paint();
    }
  );
  const statusSelect = select(
    'Status',
    [
      { value: 'All', label: 'All bills' },
      { value: 'COMPLETED', label: 'Completed' },
      { value: 'VOID', label: 'Voided' },
    ],
    (value) => {
      filters.status = value;
      paint();
    }
  );

  const results = el('div.table.table--history');
  const summaryBar = el('div.histsummary');
  const moreWrap = el('div.more');

  /* ----------------------------------------------------------- detail --- */

  function openDetail(txn) {
    const actions = [
      el('button.btn.btn--ghost', {
        type: 'button',
        text: 'Print',
        onclick: () => printReceipt(txn, settings),
      }),
    ];

    if (admin && txn.status !== 'VOID') {
      actions.push(
        el('button.btn.btn--danger', {
          type: 'button',
          text: 'Void bill',
          onclick: async () => {
            const reason = window.prompt('Why is this bill being voided?');
            if (reason === null) return;
            const ok = await confirmDialog({
              title: `Void ${txn.orderNo}?`,
              message:
                'The bill stays in history and in exports, flagged as voided, and comes out of the day’s sales totals.',
              detail: `${formatMoney(txn.grandTotal, symbol)} will be removed from ${formatDateKeyLong(
                txn.businessDate
              )}.`,
              confirmLabel: 'Void bill',
              tone: 'danger',
            });
            if (!ok) return;
            try {
              await transactionsRepo.voidTransaction(txn.id, reason);
              all = await transactionsRepo.listAll();
              toast.success(`${txn.orderNo} voided.`);
              modal.close();
              paint();
            } catch (error) {
              reportError(error);
            }
          },
        })
      );
    }
    actions.push(
      el('button.btn.btn--primary', { type: 'button', text: 'Close', onclick: () => modal.close() })
    );

    const modal = openModal({
      title: txn.orderNo,
      subtitle: `${formatDate(txn.createdAt)} · ${formatTime(txn.createdAt, true)} · ${
        txn.cashierName || txn.cashier
      }`,
      body: el('div.detail', {}, [renderReceipt({ ...txn, receiptFooter: settings.receiptFooter })]),
      actions,
    });
  }

  /* ------------------------------------------------------------ paint --- */

  function paint() {
    const rows = transactionsRepo.filterTransactions(all, filters);
    const totals = summarise(rows);

    clear(summaryBar).append(
      el('span', { text: `${rows.length} bill${rows.length === 1 ? '' : 's'}` }),
      el('span.histsummary__value', { text: formatMoney(totals.totalSales, symbol) }),
      el('span', { text: `${totals.itemCount} items` }),
      totals.voidCount ? el('span.is-void', { text: `${totals.voidCount} voided` }) : null
    );

    clear(results);
    if (!rows.length) {
      results.appendChild(
        el('p.empty', {
          text: all.length
            ? 'No bills match these filters.'
            : 'No bills recorded on this device yet.',
        })
      );
      clear(moreWrap);
      return;
    }

    results.appendChild(
      el('div.table__head.table__head--history', {}, [
        el('span', { text: 'Bill' }),
        el('span', { text: 'Date' }),
        el('span', { text: 'Time' }),
        el('span', { text: 'Cashier' }),
        el('span', { text: 'Payment' }),
        el('span', { text: 'Items' }),
        el('span.table__num', { text: 'Total' }),
      ])
    );

    for (const txn of rows.slice(0, visibleCount)) {
      results.appendChild(
        el(
          'button.table__row.table__row--history',
          { type: 'button', onclick: () => openDetail(txn) },
          [
            el('span.mono', {
              text: txn.orderNo,
              class: txn.status === 'VOID' ? 'is-void' : '',
            }),
            el('span', { text: formatDate(txn.createdAt) }),
            el('span', { text: formatTime(txn.createdAt) }),
            el('span', { text: txn.cashierName || txn.cashier }),
            el('span', { text: paymentLabel(txn.paymentMethod) }),
            el('span', { text: String(txn.items.reduce((n, i) => n + i.quantity, 0)) }),
            el('span.table__num', {
              text: formatMoney(txn.grandTotal, symbol),
              class: txn.status === 'VOID' ? 'is-void' : '',
            }),
          ]
        )
      );
    }

    clear(moreWrap);
    if (rows.length > visibleCount) {
      moreWrap.appendChild(
        el('button.btn.btn--ghost', {
          type: 'button',
          text: `Show ${Math.min(PAGE_SIZE, rows.length - visibleCount)} more`,
          onclick: () => {
            visibleCount += PAGE_SIZE;
            paint();
          },
        })
      );
    }
  }

  /* ----------------------------------------------------------- export --- */

  const exportPanel = admin
    ? el('section.panel.panel--wide', {}, [
        el('h2.panel__title', { text: 'Export to Excel' }),
        el('p.panel__line', {
          text: 'Each business day exports as its own workbook: one row per item, plus a Daily Summary sheet.',
        }),
        el('div.export__row', {}, [
          el(
            'select.input#exportDay',
            { 'aria-label': 'Business day to export' },
            days.length
              ? days.map((day) =>
                  el('option', {
                    value: day.date,
                    text: `${daysRepo.dayLabel(day.dayNumber)} · ${formatDateKeyLong(day.date)} · ${
                      day.transactionCount
                    } bills`,
                  })
                )
              : [el('option', { value: '', text: 'No trading days yet' })]
          ),
          el('button.btn.btn--primary', {
            type: 'button',
            text: 'Export day',
            disabled: !days.length,
            onclick: async (event) => {
              const value = document.getElementById('exportDay')?.value;
              if (!value) return;
              const button = event.currentTarget;
              button.disabled = true;
              try {
                const result = await exportBusinessDay(value);
                toast.success(`${result.filename} downloaded (${result.count} bills).`);
              } catch (error) {
                reportError(error);
              } finally {
                button.disabled = false;
              }
            },
          }),
        ]),
        el('div.export__row', {}, [
          el('span.export__label', { text: 'Date range' }),
          el('input.input#rangeFrom', { type: 'date', 'aria-label': 'Range start', value: toDateKey() }),
          el('input.input#rangeTo', { type: 'date', 'aria-label': 'Range end', value: toDateKey() }),
          el('button.btn.btn--ghost', {
            type: 'button',
            text: 'Export range',
            onclick: async () => {
              const from = document.getElementById('rangeFrom')?.value;
              const to = document.getElementById('rangeTo')?.value;
              if (!from || !to) {
                toast.warn('Pick both a start and an end date.');
                return;
              }
              try {
                const result = await exportDateRange(from, to);
                toast.success(`${result.filename} downloaded (${result.count} bills).`);
              } catch (error) {
                reportError(error);
              }
            },
          }),
          el('button.btn.btn--ghost', {
            type: 'button',
            text: 'Export everything',
            onclick: async () => {
              try {
                const result = await exportEverything();
                toast.success(`${result.filename} downloaded (${result.count} bills).`);
              } catch (error) {
                reportError(error);
              }
            },
          }),
        ]),
      ])
    : null;

  /* --------------------------------------------------------- assembly --- */

  const page = el('div.page', {}, [
    el('div.page__head', {}, [
      el('div', {}, [
        el('h1.page__title', { text: 'Bills' }),
        el('p.page__sub', { text: `${all.length} recorded on this device` }),
      ]),
    ]),

    el('section.filters', {}, [
      el('div.filters__search', {}, [searchInput]),
      el('div.filters__row', {}, [
        el('label.filters__field', {}, [el('span', { text: 'From' }), fromInput]),
        el('label.filters__field', {}, [el('span', { text: 'To' }), toInput]),
        el('label.filters__field', {}, [el('span', { text: 'Cashier' }), cashierSelect]),
        el('label.filters__field', {}, [el('span', { text: 'Payment' }), paymentSelect]),
        el('label.filters__field', {}, [el('span', { text: 'Status' }), statusSelect]),
        el('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          text: 'Reset',
          onclick: () => {
            Object.assign(filters, {
              query: '',
              from: '',
              to: '',
              cashier: 'All',
              paymentMethod: 'All',
              status: 'All',
            });
            searchInput.value = '';
            fromInput.value = '';
            toInput.value = '';
            cashierSelect.value = 'All';
            paymentSelect.value = 'All';
            statusSelect.value = 'All';
            visibleCount = PAGE_SIZE;
            paint();
          },
        }),
      ]),
    ]),

    summaryBar,
    results,
    moreWrap,
    exportPanel,
  ]);

  clear(outlet).appendChild(page);
  paint();
}
