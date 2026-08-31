/**
 * The floor plan.
 *
 * Tables are drawn where they actually stand in the room, because a captain
 * finds table 7 by looking where table 7 is. Status is carried by a stripe down
 * the left edge of each card rather than by flooding the whole card in colour,
 * which keeps a busy room readable in one sweep of the eye.
 */

import { h, fill } from '../core/dom.js';
import { SECTIONS, tablesInSection } from '../data/floor.seed.js';
import { TABLE_STATUS_LABELS } from '../config.js';
import {
  tableView, seatTable, orderForTable, openOrders, transferTable, mergeTables,
  tables as allTables,
} from '../state.js';
import { navigate } from '../core/router.js';
import { toRupees } from '../core/money.js';
import { elapsed, clockTime } from '../core/format.js';
import { setTopbar } from '../ui/shell.js';
import {
  segmented, dialog, confirm, toast, icon, notice,
} from '../ui/components.js';

const STAGES = ['VACANT', 'RESERVED', 'SEATED', 'ORDERED', 'SERVED', 'BILLED'];

let filter = 'all';

export function renderFloor(host) {
  const counts = countByStage();
  const busy = openOrders();

  setTopbar({
    title: 'Floor',
    subtitle: `${busy.length} of ${allTables().length} tables in service · ${busy.reduce((n, o) => n + o.covers, 0)} covers seated`,
    actions: [
      h('button.btn.btn--outline.btn--sm', {
        type: 'button', onclick: () => openTransfer(),
      }, [icon('swap', { size: 16 }), 'Move / merge']),
    ],
  });

  fill(host, h('div.floor', {}, [
    h('div.floor__bar', {}, [
      segmented(
        [{ id: 'all', label: 'Whole room', count: busy.length },
          ...SECTIONS.map((section) => ({
            id: section.id,
            label: section.short,
            count: tablesInSection(section.id).filter((t) => orderForTable(t.id)).length,
          }))],
        filter,
        (id) => { filter = id; renderFloor(host); }
      ),
      h('div.floor__legend', {},
        STAGES.map((stage) => h('span.floor__legend-item', {}, [
          h('span.floor__swatch', { style: { background: swatch(stage) } }),
          `${TABLE_STATUS_LABELS[stage]}${counts[stage] ? ` (${counts[stage]})` : ''}`,
        ]))),
    ]),

    h('div.u-scroll', {},
      (filter === 'all' ? SECTIONS : SECTIONS.filter((s) => s.id === filter))
        .map(renderSection)),
  ]));
}

function renderSection(section) {
  const seats = tablesInSection(section.id);
  return h('div.floor__section', {}, [
    h('h2.plan__section-title', {}, [
      section.label,
      h('span.u-muted', { style: { fontWeight: '400', textTransform: 'none', letterSpacing: '0' }, text: `· ${section.note}` }),
    ]),
    h('div.floor__plan', {},
      // The plan is only as tall as the room it draws. A fixed aspect ratio
      // leaves the bar counter — one row of six stools — floating in half a
      // screen of empty floor, so the height comes from how many distinct rows
      // of tables the section actually has.
      h('div.plan__stage', {
        style: `--rows:${rowBands(seats)}`,
      }, seats.map(renderTable))),
  ]);
}

/**
 * How many distinct rows of tables a section is laid out in.
 *
 * Clustered rather than bucketed: the terrace has tables at y=14 and y=22 that
 * are plainly the same row of the room, and rounding them into fixed bands
 * would split them and stretch the plan to twice the height it needs.
 */
function rowBands(seats) {
  const ys = seats.map((table) => table.y).sort((a, b) => a - b);
  let bands = 1;
  for (let i = 1; i < ys.length; i += 1) {
    if (ys[i] - ys[i - 1] > 15) bands += 1;
  }
  return bands;
}

function renderTable(table) {
  const view = tableView(table);
  const wide = table.shape === 'long' || table.seats >= 8;

  const card = h(
    `button.tbl.tbl--${view.stage}${wide ? '.tbl--wide' : ''}${view.alert ? '.tbl--alert' : ''}`,
    {
      type: 'button',
      onclick: () => openTable(view),
      title: `${table.label} — ${TABLE_STATUS_LABELS[view.stage]}`,
    },
    [
      view.alert ? h('span.tbl__flag', { title: `Food on the pass ${view.waitingMin} min` }) : null,
      h('div.u-row', { style: { gap: '7px', alignItems: 'baseline' } }, [
        h('span.tbl__label', { text: table.label }),
        h('span.tbl__seats', { text: `${table.seats} seats` }),
      ]),
      view.order
        ? h('span.tbl__guest', { text: view.order.guestName || `${view.order.covers} covers` })
        : view.reservation
          ? h('span.tbl__guest', {
            text: view.reservation.name,
            title: `${view.reservation.name} · ${clockTime(view.reservation.at)} · ${view.reservation.covers} covers`,
          })
          : h('span.tbl__seats', { text: TABLE_STATUS_LABELS[view.stage] }),
      h('div.tbl__foot', {}, [
        // Whole rupees on the floor plan. The paise matter on the bill, not
        // at a glance across a room.
        h('span.tbl__value', {
          text: view.value ? `₹${Math.round(toRupees(view.value)).toLocaleString('en-IN')}` : '',
        }),
        h('span.tbl__time', {
          text: view.order ? elapsed(view.order.openedAt)
            : view.reservation ? clockTime(view.reservation.at) : '',
        }),
      ]),
    ]
  );

  return h('div.plan__slot', {
    style: { left: `${table.x}%`, top: `${table.y}%` },
  }, card);
}

const swatch = (stage) => ({
  VACANT: 'var(--line-2)',
  RESERVED: 'var(--info)',
  SEATED: 'var(--gold)',
  ORDERED: 'var(--amber)',
  SERVED: 'var(--sage)',
  BILLED: 'var(--burgundy)',
}[stage]);

function countByStage() {
  const counts = {};
  for (const table of allTables()) {
    const { stage } = tableView(table);
    counts[stage] = (counts[stage] || 0) + 1;
  }
  return counts;
}

/* -------------------------------------------------------------- seat --- */

function openTable(view) {
  if (view.order) { navigate('/order', { table: view.table.id }); return; }
  openSeatDialog(view);
}

function openSeatDialog(view) {
  const reservation = view.reservation;
  const covers = h('input.input', {
    type: 'number', min: '1', max: '20',
    value: String(reservation?.covers || Math.min(2, view.table.seats)),
  });
  const guest = h('input.input', {
    placeholder: 'Guest name (optional)', value: reservation?.name || '',
  });

  dialog({
    title: `Seat table ${view.table.label}`,
    subtitle: `${view.table.seats} seats · ${SECTIONS.find((s) => s.id === view.table.sectionId).label}`,
    size: 'slim',
    body: h('div.grid', { style: { gap: '14px' } }, [
      reservation ? notice(
        `Booked for ${reservation.name} at ${clockTime(reservation.at)} — ${reservation.covers} covers.`
        + (reservation.note ? ` ${reservation.note}` : ''),
        'info'
      ) : null,
      h('div.field', {}, [h('label.field__label', { text: 'Covers' }), covers]),
      h('div.field', {}, [h('label.field__label', { text: 'Guest' }), guest]),
    ]),
    actions: [
      { label: 'Cancel', onclick: (close) => close() },
      {
        label: 'Seat and take order', tone: 'primary', autofocus: true,
        onclick: (close) => {
          seatTable(view.table.id, {
            covers: Number(covers.value) || 2,
            guestName: guest.value.trim(),
            reservationId: reservation?.id,
          });
          close();
          toast(`Table ${view.table.label} seated`, 'good');
          navigate('/order', { table: view.table.id });
        },
      },
    ],
  });
}

/* ---------------------------------------------------- move and merge --- */

function openTransfer() {
  const live = openOrders();
  if (!live.length) {
    toast('Nothing on the floor to move yet', 'warn');
    return;
  }

  const from = h('select.select', {}, live.map((order) =>
    h('option', { value: order.id, text: `Table ${order.tableLabel} · ${order.guestName || `${order.covers} covers`}` })));

  const free = allTables().filter((t) => !orderForTable(t.id));
  const to = h('select.select', {}, [
    h('optgroup', { label: 'Move to an empty table' },
      free.map((table) => h('option', { value: `t:${table.id}`, text: `Table ${table.label} (${table.seats} seats)` }))),
    h('optgroup', { label: 'Merge into another table' },
      live.map((order) => h('option', { value: `m:${order.id}`, text: `Table ${order.tableLabel}` }))),
  ]);

  dialog({
    title: 'Move or merge a table',
    subtitle: 'Dockets, courses and everything already fired travel with the order.',
    size: 'slim',
    body: h('div.grid', { style: { gap: '14px' } }, [
      h('div.field', {}, [h('label.field__label', { text: 'Take' }), from]),
      h('div.field', {}, [h('label.field__label', { text: 'And' }), to]),
    ]),
    actions: [
      { label: 'Cancel', onclick: (close) => close() },
      {
        label: 'Confirm', tone: 'primary',
        onclick: async (close) => {
          const [kind, id] = to.value.split(':');
          if (kind === 't') {
            transferTable(from.value, id);
            toast('Table moved', 'good');
          } else {
            if (id === from.value) { toast('Pick two different tables', 'warn'); return; }
            if (!(await confirm({
              title: 'Merge these tables?',
              message: 'Both orders become one bill. This cannot be undone from the demo.',
              confirmLabel: 'Merge',
              tone: 'primary',
            }))) return;
            mergeTables(from.value, id);
            toast('Tables merged', 'good');
          }
          close();
        },
      },
    ],
  });
}
