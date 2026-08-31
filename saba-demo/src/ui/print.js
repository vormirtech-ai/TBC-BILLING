/**
 * The two pieces of paper this system produces.
 *
 * Both are built as ordinary DOM and dropped into a print area that only the
 * print stylesheet can see, so "preview" and "print" are guaranteed to be the
 * same thing — there is no second template that can quietly drift out of step
 * with the one on screen.
 */

import { h } from '../core/dom.js';
import { money } from '../core/money.js';
import { clockTime, longDate, pad, stamp } from '../core/format.js';
import { ASSETS, RESTAURANT, CHARGES, COURSES, stationById, courseById, paymentLabel, KOT_STATUS } from '../config.js';
import { lineUnit, lineGross } from '../domain/pricing.js';
import { kotLines } from '../domain/orders.js';

const LOGO = ASSETS.logo;
const cash = (paise) => money(paise, RESTAURANT.currency, RESTAURANT.locale);

/* -------------------------------------------------------------- bill --- */

/**
 * @param {object} order
 * @param {object} totals   from costOrder()
 * @param {object} [opts]
 * @param {'A4'|'THERMAL'} [opts.format]
 * @param {string} [opts.copy]     'Guest copy' / 'Restaurant copy' / 'Duplicate'
 * @param {object} [opts.share]    when printing one share of a split bill
 * @param {boolean} [opts.showVoids] restaurant copies show what was cancelled
 */
export function renderBill(order, totals, opts = {}) {
  const format = opts.format || 'A4';
  const thermal = format === 'THERMAL';
  const invoice = order.invoice;
  const lines = totals.lines || [];

  return h(`div.doc.doc--bill${thermal ? '.doc--thermal' : ''}`, {}, [
    /* --- masthead --- */
    h('header.doc__head', {}, [
      h('img.doc__logo', { src: LOGO, alt: '' }),
      h('div.doc__brand', {}, [
        h('div.doc__name', { text: RESTAURANT.name }),
        h('div.doc__tagline', { text: RESTAURANT.tagline }),
        h('div.doc__addr', {}, [
          ...RESTAURANT.addressLines.map((line) => h('div', { text: line })),
          h('div', { text: `${RESTAURANT.phone} · ${RESTAURANT.email}` }),
          h('div', { text: `GSTIN ${RESTAURANT.gstin} · FSSAI ${RESTAURANT.fssai}` }),
        ]),
      ]),
      h('div.doc__type', {}, [
        // Until an invoice number is raised this is a proforma: a statement of
        // what is owed, not a tax document. Saying so plainly matters.
        h('div.doc__type-label', { text: invoice ? 'Tax Invoice' : 'Proforma' }),
        h('div.doc__number', { text: invoice?.code || order.code }),
        opts.copy ? h('div.doc__tagline', { text: opts.copy }) : null,
        opts.share ? h('div.doc__tagline', { text: opts.share.label }) : null,
      ]),
    ]),

    /* --- who, where, when --- */
    h('dl.doc__meta', {}, [
      metaCell('Table', order.tableLabel),
      metaCell('Covers', String(order.covers)),
      metaCell('Order', order.code),
      metaCell('Captain', order.captainName),
      metaCell('Opened', clockTime(order.openedAt)),
      metaCell(order.closedAt ? 'Settled' : 'Printed',
        clockTime(order.closedAt || invoice?.at || Date.now())),
      metaCell('Date', longDate(invoice?.at || Date.now())),
      metaCell('Guest', order.guestName || '—'),
    ]),

    /* --- the food --- */
    h('table.doc__items', {}, [
      h('thead', {}, h('tr', {}, [
        h('th', { text: 'Item' }),
        h('th.qty.num', { text: 'Qty' }),
        h('th.rate.num', { text: 'Rate' }),
        h('th.amt.num', { text: 'Amount' }),
      ])),
      h('tbody', {}, billRows(order, lines, opts)),
    ]),

    /* --- money --- */
    h('div.doc__foot-grid', {}, [
      thermal ? null : taxSummary(totals),
      h('div.doc__totals', {}, totalRows(totals, order)),
    ]),

    order.payments.length ? h('div.doc__payments', {},
      order.payments.map((payment) => h('div.row', {}, [
        h('span', { text: `${paymentLabel(payment.method)}${payment.ref ? ` · ${payment.ref}` : ''}` }),
        h('span', { text: cash(payment.paise) }),
      ]))
    ) : null,

    /* --- sign-off --- */
    h('div.doc__signoff', {}, [
      h('div.doc__thanks', { text: 'With our compliments — until next time' }),
      h('div.doc__fineprint', {}, [
        h('div', { text: 'All prices in Indian Rupees. Taxes as per prevailing rates.' }),
        CHARGES.serviceChargeOptional && totals.serviceChargeApplied
          ? h('div', { text: 'Service charge is entirely discretionary and may be removed on request.' })
          : null,
        h('div', { text: `${RESTAURANT.name} · ${RESTAURANT.addressLines.join(', ')}` }),
        h('div', { text: `Printed ${stamp(Date.now())}` }),
      ]),
    ]),
  ]);
}

const metaCell = (label, value) => h('div', {}, [
  h('dt', { text: label }),
  h('dd', { text: value }),
]);

/** Lines grouped under their course heading, the way the meal was eaten. */
function billRows(order, lines, opts) {
  const rows = [];
  for (const course of COURSES) {
    const inCourse = lines.filter((l) => l.course === course.id);
    if (!inCourse.length) continue;
    rows.push(h('tr.doc__course', {}, h('td', { colSpan: 4, text: course.label })));
    for (const line of inCourse) {
      const voided = line.status === KOT_STATUS.VOID;
      if (voided && !opts.showVoids) continue;
      const detail = [
        line.modifiers.map((m) => m.label).join(' · '),
        line.seat ? `Seat ${line.seat}` : '',
        line.notes,
        line.comp ? `Compliments of the house — ${line.compReason}` : '',
        voided ? `Voided — ${line.voidReason}` : '',
      ].filter(Boolean).join(' · ');

      rows.push(h(`tr${voided ? '.doc__void' : ''}`, {}, [
        h('td', {}, [
          h('div', { text: line.name }),
          detail ? h('div.doc__sub', { text: detail }) : null,
        ]),
        h('td.qty.num', { text: String(line.qty) }),
        h('td.rate.num', { text: cash(lineUnit(line)) }),
        h('td.amt.num', { text: line.comp ? '—' : cash(lineGross(line)) }),
      ]));
    }
  }
  if (!rows.length) rows.push(h('tr', {}, h('td', { colSpan: 4, text: 'No items' })));
  return rows;
}

function totalRows(totals, order) {
  const rows = [
    row('Items', cash(totals.gross)),
  ];
  if (totals.comps) rows.push(row('Compliments of the house', `− ${cash(totals.comps)}`, 'credit'));
  if (totals.discount) {
    const discount = order.charges.discount;
    const label = discount.mode === 'PCT'
      ? `Discount ${discount.value}%${discount.reason ? ` · ${discount.reason}` : ''}`
      : `Discount${discount.reason ? ` · ${discount.reason}` : ''}`;
    rows.push(row(label, `− ${cash(totals.discount)}`, 'credit'));
  }
  if (totals.serviceCharge) {
    rows.push(row(`${CHARGES.serviceChargeLabel} ${CHARGES.serviceChargeBps / 100}%`, cash(totals.serviceCharge)));
  }
  for (const tax of totals.taxes) {
    rows.push(row(`${tax.label} @ ${(tax.bps / 100).toFixed(2)}%`, cash(tax.paise), 'muted'));
  }
  if (totals.tip) rows.push(row('Gratuity', cash(totals.tip)));
  if (totals.roundOff) rows.push(row('Round off', cash(totals.roundOff), 'muted'));
  rows.push(row('Total payable', cash(totals.total), 'grand'));
  if (totals.paid && totals.balance !== 0) {
    rows.push(row('Paid', cash(totals.paid)));
    rows.push(row(totals.balance > 0 ? 'Balance due' : 'Change', cash(Math.abs(totals.balance))));
  }
  return rows;
}

const row = (label, value, kind) =>
  h(`div.row${kind ? `.row--${kind}` : ''}`, {}, [
    h('span', { text: label }),
    h('span', { text: value }),
  ]);

/** The GST breakdown block an Indian tax invoice is expected to carry. */
function taxSummary(totals) {
  return h('div.doc__tax-note', {}, [
    h('div', { text: 'Tax summary' }),
    h('table', {}, [
      h('thead', {}, h('tr', {}, [
        h('th', { text: 'Taxable value' }),
        ...totals.taxes.map((tax) => h('th', { text: `${tax.label} ${(tax.bps / 100).toFixed(2)}%` })),
        h('th', { text: 'Total tax' }),
      ])),
      h('tbody', {}, h('tr', {}, [
        h('td', { text: cash(totals.taxable) }),
        ...totals.taxes.map((tax) => h('td', { text: cash(tax.paise) })),
        h('td', { text: cash(totals.taxTotal) }),
      ])),
    ]),
    h('div', {
      style: { marginTop: '2mm' },
      text: 'This is a computer-generated invoice and is valid without signature.',
    }),
  ]);
}

/* --------------------------------------------------------------- KOT --- */

/**
 * The kitchen docket. One per station, no prices, no branding, everything set
 * as large as 80mm allows.
 */
export function renderKot(order, kot, opts = {}) {
  const station = stationById(kot.station);
  const lines = kotLines(order, kot).filter((l) => l.status !== KOT_STATUS.VOID || opts.voided);
  const grouped = COURSES
    .map((course) => ({ course, items: lines.filter((l) => l.course === course.id) }))
    .filter((group) => group.items.length);

  return h('div.doc.doc--kot', {}, [
    opts.voided ? h('div.kot__void', { text: 'CANCELLED' }) : null,

    h('div.kot__head', {}, [
      h('div.kot__station', { text: station.label }),
      kot.printCount > 1 && !opts.voided
        ? h('div.kot__reprint', { text: `REPRINT ×${kot.printCount}` })
        : null,
    ]),

    h('div.kot__meta', {}, [
      h('div.kot__table', { text: `T ${kot.tableLabel}` }),
      h('div', {}, [
        h('div', { text: kot.code }),
        h('div.kot__time', { text: clockTime(kot.firedAt) }),
      ]),
    ]),

    h('div.kot__meta', { style: { fontSize: '9pt', borderBottom: 'none' } }, [
      h('span', { text: `${kot.covers} covers` }),
      h('span', { text: kot.firedBy || order.captainName }),
    ]),

    ...grouped.flatMap((group) => [
      h('div.kot__course', { text: courseById(group.course.id).label }),
      ...group.items.map((line) => h('div.kot__line', {}, [
        h('div.kot__qty', { text: String(line.qty) }),
        h('div', { style: { flex: '1' } }, [
          h('div.kot__name', { text: line.name }),
          line.seat ? h('div.kot__seat', { text: `SEAT ${line.seat}` }) : null,
          line.modifiers.length
            ? h('div.kot__mods', { text: line.modifiers.map((m) => m.label).join(' · ') })
            : null,
          line.notes ? h('div.kot__note', { text: line.notes }) : null,
        ]),
      ])),
    ]),

    order.notes
      ? h('div.kot__note', { style: { marginTop: '3mm' }, text: order.notes })
      : null,

    h('div.kot__foot', {}, [
      h('span', { text: order.code }),
      h('span', { text: `${pad(new Date(kot.firedAt).getHours())}:${pad(new Date(kot.firedAt).getMinutes())}` }),
    ]),
  ]);
}

/* ------------------------------------------------------------ output --- */

let printArea = null;

function area() {
  if (!printArea) {
    printArea = document.getElementById('printArea')
      || document.body.appendChild(h('div#printArea.printarea', { 'aria-hidden': 'true' }));
  }
  return printArea;
}

/**
 * Send documents to the printer.
 *
 * In this demo the browser's own print dialog stands in for the thermal
 * printers a real install would drive: the guest bill goes to the till printer
 * and each docket to its station. The document that is generated is the same
 * either way — only the transport differs.
 */
export function printDocs(nodes) {
  const host = area();
  host.replaceChildren(...[].concat(nodes));
  // Let the layout settle before handing over, or Safari prints a blank page.
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
        resolve();
      });
    });
  });
}

export function clearPrintArea() {
  area().replaceChildren();
}
