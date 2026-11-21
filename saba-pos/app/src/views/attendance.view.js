/**
 * Attendance.
 *
 * Two screens in one, decided by who is looking. Everybody sees one big
 * button and their own hours; the owner also sees the whole room.
 *
 * It is a clock, not a timesheet system. There is no approval step, no
 * rota and no overtime rule, because a restaurant with four staff does not
 * need one and the figures a payroll needs — who, when, how long — are all
 * here and exportable from the cloud copy.
 */

import { h, fill } from '../core/dom.js';
import { clockTime, longDate, plural } from '../shared/format.js';
import { ROLE_LABELS } from '../shared/config.js';
import { session, can, attendance, clockIn, clockOut } from '../state.js';
import { setTopbar, repaint } from '../ui/shell.js';
import { setting, chip, icon, empty, toast, notice } from '../ui/components.js';

// Same two helpers the reports and setup screens keep locally. Three copies
// is one too many, but promoting them is a tidy-up of two working screens
// and not what this change is for.
const card = (title, subtitle, body) => h('section.card', {}, [
  h('div.card__head', {}, h('div.u-grow', {}, [
    h('h2.card__title', { text: title }),
    subtitle ? h('p.stat__note', { text: subtitle }) : null,
  ])),
  h('div.card__body', {}, body),
]);

const table = (headers, rows) => h('div', { style: { overflowX: 'auto' } },
  h('table.table', {}, [
    h('thead', {}, h('tr', {}, headers.map((label, i) =>
      h(`th${i > 2 ? '.num' : ''}`, { text: label })))),
    h('tbody', {}, rows.map((cells) => h('tr', {}, cells.map((cell) => {
      if (cell && typeof cell === 'object' && cell.node) return h('td', {}, cell.node);
      if (cell && typeof cell === 'object') return h('td.num', { text: cell.num });
      return h('td', { text: String(cell ?? '') });
    })))),
  ]));

/** Screen-local: what the till last told us, and which day is on show. */
let data = null;
let day = null;
let loading = false;
let busy = false;

export function renderAttendance(host) {
  const me = session();
  const everyone = can('attendanceAll');

  setTopbar({
    title: 'Attendance',
    subtitle: data ? longDate(new Date(`${data.day}T12:00:00`).getTime()) : 'Asking the till…',
  });

  if (!data && !loading) load();
  if (!data) return fill(host, empty('Asking the till…'));

  fill(host, h('div.view__pad.grid', { style: { gap: '16px', maxWidth: '940px' } }, [
    renderMe(me),
    everyone ? renderEveryone() : null,
    everyone ? null : notice(
      'You can see your own hours here. The whole roster is the owner’s to look at.',
      'info', 'info'
    ),
  ].filter(Boolean)));
}

async function load() {
  loading = true;
  try {
    data = await attendance({ day, all: can('attendanceAll') });
  } catch (error) {
    toast(error.message, 'bad', 5000);
  } finally {
    loading = false;
    repaint();
  }
}

/** Minutes as a person says them. */
const hours = (mins) => (mins >= 60
  ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`
  : `${mins}m`);

/* ----------------------------------------------------------------- me --- */

function renderMe(me) {
  const open = data.open;
  const todayMins = data.mine.reduce((n, s) => n + s.minutes, 0);

  const press = async (direction) => {
    if (busy) return;
    busy = true;
    try {
      await (direction === 'in' ? clockIn() : clockOut());
      data = await attendance({ day, all: can('attendanceAll') });
      toast(direction === 'in' ? 'Clocked in' : 'Clocked out', 'good');
    } catch (error) {
      toast(error.message, 'bad', 5000);
    } finally {
      busy = false;
      repaint();
    }
  };

  return card(me.name, ROLE_LABELS[me.role] || me.role, [
    setting(
      open ? 'On the clock' : 'Not clocked in',
      open
        ? `Since ${clockTime(open.clock_in)} — ${hours(
          Math.max(0, Math.round((Date.now() - open.clock_in) / 60000)))} so far.`
        : 'Press this when you arrive, and again when you leave.',
      h(`button.btn.btn--${open ? 'quiet-danger' : 'primary'}`, {
        type: 'button',
        disabled: busy,
        onclick: () => press(open ? 'out' : 'in'),
      }, [icon('clock', { size: 17 }), open ? 'Clock out' : 'Clock in'])
    ),

    setting(
      'Today',
      data.mine.length
        ? data.mine.map((s) => `${clockTime(s.clock_in)}–${
          s.clock_out ? clockTime(s.clock_out) : 'now'}`).join(' · ')
        : 'Nothing recorded yet today.',
      chip(hours(todayMins), todayMins ? 'olive' : 'outline')
    ),
  ]);
}

/* ----------------------------------------------------------- the room --- */

function renderEveryone() {
  const rows = data.everyone || [];
  const byPerson = new Map();
  for (const spell of rows) {
    const person = byPerson.get(spell.user_id)
      || { name: spell.user_name, role: spell.role, minutes: 0, spells: [], open: false };
    person.minutes += spell.minutes;
    person.spells.push(spell);
    person.open = person.open || spell.open;
    byPerson.set(spell.user_id, person);
  }
  const people = [...byPerson.values()].sort((a, b) => b.minutes - a.minutes);

  return card('Everybody', people.length
    ? `${plural(people.filter((p) => p.open).length, 'person')} on the clock now`
    : 'Nobody has clocked in today',
  people.length
    ? table(
      ['Name', 'Role', 'In and out', 'Now', 'Hours'],
      people.map((p) => [
        p.name,
        ROLE_LABELS[p.role] || p.role,
        p.spells.map((s) => `${clockTime(s.clock_in)}–${
          s.clock_out ? clockTime(s.clock_out) : 'now'}`).join(', '),
        { node: p.open ? chip('In', 'olive') : chip('Out', 'outline') },
        { num: hours(p.minutes) },
      ])
    )
    : empty('An empty room', 'Hours appear here as staff clock in.'));
}
