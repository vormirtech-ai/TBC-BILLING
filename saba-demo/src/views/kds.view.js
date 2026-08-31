/**
 * Kitchen display.
 *
 * Read at three metres by someone holding a pan, so: dark ground, large type,
 * and exactly one thing carried by colour — how long this docket has been
 * waiting against its station's own target.
 *
 *   green   comfortable
 *   amber   past three quarters of the target
 *   red     past the target
 *   pulsing half again past it, or plated and left on the pass
 *
 * The board re-times itself every ten seconds. It does not re-render the whole
 * page to do it: only the clock on each ticket and the class that colours it
 * change, so a chef's eye is never dragged around by a repaint.
 */

import { h, fill, $$ } from '../core/dom.js';
import { STATIONS, KOT_STATUS, stationById, courseById } from '../config.js';
import { timer, clockTime, plural } from '../core/format.js';
import { openTickets, allDay } from '../domain/reports.js';
import { kotLines } from '../domain/orders.js';
import {
  openOrders, bumpKot, killKot, markReprint, orderById, users, } from '../state.js';
import { setTopbar } from '../ui/shell.js';
import {
  segmented, empty, icon, toast, authorise, askReason, } from '../ui/components.js';
import { renderKot, printDocs } from '../ui/print.js';

let station = 'ALL';
let showServed = false;
let tick = null;

/**
 * Dockets the section has already sent away, most recent first.
 *
 * Only the last half hour: a chef looking back is checking what just went out,
 * not reading the day's history, and an unbounded list would push the live
 * dockets off the board.
 */
function servedTickets(orders, stationId) {
  const since = Date.now() - 30 * 60000;
  const rows = [];
  for (const order of orders) {
    for (const kot of order.kots) {
      if (kot.status !== KOT_STATUS.SERVED || !kot.servedAt || kot.servedAt < since) continue;
      if (stationId && kot.station !== stationId) continue;
      rows.push({
        order, kot, ageMs: Date.now() - kot.firedAt, sla: stationById(kot.station).slaMinutes,
      });
    }
  }
  return rows.sort((a, b) => b.kot.servedAt - a.kot.servedAt);
}

export function renderKds(host) {
  const orders = openOrders();
  const only = station === 'ALL' ? null : station;
  const tickets = openTickets(orders, only);
  const served = showServed ? servedTickets(orders, only) : [];

  setTopbar({
    title: 'Kitchen',
    subtitle: `${plural(tickets.length, 'docket')} live · ${plural(
      tickets.filter((t) => t.kot.status === KOT_STATUS.READY).length, 'plate'
    )} on the pass`,
    actions: [
      h('button.btn.btn--ghost.btn--sm', {
        type: 'button',
        'aria-pressed': String(showServed),
        onclick: () => { showServed = !showServed; renderKds(host); },
      }, [
        icon('eye', { size: 16 }),
        showServed ? 'Hide the last half hour' : 'Show the last half hour',
      ]),
    ],
  });

  const counts = Object.fromEntries(STATIONS.map((s) => [
    s.id, openTickets(orders, s.id).length,
  ]));

  const board = h('div.kds__board');

  fill(host, h('div.kds', {}, [
    h('div.kds__bar', {}, [
      segmented(
        [{ id: 'ALL', label: 'Whole pass', count: openTickets(orders).length },
          ...STATIONS.map((s) => ({ id: s.id, label: s.label, count: counts[s.id] }))],
        station,
        (id) => { station = id; renderKds(host); }
      ),
    ]),
    renderAllDay(orders),
    board,
  ]));

  paintBoard(board, host, tickets, served);
  startTicking();
}

/**
 * All-day counts: how many of each dish the kitchen still owes the room,
 * regardless of which table wants it. This is the number a section chef works
 * from when deciding what to put on next.
 */
function renderAllDay(orders) {
  const rows = allDay(orders, station === 'ALL' ? null : station);
  if (!rows.length) return null;
  return h('div.allday', {}, [
    h('span.u-caps', { style: { color: 'rgba(242,231,215,.55)' }, text: 'All day' }),
    ...rows.slice(0, 14).map((row) => h('span.allday__item', {}, [
      h('span.allday__qty', { text: String(row.qty) }),
      row.name,
    ])),
  ]);
}

function paintBoard(board, host, tickets, served = []) {
  if (!tickets.length && !served.length) {
    fill(board, empty(
      'The pass is clear',
      station === 'ALL'
        ? 'Nothing is cooking anywhere. Fire a course from a table to see a docket land here.'
        : `Nothing on ${stationById(station).label} right now.`
    ));
    return;
  }
  fill(board, [
    ...tickets.map((entry) => renderTicket(entry, host)),
    ...served.map((entry) => renderTicket(entry, host, { done: true })),
  ]);
}

function renderTicket({ order, kot, sla }, host, opts = {}) {
  const lines = kotLines(order, kot).filter((l) => l.status !== KOT_STATUS.VOID);
  const onPass = kot.status === KOT_STATUS.READY;
  const since = onPass ? kot.readyAt : kot.firedAt;

  const grouped = [...new Set(lines.map((l) => l.course))].map((courseId) => ({
    course: courseById(courseId),
    items: lines.filter((l) => l.course === courseId),
  }));

  const node = h(
    `article.ticket${onPass ? '.ticket--onpass' : ''}${opts.done ? '.ticket--done' : ''}`,
    {
      dataset: {
        since: String(since), sla: String(sla),
        pass: onPass ? '1' : '0', done: opts.done ? '1' : '0',
      },
    },
    [
    h('header.ticket__head', {}, [
      h('span.ticket__table', { text: kot.tableLabel }),
      h('div', {}, [
        h('div.ticket__code', { text: kot.code }),
        h('div.ticket__code', { text: `${kot.covers} cov · ${clockTime(kot.firedAt)}` }),
      ]),
      opts.done
        ? h('span.ticket__code', { text: `away ${clockTime(kot.servedAt)}` })
        : h('span.ticket__timer', { text: timer(since) }),
    ]),

    h('div.ticket__body', {}, [
      station === 'ALL'
        ? h('div.ticket__course', { text: stationById(kot.station).label })
        : null,
      ...grouped.flatMap((group) => [
        h('div.ticket__course', { text: group.course.label }),
        ...group.items.map((line) => h('div.tline', {}, [
          h('span.tline__qty', { text: String(line.qty) }),
          h('div', {}, [
            h('div.tline__name', { text: line.name }),
            line.seat ? h('div.tline__seat', { text: `SEAT ${line.seat}` }) : null,
            line.modifiers.length
              ? h('div.tline__mods', { text: line.modifiers.map((m) => m.label).join(' · ') })
              : null,
            line.notes ? h('div.tline__note', { text: line.notes }) : null,
          ]),
        ])),
      ]),
      order.notes ? h('div.tline__note', { text: order.notes }) : null,
    ]),

    h('footer.ticket__foot', {}, opts.done
      ? [
        h('button.btn.btn--sm.u-grow', {
          type: 'button',
          onclick: () => {
            bumpKot(order.id, kot.id, KOT_STATUS.READY);
            toast(`${kot.code} recalled to the pass`, 'warn');
            renderKds(host);
          },
        }, [icon('refresh', { size: 16 }), 'Recall']),
      ]
      : onPass
      ? [
        h('button.btn.btn--sage.btn--sm.u-grow', {
          type: 'button',
          onclick: () => { bumpKot(order.id, kot.id, KOT_STATUS.SERVED); toast(`${kot.code} away`, 'good', 1500); renderKds(host); },
        }, [icon('check', { size: 16 }), 'Away']),
        h('button.btn.btn--sm', {
          type: 'button', title: 'Back to the kitchen',
          onclick: () => { bumpKot(order.id, kot.id, KOT_STATUS.FIRED); renderKds(host); },
        }, icon('refresh', { size: 16 })),
      ]
      : [
        h('button.btn.btn--primary.btn--sm.u-grow', {
          type: 'button',
          onclick: () => { bumpKot(order.id, kot.id, KOT_STATUS.READY); toast(`${kot.code} on the pass`, 'good', 1500); renderKds(host); },
        }, [icon('bell', { size: 16 }), 'Ready']),
        h('button.btn.btn--sm', {
          type: 'button', title: 'Reprint this docket',
          onclick: () => {
            markReprint(order.id, kot.id);
            printDocs([renderKot(orderById(order.id), orderById(order.id).kots.find((k) => k.id === kot.id))]);
          },
        }, icon('print', { size: 16 })),
        h('button.btn.btn--sm', {
          type: 'button', title: 'Void this docket',
          onclick: () => voidTicket(order, kot, host),
        }, icon('close', { size: 16 })),
      ]),
  ]);

  if (!opts.done) applyAge(node);
  return node;
}

/* ------------------------------------------------------------- clock --- */

/**
 * Re-time every ticket in place. Touching only the timer text and one class
 * keeps the board still while the numbers move.
 */
function applyAge(node) {
  // A docket that is already away is history; it takes no part in the timing
  // colours and its clock does not keep running.
  if (node.dataset.done === '1') return;
  const since = Number(node.dataset.since);
  const sla = Number(node.dataset.sla);
  const onPass = node.dataset.pass === '1';
  const minutes = (Date.now() - since) / 60000;

  const clock = node.querySelector('.ticket__timer');
  if (clock) clock.textContent = timer(since);

  // Food already plated is judged far more harshly: eight minutes under a heat
  // lamp is the difference between service and an apology.
  const limit = onPass ? 6 : sla;
  const band = minutes > limit * 1.5 ? 'critical'
    : minutes > limit ? 'late'
      : minutes > limit * 0.75 ? 'warn' : 'ok';

  node.classList.remove('ticket--ok', 'ticket--warn', 'ticket--late', 'ticket--critical');
  node.classList.add(`ticket--${band === 'critical' ? 'late' : band}`);
  if (band === 'critical') node.classList.add('ticket--critical');
}

function startTicking() {
  clearInterval(tick);
  tick = setInterval(() => {
    const nodes = $$('.ticket');
    if (!nodes.length) { clearInterval(tick); tick = null; return; }
    for (const node of nodes) applyAge(node);
  }, 5000);
}

export function stopKdsClock() {
  clearInterval(tick);
  tick = null;
}

/* -------------------------------------------------------------- void --- */

async function voidTicket(order, kot, host) {
  const approver = await authorise({
    title: `Void docket ${kot.code}?`,
    subtitle: `Everything on it comes off Table ${kot.tableLabel}'s bill.`,
    users: users(),
  });
  if (!approver) return;
  const reason = await askReason({
    title: 'Why is this docket being killed?',
    subtitle: 'A cancellation slip prints at the station so the section knows to stop.',
  });
  if (!reason) return;

  killKot(order.id, kot.id, reason, approver.name);
  const fresh = orderById(order.id);
  printDocs([renderKot(fresh, fresh.kots.find((k) => k.id === kot.id), { voided: true })]);
  toast('Docket voided — cancellation slip sent', 'warn');
  renderKds(host);
}
