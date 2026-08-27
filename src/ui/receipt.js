/**
 * Bill rendering.
 *
 * The receipt is built entirely from the SAVED transaction — never from the
 * current menu or current settings — so reprinting a three-week-old bill
 * reproduces exactly what the customer was handed that day.
 */

import { el, formatDate, formatTime } from '../core/utils.js';
import { formatMoney, formatRate } from '../core/money.js';
import { paymentLabel } from '../config/app.config.js';

function line(label, value, modifier = '') {
  return el(`div.receipt__line${modifier}`, {}, [
    el('span', { text: label }),
    el('span', { text: value }),
  ]);
}

export function renderReceipt(txn) {
  const symbol = txn.currency || '₹';
  const created = new Date(txn.createdAt);

  const items = txn.items.map((item) =>
    el('div.receipt__item', {}, [
      el('div.receipt__itemhead', {}, [
        el('span.receipt__itemname', { text: item.name }),
        el('span.receipt__itemtotal', { text: formatMoney(item.total, symbol) }),
      ]),
      el('div.receipt__itemmeta', {
        text: `${item.quantity} × ${formatMoney(item.unitPrice, symbol)}${
          item.discountAmount ? `  −${formatMoney(item.discountAmount, symbol)}` : ''
        }`,
      }),
      item.note ? el('div.receipt__itemnote', { text: item.note }) : null,
    ])
  );

  return el('article.receipt', {}, [
    el('header.receipt__head', {}, [
      el('img.receipt__logo', { src: 'assets/logo.jpg', alt: '' }),
      el('h1.receipt__name', { text: txn.cafeName || 'The Baruch Cafe' }),
      txn.cafeAddress ? el('p.receipt__meta', { text: txn.cafeAddress }) : null,
      txn.cafePhone ? el('p.receipt__meta', { text: `Phone ${txn.cafePhone}` }) : null,
      txn.gstin ? el('p.receipt__meta', { text: `GSTIN ${txn.gstin}` }) : null,
    ]),

    el('div.receipt__rule'),

    el('div.receipt__info', {}, [
      line('Bill', txn.orderNo),
      line('Date', `${formatDate(created)} ${formatTime(created, true)}`),
      line('Cashier', txn.cashierName || txn.cashier),
      txn.customerName ? line('Customer', txn.customerName) : null,
      txn.customerPhone ? line('Phone', txn.customerPhone) : null,
      txn.dayNumber ? line('Business day', String(txn.dayNumber)) : null,
    ]),

    el('div.receipt__rule'),
    el('div.receipt__items', {}, items),
    el('div.receipt__rule'),

    el('div.receipt__totals', {}, [
      line('Subtotal', formatMoney(txn.subtotal, symbol)),
      txn.rewardAmount
        ? line(
            `${txn.rewardLabel || 'Reward'}${txn.rewardItemName ? ` (${txn.rewardItemName})` : ''}`,
            `−${formatMoney(txn.rewardAmount, symbol)}`
          )
        : null,
      txn.discountAmount
        ? line(
            `Discount${txn.discountType === 'PERCENT' ? ` (${formatRate(txn.discountValue)})` : ''}`,
            `−${formatMoney(txn.discountAmount, symbol)}`
          )
        : null,
      txn.taxAmount
        ? line(
            `${txn.taxLabel || 'Tax'}${txn.taxInclusive ? ' (included)' : ''}`,
            formatMoney(txn.taxAmount, symbol)
          )
        : null,
      txn.roundOff ? line('Round off', formatMoney(txn.roundOff, symbol)) : null,
      line('Total', formatMoney(txn.grandTotal, symbol), '.receipt__line--total'),
      line('Paid by', paymentLabel(txn.paymentMethod)),
      txn.amountTendered !== null && txn.amountTendered !== undefined
        ? line('Cash received', formatMoney(txn.amountTendered, symbol))
        : null,
      txn.changeDue ? line('Change', formatMoney(txn.changeDue, symbol)) : null,
    ]),

    txn.status === 'VOID'
      ? el('p.receipt__void', { text: `VOID — ${txn.voidReason || 'cancelled'}` })
      : null,

    el('footer.receipt__foot', {}, [
      el('p', { text: txn.receiptFooter || 'Thank you for visiting. See you again soon.' }),
      el('p.receipt__small', { text: `${txn.orderNo} · ${txn.items.length} line item(s)` }),
    ]),
  ]);
}

/**
 * Print a bill without navigating away. The receipt is dropped into a print-only
 * container; everything else is hidden by the stylesheet during printing.
 */
export function printReceipt(txn, settings = {}) {
  const host = document.getElementById('printArea');
  if (!host) return;

  host.replaceChildren(renderReceipt({ receiptFooter: settings.receiptFooter, ...txn }));
  document.body.classList.add('is-printing');

  const cleanup = () => {
    document.body.classList.remove('is-printing');
    host.replaceChildren();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);

  // Give the browser a frame to lay the receipt out before opening the dialog.
  requestAnimationFrame(() => {
    window.print();
    // Safari does not always fire afterprint.
    setTimeout(cleanup, 1500);
  });
}
