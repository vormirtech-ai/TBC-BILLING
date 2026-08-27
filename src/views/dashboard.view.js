/** Admin dashboard: today at a glance, plus the last two weeks of trading. */

import {
  el,
  clear,
  businessDateKey,
  formatDateKeyLong,
  formatTime,
  pad,
} from '../core/utils.js';
import { formatMoney } from '../core/money.js';
import { getSettings } from '../repositories/settings.repo.js';
import * as transactionsRepo from '../repositories/transactions.repo.js';
import * as daysRepo from '../repositories/businessDays.repo.js';
import { getMenu } from '../repositories/menu.repo.js';
import {
  summarise,
  paymentBreakdown,
  topItems,
  categoryBreakdown,
  dailyTrend,
} from '../services/reports.service.js';
import { exportBusinessDay } from '../services/export.service.js';
import { paymentLabel } from '../config/app.config.js';
import { reportError, toast } from '../ui/toast.js';

function stat(label, value, sub) {
  return el('div.stat', {}, [
    el('span.stat__label', { text: label }),
    el('span.stat__value', { text: value }),
    sub ? el('span.stat__sub', { text: sub }) : null,
  ]);
}

function barRow(label, value, share, meta) {
  return el('div.bar', {}, [
    el('div.bar__head', {}, [
      el('span.bar__label', { text: label }),
      el('span.bar__value', { text: value }),
    ]),
    el('div.bar__track', {}, [
      el('div.bar__fill', { style: { width: `${Math.max(2, Math.round(share * 100))}%` } }),
    ]),
    meta ? el('span.bar__meta', { text: meta }) : null,
  ]);
}

export async function renderDashboard({ outlet }) {
  const settings = getSettings();
  const symbol = settings.currencySymbol || '₹';
  const todayKey = businessDateKey(new Date(), settings.dayRolloverHour);

  clear(outlet).appendChild(el('div.loading', { text: 'Loading today’s numbers…' }));

  const [today, days, allTransactions] = await Promise.all([
    transactionsRepo.listByBusinessDate(todayKey),
    daysRepo.listDays(),
    transactionsRepo.listAll(),
  ]);

  const totals = summarise(today);
  const dayRecord = days.find((day) => day.date === todayKey);
  const trend = dailyTrend(days, 14);
  const peakDay = Math.max(1, ...trend.map((entry) => entry.value));
  const menuCount = getMenu().length;
  const unavailable = getMenu().filter((item) => !item.available).length;

  const page = el('div.page', {}, [
    el('div.page__head', {}, [
      el('div', {}, [
        el('h1.page__title', { text: 'Dashboard' }),
        el('p.page__sub', {
          text: dayRecord
            ? `${daysRepo.dayLabel(dayRecord.dayNumber)} · ${formatDateKeyLong(todayKey)}`
            : `${formatDateKeyLong(todayKey)} · no sales yet today`,
        }),
      ]),
      el('div.page__actions', {}, [
        el('a.btn.btn--ghost', { href: '#/history', text: 'All bills' }),
        el('button.btn.btn--primary', {
          type: 'button',
          text: 'Export today',
          disabled: !today.length,
          onclick: async (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            try {
              const result = await exportBusinessDay(todayKey);
              toast.success(`${result.filename} downloaded.`);
            } catch (error) {
              reportError(error);
            } finally {
              button.disabled = false;
            }
          },
        }),
      ]),
    ]),

    el('section.stats', {}, [
      stat(
        'Sales today',
        formatMoney(totals.totalSales, symbol),
        `${totals.orderCount} bill${totals.orderCount === 1 ? '' : 's'}`
      ),
      stat('Items sold', String(totals.itemCount), `${totals.orderCount ? Math.round((totals.itemCount / totals.orderCount) * 10) / 10 : 0} per bill`),
      stat(
        'Average bill',
        formatMoney(totals.averageOrder, symbol),
        [
          totals.discountTotal ? `${formatMoney(totals.discountTotal, symbol)} discounted` : '',
          totals.rewardTotal ? `${formatMoney(totals.rewardTotal, symbol)} given as treats` : '',
        ]
          .filter(Boolean)
          .join(' · ') || 'No discounts'
      ),
      stat(
        'Business day',
        dayRecord ? pad(dayRecord.dayNumber, 2) : '—',
        `${days.length} trading day${days.length === 1 ? '' : 's'} recorded`
      ),
    ]),

    el('div.panels', {}, [
      // ---- payments -----------------------------------------------------
      el('section.panel', {}, [
        el('h2.panel__title', { text: 'How people paid today' }),
        totals.orderCount
          ? el(
              'div.panel__body',
              {},
              paymentBreakdown(today).map((entry) =>
                barRow(
                  entry.label,
                  formatMoney(entry.value, symbol),
                  entry.share,
                  `${entry.count} bill${entry.count === 1 ? '' : 's'}`
                )
              )
            )
          : el('p.empty', { text: 'No payments recorded yet today.' }),
      ]),

      // ---- top items ----------------------------------------------------
      el('section.panel', {}, [
        el('h2.panel__title', { text: 'Top sellers today' }),
        today.length
          ? el(
              'ol.toplist',
              {},
              topItems(today, 6).map((item, index) =>
                el('li.toplist__row', {}, [
                  el('span.toplist__rank', { text: String(index + 1) }),
                  el('span.toplist__name', { text: item.name }),
                  el('span.toplist__qty', { text: `×${item.quantity}` }),
                  el('span.toplist__value', { text: formatMoney(item.value, symbol) }),
                ])
              )
            )
          : el('p.empty', { text: 'Sell something and it will show up here.' }),
      ]),

      // ---- categories ---------------------------------------------------
      el('section.panel', {}, [
        el('h2.panel__title', { text: 'Categories today' }),
        today.length
          ? el(
              'div.panel__body',
              {},
              categoryBreakdown(today).map((entry) =>
                barRow(entry.category, formatMoney(entry.value, symbol), entry.share, `${entry.quantity} sold`)
              )
            )
          : el('p.empty', { text: 'No category data yet.' }),
      ]),

      // ---- trend --------------------------------------------------------
      el('section.panel.panel--wide', {}, [
        el('h2.panel__title', { text: 'Last 14 trading days' }),
        trend.length
          ? el(
              'div.trend',
              {},
              trend.map((entry) =>
                el('div.trend__col', { title: `${formatDateKeyLong(entry.date)} — ${formatMoney(entry.value, symbol)}` }, [
                  el('div.trend__bar', {
                    style: { height: `${Math.max(3, Math.round((entry.value / peakDay) * 100))}%` },
                  }),
                  el('span.trend__label', { text: pad(entry.dayNumber, 2) }),
                ])
              )
            )
          : el('p.empty', { text: 'Trading history builds up as days are recorded.' }),
      ]),

      // ---- recent -------------------------------------------------------
      el('section.panel.panel--wide', {}, [
        el('h2.panel__title', { text: 'Recent bills' }),
        allTransactions.length
          ? el('div.table', {}, [
              el('div.table__head', {}, [
                el('span', { text: 'Bill' }),
                el('span', { text: 'Time' }),
                el('span', { text: 'Cashier' }),
                el('span', { text: 'Payment' }),
                el('span', { text: 'Items' }),
                el('span.table__num', { text: 'Total' }),
              ]),
              ...allTransactions.slice(0, 8).map((txn) =>
                el('a.table__row', { href: `#/history?bill=${encodeURIComponent(txn.orderNo)}` }, [
                  el('span.mono', { text: txn.orderNo }),
                  el('span', { text: formatTime(txn.createdAt) }),
                  el('span', { text: txn.cashierName || txn.cashier }),
                  el('span', { text: paymentLabel(txn.paymentMethod) }),
                  el('span', { text: String(txn.items.reduce((n, i) => n + i.quantity, 0)) }),
                  el('span.table__num', {
                    text: formatMoney(txn.grandTotal, symbol),
                    class: txn.status === 'VOID' ? 'is-void' : '',
                  }),
                ])
              ),
            ])
          : el('p.empty', { text: 'The first bill you take will appear here.' }),
      ]),

      // ---- menu health --------------------------------------------------
      el('section.panel', {}, [
        el('h2.panel__title', { text: 'Menu' }),
        el('div.panel__body', {}, [
          el('p.panel__line', { text: `${menuCount} items across ${new Set(getMenu().map((i) => i.category)).size} categories` }),
          el('p.panel__line', {
            text: unavailable
              ? `${unavailable} item${unavailable === 1 ? '' : 's'} marked unavailable`
              : 'Everything is available',
          }),
          el('a.btn.btn--ghost.btn--sm', { href: '#/menu', text: 'Manage menu' }),
        ]),
      ]),
    ]),
  ]);

  clear(outlet).appendChild(page);
}
