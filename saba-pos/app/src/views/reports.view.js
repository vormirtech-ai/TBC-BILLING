/**
 * Reports.
 *
 * The figures come from the till, which holds every bill the restaurant has
 * ever rung up — so a thirty-day report is a real thirty days, not whatever
 * this particular terminal happens to remember.
 *
 * The charts are drawn in CSS grid and inline SVG rather than pulled from a
 * library. A restaurant terminal that must work with no internet is the
 * wrong place for a 300KB dependency, and there are only four chart shapes
 * here: bars, a line, a donut and a proportional table cell.
 */

import { h, fill } from '../core/dom.js';
import { money, money0, compactMoney } from '../shared/money.js';
import { clockTime, shortDate, plural, longDate, shiftDay } from '../shared/format.js';
import { paymentLabel } from '../shared/config.js';
import {
  headline, byHour, byDay, byCategory, byPayment, topItems, delta,
} from '../shared/reports.js';
import {
  reports as fetchReports, dayReport as fetchDayReport, businessDay,
  openOrders, downloadLinks, can, openShift, closeShift, shift as currentShift,
  activity,
} from '../state.js';
import { setTopbar, repaint } from '../ui/shell.js';
import {
  segmented, statTile, empty, icon, chip, notice, dialog, toast, confirm, caps,
} from '../ui/components.js';

const RANGES = [
  { id: 1, label: 'Today' },
  { id: 7, label: '7 days' },
  { id: 30, label: '30 days' },
  { id: 90, label: '90 days' },
];

/**
 * Six tones that separate at a glance and stay inside the restaurant's world:
 * the navy and gold of the mark, the olive of its branch, and three muted
 * companions. No two adjacent segments read as the same colour.
 */
const PALETTE = ['#0C2340', '#9A6213', '#4F6B52', '#6F4A63', '#C49A4A', '#5C7C8A', '#8C5B3F'];

/** Screen-local: the window being looked at and which tab is open. */
const ui = { range: 1, tab: 'sales' };

/** The last payload fetched, so a repaint does not blank the screen. */
let cache = { range: null, report: null, day: null, loading: false, error: null };

export function renderReports(host) {
  setTopbar({
    title: 'Reports',
    subtitle: ui.range === 1
      ? `Trading today · ${plural(openOrders().length, 'table')} still open`
      : `Last ${ui.range} days to ${shortDate(Date.now())}`,
    actions: [
      segmented(RANGES.map((r) => ({ id: r.id, label: r.label })), ui.range, (id) => {
        ui.range = id;
        cache = { ...cache, range: null };
        repaint();
        load();
      }),
    ],
  });

  if (cache.error) {
    fill(host, h('div.view__pad', {}, notice(
      `The till could not produce that report: ${cache.error}`, 'danger', 'warn'
    )));
    return;
  }

  if (!cache.report || cache.range !== ui.range) {
    fill(host, h('div.view__pad', {}, empty('Asking the till…')));
    load();
    return;
  }

  const days = cache.report.days;
  const stats = headline(days);
  const previous = cache.previous ? headline(cache.previous.days) : null;

  fill(host, h('div.view__pad.grid', { style: { gap: '20px' } }, [
    renderHeadline(stats, previous, days),
    segmented([
      { id: 'sales', label: 'Sales', icon: 'reports' },
      { id: 'menu', label: 'Menu performance', icon: 'menu' },
      { id: 'kitchen', label: 'Kitchen', icon: 'kds' },
      { id: 'close', label: 'Day close', icon: 'cash' },
      { id: 'audit', label: 'Audit', icon: 'lock' },
    ], ui.tab, (id) => { ui.tab = id; repaint(); }),

    ui.tab === 'sales' ? renderSales(days, stats) : null,
    ui.tab === 'menu' ? renderMenuPerformance(days) : null,
    ui.tab === 'kitchen' ? renderKitchen() : null,
    ui.tab === 'close' ? renderDayClose() : null,
    ui.tab === 'audit' ? renderAudit() : null,
  ]));
}

/** Fetch the window, and the window before it for the comparison chips. */
async function load() {
  if (cache.loading) return;
  cache.loading = true;
  const range = ui.range;
  const to = businessDay();
  const from = shiftDay(to, -(range - 1));

  try {
    const [report, previous, day] = await Promise.all([
      fetchReports(from, to),
      fetchReports(shiftDay(from, -range), shiftDay(from, -1)).catch(() => null),
      fetchDayReport(to).catch(() => null),
    ]);
    cache = { range, report, previous, day, loading: false, error: null };
  } catch (error) {
    cache = { ...cache, loading: false, error: error.message };
  }
  repaint();
}

/** Called when the replica changes, so today's figures stay live. */
export function invalidateReports() {
  if (ui.range === 1) cache = { ...cache, range: null };
}

/* ---------------------------------------------------------- headline --- */

function renderHeadline(stats, previous, days) {
  const label = days.length === 1 ? 'vs yesterday' : `vs previous ${days.length} days`;
  const vs = (current, key) => (previous ? delta(current, previous[key]) : null);

  return h('div.stats', {}, [
    statTile({
      label: days.length === 1 ? 'Net sales today' : 'Net sales',
      value: money0(stats.total),
      tone: 'primary',
      delta: vs(stats.total, 'total'),
      deltaLabel: label,
    }),
    statTile({
      label: 'Covers',
      value: String(stats.covers),
      note: `${plural(stats.checks, 'bill')} · ${money0(stats.perCover)} per cover`,
      delta: vs(stats.covers, 'covers'),
      deltaLabel: label,
    }),
    statTile({
      label: 'Average check',
      value: money0(stats.avgCheck),
      tone: 'olive',
      delta: vs(stats.avgCheck, 'avgCheck'),
      deltaLabel: label,
    }),
    statTile({
      label: 'Table turn',
      value: `${stats.avgTurnMin} min`,
      tone: 'info',
      note: 'Seated to settled',
    }),
    statTile({
      label: 'Service charge',
      value: money0(stats.serviceCharge),
      note: `Gratuity ${money0(stats.tips)}`,
    }),
    statTile({
      label: 'Discounts given',
      value: money0(stats.discount),
      note: stats.total
        ? `${((stats.discount / (stats.total || 1)) * 100).toFixed(1)}% of sales`
        : '—',
    }),
  ]);
}

/* ------------------------------------------------------------- sales --- */

function renderSales(days, stats) {
  const hours = byHour(days);
  const payments = byPayment(days);
  const categories = byCategory(days);
  const trend = byDay(days);
  const staff = cache.day?.staff || [];

  return h('div.grid', { style: { gap: '16px' } }, [
    h('div.grid', {
      style: { gap: '16px', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)' },
    }, [
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

    days.length > 1 ? card('Daily sales', `${days.length} days`, trendLine(trend)) : null,

    h('div.grid', {
      style: { gap: '16px', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' },
    }, [
      card('Sales by section of the carte', null, donut(
        categories.map((c, i) => ({
          label: c.label,
          value: c.value,
          note: plural(c.qty, 'dish', 'dishes'),
          colour: PALETTE[i % PALETTE.length],
        }))
      )),
      card(
        'By captain',
        'Credited to whoever opened the table',
        staff.length
          ? table(
            ['Captain', 'Bills', 'Covers', 'Sales', 'Avg'],
            staff.map((row) => [
              row.name,
              { num: String(row.bills) },
              { num: String(row.covers) },
              { num: money0(row.total) },
              { num: money0(row.avgCheck) },
            ])
          )
          : empty('Nothing settled yet today')
      ),
    ]),

    can('export') ? exportCard() : null,
  ]);
}

function exportCard() {
  const to = businessDay();
  const from = shiftDay(to, -(ui.range - 1));
  return card('Take the figures away', 'Opens in a spreadsheet', h('div.u-row.u-wrap', {
    style: { gap: '8px' },
  }, [
    h('a.btn.btn--outline.btn--sm', {
      href: downloadLinks.sales(from, to), download: '',
    }, [icon('reports', { size: 16 }), `Sales · ${from === to ? 'today' : `${from} to ${to}`}`]),
    h('a.btn.btn--outline.btn--sm', {
      href: downloadLinks.gst(from, to), download: '',
    }, [icon('bill', { size: 16 }), 'GST summary']),
  ]));
}

function hourBars(hours) {
  if (!hours.length) return empty('Nothing rung up yet', 'Settle a table and it appears here.');
  const peak = Math.max(...hours.map((row) => row.total));
  const peakHour = hours.find((r) => r.total === peak);
  return h('div', {}, [
    h('div.bars', {
      style: { gridTemplateColumns: `repeat(${hours.length}, minmax(0,1fr))` },
    }, hours.map((row) => h(`div.bar${row.total === peak ? '.bar--peak' : ''}`, {
      title: `${clockTime(new Date().setHours(row.hour, 0))} — ${money(row.total)}`
        + ` over ${plural(row.checks, 'bill')}`,
    }, [
      h('div.bar__track', {},
        h('div.bar__fill', { style: { height: `${Math.max(2, (row.total / peak) * 100)}%` } })),
      h('div.bar__label', { text: String(row.hour) }),
    ]))),
    h('p.stat__note', {
      style: { marginTop: '8px' },
      text: `Peak hour ${clockTime(new Date().setHours(peakHour.hour, 0))} · ${money0(peak)}`,
    }),
  ]);
}

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
  area.setAttribute('d', `M${coords[0][0]},${height} `
    + coords.map(([x, y]) => `L${x},${y}`).join(' ')
    + ` L${coords.at(-1)[0]},${height} Z`);
  area.setAttribute('fill', 'rgba(154,98,19,.14)');

  const line = document.createElementNS(ns, 'polyline');
  line.setAttribute('points', coords.map(([x, y]) => `${x},${y}`).join(' '));
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', '#9A6213');
  line.setAttribute('stroke-width', '2.5');
  line.setAttribute('stroke-linejoin', 'round');
  line.setAttribute('vector-effect', 'non-scaling-stroke');

  svg.append(area, line);

  // The last point is today, usually still in progress — mark it, so nobody
  // reads a half-finished service as a collapse in trade.
  const dot = document.createElementNS(ns, 'circle');
  dot.setAttribute('cx', coords.at(-1)[0]);
  dot.setAttribute('cy', coords.at(-1)[1]);
  dot.setAttribute('r', '4');
  dot.setAttribute('fill', '#0C2340');
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
    // A hair of a gap keeps adjacent tones from reading as one segment.
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

/* -------------------------------------------------------------- menu --- */

function renderMenuPerformance(days) {
  const items = topItems(days, 20);
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
        { num: money0(item.value) },
        {
          node: h('div.meter', {},
            h('div.meter__fill', { style: { width: `${(item.value / best) * 100}%` } })),
        },
        { num: money0(item.cost) },
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

/* ----------------------------------------------------------- kitchen --- */

function renderKitchen() {
  const rows = cache.day?.stations || [];
  const live = rows.reduce((n, r) => n + r.open, 0);

  return h('div.grid', { style: { gap: '16px' } }, [
    notice(
      'Timings are measured from the moment a docket was fired to the moment '
      + 'the section bumped it as ready. This is today’s service — a live '
      + 'pass report, not a historical one.',
      'info'
    ),
    card(
      `Station performance · ${plural(live, 'docket')} still cooking`,
      null,
      rows.length ? table(
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
                class: row.onTimePct >= 80 ? 'meter__fill--olive' : 'meter__fill--danger',
                style: { width: `${row.onTimePct}%` },
              })),
          },
        ])
      ) : empty('Nothing has gone to the kitchen today')
    ),
  ]);
}

/* --------------------------------------------------------- day close --- */

/**
 * The Z report — what the till says happened, and what is actually in the
 * drawer. This is the number a restaurant closes on, so the variance is
 * stated plainly rather than buried.
 */
function renderDayClose() {
  const day = cache.day;
  if (!day) return card('Day close', null, empty('Asking the till…'));

  const shift = currentShift();
  const cash = day.cash;

  return h('div.grid', { style: { gap: '16px' } }, [
    day.stillOpen.length
      ? notice(
        `${plural(day.stillOpen.length, 'table')} still open: `
        + `${day.stillOpen.map((t) => t.table).join(', ')}. `
        + 'Settle or transfer them before closing the day.',
        'warn', 'warn'
      )
      : null,

    h('div.grid', { style: { gap: '16px', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' } }, [
      card('Takings by tender', 'Only cash should be in the drawer', table(
        ['Tender', 'Bills', 'Amount', 'In the drawer'],
        day.tenders.map((t) => [
          t.label,
          { num: String(t.count) },
          { num: money(t.paise) },
          { node: t.countsToDrawer ? chip('Yes', 'olive') : chip('No', 'outline') },
        ])
      )),

      card('The drawer', shift
        ? `Opened ${clockTime(shift.opened_at)} by ${shift.opened_by}`
        : 'No shift has been opened today', h('div.grid', { style: { gap: '10px' } }, [
        drawerRow('Opening float', money(cash.floatPaise)),
        drawerRow('Cash taken', money(cash.takenPaise)),
        drawerRow('Should be in the drawer', money(cash.expectedPaise), 'grand'),
        cash.countedPaise !== null ? drawerRow('Counted', money(cash.countedPaise)) : null,
        cash.variancePaise !== null
          ? h('div.totals__row', {}, [
            h('span', { text: 'Variance' }),
            h('span', {
              class: cash.variancePaise === 0 ? 'delta delta--up'
                : 'delta delta--down',
              text: cash.variancePaise === 0
                ? 'exact'
                : `${cash.variancePaise > 0 ? 'over' : 'short'} ${money(Math.abs(cash.variancePaise))}`,
            }),
          ])
          : null,

        can('shift') ? h('div.u-row', { style: { gap: '8px', marginTop: '6px' } }, [
          shift
            ? h('button.btn.btn--primary.btn--sm.u-grow', {
              type: 'button', onclick: () => openCashUp(day),
            }, [icon('cash', { size: 16 }), 'Count the drawer and close'])
            : h('button.btn.btn--outline.btn--sm.u-grow', {
              type: 'button', onclick: openFloat,
            }, [icon('cash', { size: 16 }), 'Open the till']),
        ]) : null,
      ])),
    ]),

    card('The day in full', longDate(Date.now()), table(
      ['', 'Amount'],
      [
        ['Items', { num: money(day.totals.gross) }],
        ['Compliments', { num: `− ${money(day.totals.comps)}` }],
        ['Discounts', { num: `− ${money(day.totals.discount)}` }],
        ['Net of food and drink', { num: money(day.totals.net) }],
        ['Service charge', { num: money(day.totals.serviceCharge) }],
        ...day.taxes.map((t) => [`${t.label} @ ${(t.bps / 100).toFixed(2)}%`, { num: money(t.paise) }]),
        ['Gratuity', { num: money(day.totals.tips) }],
        ['Round off', { num: money(day.totals.roundOff) }],
        ['Total taken', { num: money(day.totals.total) }],
      ]
    )),

    day.exceptions.length
      ? card('Voids, comps and discounts', 'Everything that moved money away', table(
        ['Time', 'Type', 'Table', 'Detail', 'Reason', 'Authorised', 'Value'],
        day.exceptions.map((row) => [
          clockTime(row.at),
          {
            node: chip(row.kind,
              row.kind === 'Void' ? 'danger' : row.kind === 'Comp' ? 'olive' : 'gold'),
          },
          row.table,
          row.detail,
          row.reason || '—',
          row.by || '—',
          { num: money(row.value) },
        ])
      ))
      : null,
  ]);
}

const drawerRow = (label, value, kind) =>
  h(`div.totals__row${kind ? `.totals__row--${kind}` : ''}`, {}, [
    h('span', { text: label }),
    h('span.u-num', { text: value }),
  ]);

function openFloat() {
  const input = h('input.input', { type: 'number', step: '0.01', min: '0', value: '2000.00' });
  dialog({
    title: 'Open the till',
    subtitle: 'How much cash is in the drawer to start with?',
    size: 'slim',
    body: h('div.field', {}, [h('label.field__label', { text: 'Opening float' }), input]),
    actions: [
      { label: 'Cancel', onclick: (close) => close() },
      {
        label: 'Open',
        tone: 'primary',
        onclick: (close) => {
          close();
          openShift(Math.round(Number(input.value) * 100))
            .then(() => { cache.range = null; repaint(); toast('Till opened', 'good'); })
            .catch((error) => toast(error.message, 'bad', 5000));
        },
      },
    ],
  });
}

function openCashUp(day) {
  const expected = day.cash.expectedPaise;
  const input = h('input.input', {
    type: 'number', step: '0.01', min: '0', value: (expected / 100).toFixed(2),
    style: { fontSize: '19px', fontWeight: '600', textAlign: 'right' },
  });
  const variance = h('p.setting__hint');

  const paint = () => {
    const counted = Math.round(Number(input.value) * 100);
    const diff = counted - expected;
    variance.textContent = diff === 0
      ? 'That matches exactly.'
      : `${diff > 0 ? 'Over' : 'Short'} by ${money(Math.abs(diff))}.`;
  };
  input.addEventListener('input', paint);
  paint();

  const note = h('textarea.textarea', { placeholder: 'Anything worth recording about tonight' });

  dialog({
    title: 'Count the drawer',
    subtitle: `The till expects ${money(expected)}`,
    size: 'slim',
    body: h('div.grid', { style: { gap: '14px' } }, [
      day.stillOpen.length
        ? notice(
          `${plural(day.stillOpen.length, 'table')} are still open. Closing now `
          + 'records the day as it stands; those bills will land on tomorrow.',
          'warn', 'warn'
        )
        : null,
      h('div.field', {}, [h('label.field__label', { text: 'Counted' }), input]),
      variance,
      h('div.field', {}, [h('label.field__label', { text: 'Note' }), note]),
    ]),
    actions: [
      { label: 'Cancel', onclick: (close) => close() },
      {
        label: 'Close the till',
        tone: 'primary',
        onclick: async (close) => {
          if (!(await confirm({
            title: 'Close the till for today?',
            message: 'The shift is recorded with the variance. This cannot be undone.',
            confirmLabel: 'Close',
          }))) return;
          close();
          closeShift(Math.round(Number(input.value) * 100), note.value.trim())
            .then(() => { cache.range = null; repaint(); toast('Till closed', 'good'); })
            .catch((error) => toast(error.message, 'bad', 5000));
        },
      },
    ],
  });
}

/* ------------------------------------------------------------ audit --- */

function renderAudit() {
  const entries = cache.day?.exceptions || [];
  const log = activity();
  return h('div.grid', { style: { gap: '16px' } }, [
    card(
      'Voids, comps and discounts',
      'Everything that moved money away from the restaurant today',
      entries.length
        ? table(
          ['Time', 'Type', 'Table', 'Detail', 'Reason', 'Authorised', 'Value'],
          entries.map((row) => [
            clockTime(row.at),
            {
              node: chip(row.kind,
                row.kind === 'Void' ? 'danger' : row.kind === 'Comp' ? 'olive' : 'gold'),
            },
            row.table,
            row.detail,
            row.reason || '—',
            row.by || '—',
            { num: money(row.value) },
          ])
        )
        : empty('Nothing to report', 'No voids, comps or discounts today.')
    ),
    card(
      'Activity log',
      'Every action a manager might later be asked to explain',
      log.length
        ? h('div.list', {}, log.slice(0, 60).map((entry) => h('div.row-card', {}, [
          h('span.row-card__time', { text: clockTime(entry.at) }),
          h('div.u-grow', {}, [
            h('div.row-card__name', { text: entry.message }),
            h('div.row-card__note', { text: `${entry.actor} · ${entry.kind}` }),
          ]),
        ])))
        : empty('Nothing logged yet today')
    ),
  ]);
}

/* -------------------------------------------------------- primitives --- */

function card(title, subtitle, body) {
  return h('section.card', {}, [
    h('div.card__head', {}, h('div.u-grow', {}, [
      h('h2.card__title', { text: title }),
      subtitle ? h('p.stat__note', { text: subtitle }) : null,
    ])),
    h('div.card__body', {}, body),
  ]);
}

/** Cells may be a string, `{ num }` for a figure, or `{ node }`. */
function table(headers, rows) {
  return h('div', { style: { overflowX: 'auto' } }, h('table.table', {}, [
    h('thead', {}, h('tr', {}, headers.map((label, i) =>
      h(`th${i > 1 ? '.num' : ''}`, { text: label })))),
    h('tbody', {}, rows.map((cells) => h('tr', {}, cells.map((cell) => {
      if (cell && typeof cell === 'object' && cell.node) return h('td', {}, cell.node);
      if (cell && typeof cell === 'object') return h('td.num', { text: cell.num });
      return h('td', { text: String(cell ?? '') });
    })))),
  ]));
}
