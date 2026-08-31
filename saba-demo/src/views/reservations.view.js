/**
 * The book.
 *
 * A reservation's only job in a billing system is to put the right party on the
 * right table with the right notes, so this screen is deliberately small: the
 * evening in time order, and one tap to seat a booking straight into an order.
 */

import { h, fill } from '../core/dom.js';
import { clockTime, longDate, plural, minutesSince } from '../core/format.js';
import {
  reservations, addReservation, setReservationStatus, dropReservation,
  orderForTable, seatTable, tables, tableById,
} from '../state.js';
import { navigate } from '../core/router.js';
import { setTopbar } from '../ui/shell.js';
import {
  dialog, confirm, toast, icon, empty, chip, segmented, } from '../ui/components.js';

const STATUS_TONE = {
  CONFIRMED: 'gold', SEATED: 'sage', CANCELLED: 'danger', NO_SHOW: 'danger',
};
const STATUS_LABEL = {
  CONFIRMED: 'Booked', SEATED: 'Seated', CANCELLED: 'Cancelled', NO_SHOW: 'No show',
};

let filter = 'all';

export function renderReservations(host) {
  const all = [...reservations()].sort((a, b) => a.at - b.at);
  const shown = filter === 'all' ? all : all.filter((r) => r.status === filter);
  const covers = all.filter((r) => r.status !== 'CANCELLED').reduce((n, r) => n + r.covers, 0);

  setTopbar({
    title: 'Reservations',
    subtitle: `${longDate(Date.now())} · ${plural(all.length, 'booking')} · ${covers} covers booked`,
    actions: [
      h('button.btn.btn--primary.btn--sm', {
        type: 'button', onclick: () => openBooking(host),
      }, [icon('plus', { size: 16 }), 'New booking']),
    ],
  });

  fill(host, h('div.view__pad.grid', { style: { gap: '16px' } }, [
    segmented([
      { id: 'all', label: 'All', count: all.length },
      { id: 'CONFIRMED', label: 'Expected', count: all.filter((r) => r.status === 'CONFIRMED').length },
      { id: 'SEATED', label: 'Seated', count: all.filter((r) => r.status === 'SEATED').length },
    ], filter, (id) => { filter = id; renderReservations(host); }),

    shown.length
      ? h('div.list', {}, shown.map((row) => renderRow(host, row)))
      : empty('Nothing in the book', 'Add a booking and it will appear here in time order.'),
  ]));
}

function renderRow(host, row) {
  const table = row.tableId ? tableById(row.tableId) : null;
  const occupied = table && orderForTable(table.id);
  const late = row.status === 'CONFIRMED' && row.at < Date.now();

  return h('div.row-card', {}, [
    h('span.row-card__time', { text: clockTime(row.at) }),

    h('div.u-grow', {}, [
      h('div.row-card__name', { text: `${row.name} · ${plural(row.covers, 'cover')}` }),
      h('div.row-card__note', {
        text: [
          table ? `Table ${table.label}` : 'No table assigned',
          row.phone,
          row.note,
        ].filter(Boolean).join(' · '),
      }),
    ]),

    late ? chip(`${minutesSince(row.at)} min late`, 'danger', { dot: true }) : null,
    chip(STATUS_LABEL[row.status] || row.status, STATUS_TONE[row.status] || 'outline'),

    h('div.row-card__actions', {}, [
      row.status === 'CONFIRMED' ? h('button.btn.btn--primary.btn--sm', {
        type: 'button',
        text: occupied ? 'Table busy' : 'Seat now',
        disabled: !table || !!occupied,
        onclick: () => {
          seatTable(table.id, {
            covers: row.covers, guestName: row.name, reservationId: row.id,
          });
          setReservationStatus(row.id, 'SEATED');
          toast(`${row.name} seated on table ${table.label}`, 'good');
          navigate('/order', { table: table.id });
        },
      }) : null,

      h('button.btn.btn--ghost.btn--icon.btn--sm', {
        type: 'button', 'aria-label': 'Edit', onclick: () => openBooking(host, row),
      }, icon('edit', { size: 16 })),

      h('button.btn.btn--ghost.btn--icon.btn--sm', {
        type: 'button', 'aria-label': 'Remove',
        onclick: async () => {
          if (await confirm({
            title: `Remove ${row.name}?`,
            message: 'The booking is deleted from tonight’s book.',
            confirmLabel: 'Remove', tone: 'danger',
          })) { dropReservation(row.id); renderReservations(host); }
        },
      }, icon('trash', { size: 16 })),
    ]),
  ]);
}

function openBooking(host, existing) {
  const now = new Date();
  const name = h('input.input', { value: existing?.name || '', placeholder: 'Guest name' });
  const covers = h('input.input', { type: 'number', min: '1', value: String(existing?.covers || 2) });
  const time = h('input.input', {
    type: 'time',
    value: existing
      ? new Date(existing.at).toTimeString().slice(0, 5)
      : `${String(Math.min(22, now.getHours() + 1)).padStart(2, '0')}:00`,
  });
  const phone = h('input.input', { type: 'tel', value: existing?.phone || '', placeholder: '+91' });
  const note = h('input.input', {
    value: existing?.note || '',
    placeholder: 'Allergies, celebration, seating preference…',
  });

  const table = h('select.select', {}, [
    h('option', { value: '', text: 'No table yet' }),
    ...tables().map((t) => h('option', {
      value: t.id,
      text: `Table ${t.label} · ${t.seats} seats${orderForTable(t.id) ? ' (in use)' : ''}`,
      selected: existing?.tableId === t.id,
    })),
  ]);

  dialog({
    title: existing ? `Edit ${existing.name}` : 'New booking',
    size: 'slim',
    body: h('div.grid', { style: { gap: '13px' } }, [
      h('div.field', {}, [h('label.field__label', { text: 'Guest' }), name]),
      h('div.grid', { style: { gap: '13px', gridTemplateColumns: '1fr 1fr' } }, [
        h('div.field', {}, [h('label.field__label', { text: 'Covers' }), covers]),
        h('div.field', {}, [h('label.field__label', { text: 'Time' }), time]),
      ]),
      h('div.field', {}, [h('label.field__label', { text: 'Table' }), table]),
      h('div.field', {}, [h('label.field__label', { text: 'Telephone' }), phone]),
      h('div.field', {}, [h('label.field__label', { text: 'Note' }), note]),
    ]),
    actions: [
      { label: 'Cancel', onclick: (close) => close() },
      {
        label: existing ? 'Save' : 'Add booking', tone: 'primary',
        onclick: (close) => {
          if (!name.value.trim()) { toast('A booking needs a name', 'warn'); return; }
          const [hours, minutes] = time.value.split(':').map(Number);
          const at = new Date();
          at.setHours(hours, minutes, 0, 0);

          if (existing) dropReservation(existing.id);
          addReservation({
            name: name.value.trim(),
            covers: Number(covers.value) || 2,
            at: at.getTime(),
            tableId: table.value || null,
            phone: phone.value.trim(),
            note: note.value.trim(),
            status: existing?.status || 'CONFIRMED',
          });
          close();
          renderReservations(host);
          toast(existing ? 'Booking updated' : 'Booking added', 'good');
        },
      },
    ],
  });
}
