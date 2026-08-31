/**
 * Reports.
 *
 * Every chart here is drawn from the same order records the bills came from,
 * on demand — nothing is cached, so a report can never disagree with the till.
 *
 * The charts are hand-drawn in CSS grid and inline SVG rather than pulled from
 * a charting library. A restaurant terminal that must work with no network is
 * the wrong place for a 300KB dependency, and there are only four chart shapes
 * here: bars, a line, a donut and a proportional table cell.
 */

import { h, fill } from '../core/dom.js';
import { money, money0, compactMoney } from '../core/money.js';
import { clockTime, shortDate, plural } from '../core/format.js';
import { paymentLabel } from '../config.js';
import {
  daysInRange, headline, byHour, byDay, byCategory, byPayment, topItems,
  stationPerformance, exceptions, byStaff, previousWindow, delta, } from '../domain/reports.js';
import { getState, openOrders, activity } from '../state.js';
import { setTopbar } from '../ui/shell.js';
import { segmented, statTile, empty, chip, notice } from '../ui/components.js';

const RANGES = [
  { id: 1, label: 'Today' },
  { id: 7, label: '7 days' },
  { id: 30, label: '30 days' },
];

let range = 1;
let tab = 'sales';

const PALETTE = ['#7e1b22', '#a9803f', '#4f6b52', '#3c5a78', '#6f4a63', '#c9a96a', '#8c6239'];

export function renderReports(host) {
  const state = getState();
  const days = daysInRange(state, range);
  const stats = headline(days);
  const before = previousWindow(state, range);
  const previous = before.length === range ? headline(before) : null;

  setTopbar({
    title: 'Reports',
    subtitle: range === 1
      ? `Trading today · ${plural(openOrders().length, 'table')} still open`
      : `Last ${range} days to ${shortDate(Date.now())}`,
    actions: [
      segmented(RANGES.map((r) => ({ id: r.id, label: r.label })), range, (id) => {
        range = id; renderReports(host);
      }),
    ],
  });

  fill(host, h('div.view__pad.grid', { style: { gap: '20px' } }, [
    renderHeadline(stats, previous, days),
    segmented([
      { id: 'sales', label: 'Sales', icon: 'reports' },
      { id: 'menu', label: 'Menu performance', icon: 'menu' },
      { id: 'kitchen', label: 'Kitchen', icon: 'kds' },
      { id: 'audit', label: 'Audit', icon: 'lock' },
    ], tab, (id) => { tab = id; renderReports(host); }),
    tab === 'sales' ? renderSales(days, stats) : null,
    tab === 'menu' ? renderMenuPerformance(days) : null,
    tab === 'kitchen' ? renderKitchen() : null,
    tab === 'audit' ? renderAudit(state) : null,
  ]));
}

/* ---------------------------------------------------------- headline --- */

function renderHeadline(stats, previous, days) {
  const vs = (current, key) => (previous ? delta(current, previous[key]) : null);
  const label = days.length === 1 ? 'vs yesterday' : `vs previous ${days.length} days`;
  return h('div.stats', {}, [
    statTile({
      label: days.length === 1 ? 'Net sales today' : 'Net sales', value: money0(stats.total), tone: 'primary',
      delta: vs(stats.total, 'total'), deltaLabel: label,
    }),
    statTile({
      label: 'Covers', value: String(stats.covers),
      note: `${plural(stats.checks, 'bill')} · ${money0(stats.perCover)} per cover`,
      delta: vs(stats.covers, 'covers'), deltaLabel: label,
    }),
    statTile({
      label: 'Average check', value: money0(stats.avgCheck), tone: 'sage',
      delta: vs(stats.avgCheck, 'avgCheck'), deltaLabel: label,
    }),
    statTile({
      label: 'Table turn', value: `${stats.avgTurnMin} min`, tone: 'info',
      note: 'Seated to settled',
    }),
    statTile({
      label: 'Service charge', value: money0(stats.serviceCharge),
      note: `Gratuity ${money0(stats.tips)}`,
    }),
    statTile({
      label: 'Discounts given', value: money0(stats.discount),
      note: stats.total ? `${((stats.discount / (stats.total || 1)) * 100).toFixed(1)}% of sales` : '—',
    }),
  ]);
}

/* ------------------------------------------------------------- sales --- */

function renderSales(days, stats) {
  const hours = byHour(days);
  const payments = byPayment(days);
  const categories = byCategory(days);
  const staff = byStaff(getState());
  const trend = byDay(days);

  return h('div.grid', { style: { gap: '16px' } }, [
    h('div.grid', { style: { gap: '16px', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)' } }, [
      card('Trading pattern', 'When the room actually fills', hourBars(hours)),
      card('How guests paid', `${plural(stats.checks, 'bill')} settled`, donut(
        payments.map((p, i) => ({
          label: paymentLabel(p.method),
          value: p.total,
          note: plural(p.count, 'bill'),
          colour: PALETTE[i % PALETTE.length],
        }))
      )),
    ]),

    days.length > 1
      ? card('Daily sales', `${days.length} days`, trendLine(trend))
      : null,

    h('div.grid', { style: { gap: '16px', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' } }, [
      card('Sales by section of the carte', null, donut(
        categories.map((c, i) => ({
          label: c.label, value: c.value, note: plural(c.qty, 'dish', 'dishes'),
          colour: PALETTE[i % PALETTE.length],
        }))
      )),
      card(
        'By captain',
        'Credited to whoever opened the table. Includes tables still open, so '
        + 'these run ahead of settled sales.',
        table(
          ['Captain', 'Bills', 'Covers', 'Sales', 'Avg'],
          staff.map((row) => [
            row.name,
            { num: String(row.checks) },
            { num: String(row.covers) },
            { num: money0(row.total) },
            { num: money0(row.avgCheck) },
          ])
        )
      ),
    ]),
  ]);
}

function hourBars(hours) {
  if (!hours.length) return empty('Nothing rung up yet', 'Settle a table and it appears here.');
  const peak = Math.max(...hours.map((row) => row.total));
  return h('div', {}, [
    h('div.bars', { style: { gridTemplateColumns: `repeat(${hours.length}, minmax(0,1fr))` } },
      hours.map((row) => h(`div.bar${row.total === peak ? '.bar--peak' : ''}`, {
        title: `${clockTime(new Date().setHours(row.hour, 0))} — ${money(row.total)} over ${plural(row.checks, 'bill')}`,
      }, [
        h('div.bar__track', {},
          h('div.bar__fill', { style: { height: `${Math.max(2, (row.total / peak) * 100)}%` } })),
        h('div.bar__label', { text: `${row.hour}` }),
      ]))),
    h('p.stat__note', {
      style: { marginTop: '8px' },
      text: `Peak hour ${peak ? clockTime(new Date().setHours(hours.find((r) => r.total === peak).hour, 0)) : '—'} · ${money0(peak)}`,
    }),
  ]);
}

/** Sparkline for the daily trend, drawn as one polyline with a filled area. */
function trendLine(points) {
  if (points.length < 2) return empty('Not enough days yet');
  const width = 900;
  const height = 150;
  const pad = 6;
  const max = Math.max(...points.map((p) => p.total)) || 1;
  const step = (width - pad * 2) / (points.length - 1);
  const coords = points.map((p, i) => [
    pad + i * step,
    height - pad - (p.total / max) * (height - pad * 2),
  ]);

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'trend');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');

  const area = document.createElementNS(ns, 'path');
  area.setAttribute('d',
    `M${coords[0][0]},${height} ${coords.map(([x, y]) => `L${x},${y}`).join(' ')} L${coords.at(-1)[0]},${height} Z`);
  area.setAttribute('fill', 'rgba(169,128,63,.16)');

  const line = document.createElementNS(ns, 'polyline');
  line.setAttribute('points', coords.map(([x, y]) => `${x},${y}`).join(' '));
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', '#a9803f');
  line.setAttribute('stroke-width', '2.5');
  line.setAttribute('stroke-linejoin', 'round');
  line.setAttribute('vector-effect', 'non-scaling-stroke');

  svg.append(area, line);

  // The last point is today, and today is usually still in progress — mark it
  // so nobody reads a half-finished service as a collapse in trade.
  const dot = document.createElementNS(ns, 'circle');
  dot.setAttribute('cx', coords.at(-1)[0]);
  dot.setAttribute('cy', coords.at(-1)[1]);
  dot.setAttribute('r', '4');
  dot.setAttribute('fill', '#7e1b22');
  svg.appendChild(dot);

  return h('div', {}, [
    svg,
    h('div.u-row', { style: { justifyContent: 'space-between', marginTop: '6px' } }, [
      h('span.stat__note', { text: shortDate(points[0].at) }),
      h('span.stat__note', { text: `Best ${money0(max)}` }),
      h('span.stat__note', { text: `${shortDate(points.at(-1).at)} · in progress` }),
    ]),
  ]);
}

/** A donut drawn as dash-offset arcs on one circle — no library, no canvas. */
function donut(slices) {
  const live = slices.filter((s) => s.value > 0);
  if (!live.length) return empty('Nothing to show yet');

  const total = live.reduce((n, s) => n + s.value, 0);
  const ns = 'http://www.w3.org/2000/svg';
  const size = 148;
  const radius = 58;
  const circumference = 2 * Math.PI * radius;

  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'donut__svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);

  let offset = 0;
  for (const slice of live) {
    const arc = document.createElementNS(ns, 'circle');
    const length = (slice.value / total) * circumference;
    arc.setAttribute('cx', size / 2);
    arc.setAttribute('cy', size / 2);
    arc.setAttribute('r', radius);
    arc.setAttribute('fill', 'none');
    arc.setAttribute('stroke', slice.colour);
    arc.setAttribute('stroke-width', '20');
    // A 1px gap between segments keeps adjacent tones from reading as one.
    arc.setAttribute('stroke-dasharray', `${Math.max(0, length - 1.5)} ${circumference}`);
    arc.setAttribute('stroke-dashoffset', -offset);
    arc.setAttribute('transform', `rotate(-90 ${size / 2} ${size / 2})`);
    svg.appendChild(arc);
    offset += length;
  }

  const label = document.createElementNS(ns, 'text');
  label.setAttribute('x', size / 2);
  label.setAttribute('y', size / 2 + 5);
  label.setAttribute('text-anchor', 'middle');
  label.setAttribute('font-family', 'var(--serif)');
  label.setAttribute('font-size', '17');
  label.setAttribute('font-weight', '600');
  label.setAttribute('fill', 'var(--ink)');
  label.textContent = compactMoney(total);
  svg.appendChild(label);

  return h('div.donut', {}, [
    svg,
    h('div.donut__key', {}, live.map((slice) => h('div.donut__row', {}, [
      h('span.donut__swatch', { style: { background: slice.colour } }),
      h('span.u-grow', {}, [
        slice.label,
        slice.note ? h('span.u-muted', { text: ` · ${slice.note}` }) : null,
      ]),
      h('span.donut__value', { text: `${Math.round((slice.value / total) * 100)}%` }),
    ]))),
  ]);
}

/* ------------------------------------------------------------- menu --- */

function renderMenuPerformance(days) {
  const items = topItems(days, 15);
  if (!items.length) return card('Menu performance', null, empty('Nothing sold yet'));
  const best = items[0].value;

  return card(
    'Menu performance',
    'Ranked by revenue, with the gross margin each dish carries',
    table(
      ['', 'Dish', 'Sold', 'Revenue', 'Share', 'Food cost', 'Margin'],
      items.map((item, i) => [
        { node: h('span.table__rank', { text: String(i + 1) }) },
        item.name,
        { num: String(item.qty) },
        { num: money(item.value) },
        {
          node: h('div.meter', {}, h('div.meter__fill', {
            style: { width: `${(item.value / best) * 100}%` },
          })),
        },
        { num: money(item.cost) },
        {
          node: h('span', {
            class: item.marginPct >= 65 ? 'delta delta--up' : 'delta',
            text: `${item.marginPct.toFixed(0)}%`,
          }),
        },
      ])
    )
  );
}

/* ---------------------------------------------------------- kitchen --- */

function renderKitchen() {
  const rows = stationPerformance(openOrders());
  const live = rows.reduce((n, r) => n + r.open, 0);

  return h('div.grid', { style: { gap: '16px' } }, [
    notice(
      'Timings are measured from the moment a docket was fired to the moment the '
      + 'section bumped it as ready. Only tonight’s service is counted — this is a '
      + 'live pass report, not a historical one.',
      'info'
    ),
    card(
      `Station performance · ${plural(live, 'docket')} still cooking`,
      null,
      table(
        ['Station', 'Target', 'Average', 'Done', 'Cooking', 'On time'],
        rows.map((row) => [
          row.label,
          { num: `${row.sla} min` },
          {
            node: h('span', {
              class: row.avgMinutes > row.sla ? 'delta delta--down' : 'delta delta--up',
              text: row.tickets ? `${row.avgMinutes} min` : '—',
            }),
          },
          { num: String(row.tickets) },
          { num: row.open ? `${row.open}${row.late ? ` (${row.late} late)` : ''}` : '—' },
          {
            node: h('div.meter', { title: `${row.onTimePct}%` },
              h('div.meter__fill', {
                class: row.onTimePct >= 80 ? 'meter__fill--sage' : 'meter__fill--danger',
                style: { width: `${row.onTimePct}%` },
              })),
          },
        ])
      )
    ),
  ]);
}

/* ------------------------------------------------------------ audit --- */

function renderAudit(state) {
  const rows = exceptions([...state.orders, ...state.settled]);
  const log = activity();

  return h('div.grid', { style: { gap: '16px' } }, [
    card(
      'Voids, comps and discounts',
      'Everything that moved money away from the restaurant tonight',
      rows.length
        ? table(
          ['Time', 'Type', 'Table', 'Detail', 'Reason', 'Authorised', 'Value'],
          rows.map((row) => [
            clockTime(row.at),
            { node: chip(row.kind, row.kind === 'Void' ? 'danger' : row.kind === 'Comp' ? 'sage' : 'gold') },
            row.table,
            row.detail,
            row.reason || '—',
            row.by || '—',
            { num: money(row.value) },
          ])
        )
        : empty('Nothing to report', 'No voids, comps or discounts tonight.')
    ),

    card(
      'Activity log',
      'Every action that a manager might later be asked to explain',
      h('div.list', {}, log.slice(0, 40).map((entry) => h('div.row-card', {}, [
        h('span.row-card__time', { text: clockTime(entry.at) }),
        h('div.u-grow', {}, [
          h('div.row-card__name', { text: entry.message }),
          h('div.row-card__note', { text: `${entry.by} · ${entry.kind}` }),
        ]),
      ])))
    ),
  ]);
}

/* -------------------------------------------------------- primitives --- */

function card(title, subtitle, body) {
  return h('section.card', {}, [
    h('div.card__head', {}, [
      h('div.u-grow', {}, [
        h('h2.card__title', { text: title }),
        subtitle ? h('p.stat__note', { text: subtitle }) : null,
      ]),
    ]),
    h('div.card__body', {}, body),
  ]);
}

/** cells may be a string, { num } for right-aligned figures, or { node }. */
function table(headers, rows) {
  return h('div', { style: { overflowX: 'auto' } },
    h('table.table', {}, [
      h('thead', {}, h('tr', {}, headers.map((label, i) =>
        h(`th${i > 1 ? '.num' : ''}`, { text: label })))),
      h('tbody', {}, rows.map((cells) =>
        h('tr', {}, cells.map((cell) => {
          if (cell && typeof cell === 'object' && cell.node) return h('td', {}, cell.node);
          if (cell && typeof cell === 'object') return h('td.num', { text: cell.num });
          return h('td', { text: String(cell ?? '') });
        })))),
    ]));
}
