/**
 * The order screen — where a fine-dining system earns its keep.
 *
 * Three columns. On the left, everything that can be ordered, filtered and
 * searchable. In the middle-right, the pad: what has been written, grouped by
 * course, with each line showing whether it is still held, cooking, on the pass
 * or on the table. At the foot, what it comes to.
 *
 * The two ideas that make this different from a counter till:
 *
 *   SEATS. Every line can be pinned to a seat number, which costs the captain
 *   one tap and saves the cashier a re-key when the table asks to split.
 *
 *   COURSES AND FIRING. Writing an order and sending it to the kitchen are two
 *   separate actions. Items sit HELD until their course is fired, so a captain
 *   can take the whole meal in one visit and still pace it properly.
 */

import { h, fill, $ } from '../core/dom.js';
import { COURSES, KOT_STATUS, VOID_REASONS, stationById, courseById } from '../config.js';
import { CATEGORIES, MODIFIER_GROUPS } from '../data/menu.seed.js';
import { money } from '../core/money.js';
import { elapsed, matches, plural } from '../core/format.js';
import { costOrder, lineGross } from '../domain/pricing.js';
import { coursePacing, heldLines, heldCourses, seatsUsed } from '../domain/orders.js';
import {
  menu, orderForTable, orderById, addItem, changeQty, dropLine, killLine,
  toggleComp, fire, setCovers, setGuestName, setOrderNote, can, users,
  session, markReprint, setEightySix,
} from '../state.js';
import { navigate } from '../core/router.js';
import { setTopbar } from '../ui/shell.js';
import {
  dialog, confirm, askReason, authorise, toast, icon, empty, chip, notice,
} from '../ui/components.js';
import { renderKot, printDocs } from '../ui/print.js';

/** Screen-local view state. Deliberately not in the store: it is not data. */
const ui = { category: 'all', query: '', seat: 0, course: null };

export function renderOrder(host, params) {
  const order = params.order ? orderById(params.order) : orderForTable(params.table);

  if (!order) {
    setTopbar({ title: 'Order' });
    fill(host, empty(
      'No table open',
      'Pick a table on the floor plan to start an order.',
      h('button.btn.btn--primary', { type: 'button', text: 'Go to the floor', onclick: () => navigate('/floor') })
    ));
    return;
  }

  const totals = costOrder(order);
  const held = heldLines(order);

  setTopbar({
    title: `Table ${order.tableLabel}`,
    subtitle: `${order.code} · ${plural(order.covers, 'cover')} · open ${elapsed(order.openedAt)} · ${order.captainName}`,
    actions: [
      h('button.btn.btn--ghost.btn--sm', {
        type: 'button', onclick: () => navigate('/floor'),
      }, [icon('back', { size: 16 }), 'Floor']),
      h('button.btn.btn--outline.btn--sm', {
        type: 'button', onclick: () => openCover(order, host),
      }, [icon('users', { size: 16 }), 'Table details']),
      order.invoice ? null : h('button.btn.btn--outline.btn--sm', {
        type: 'button', onclick: () => navigate('/bill', { order: order.id }),
      }, [icon('bill', { size: 16 }), 'Bill']),
    ],
  });

  fill(host, h('div.order', {}, [
    h('div.order__left', {}, [
      renderTools(host, order),
      renderCategories(host),
      renderDishes(host, order),
    ]),
    renderPad(host, order, totals, held),
  ]));
}

/* --------------------------------------------------------- left side --- */

function renderTools(host, order) {
  const search = h('input.input', {
    type: 'search', placeholder: 'Search the carte…', value: ui.query,
    oninput: (event) => {
      ui.query = event.target.value;
      repaintDishes(host, order);
    },
  });

  return h('div.order__tools', {}, [
    h('div.search', {}, [h('span.search__icon', {}, icon('search', { size: 17 })), search]),

    // Seat selector. "Table" means the dish is shared and belongs to nobody,
    // which is the right default for mezze and the wrong one for a main.
    h('div.seats', {}, [
      h('span.u-caps', { text: 'Seat' }),
      h('div.segmented', {}, [
        h('button.segmented__btn', {
          type: 'button', 'aria-selected': String(ui.seat === 0), text: 'Table',
          onclick: () => { ui.seat = 0; renderOrder(host, { order: order.id }); },
        }),
        ...Array.from({ length: Math.min(order.covers, 12) }, (_, i) => i + 1).map((seat) =>
          h('button.segmented__btn', {
            type: 'button', 'aria-selected': String(ui.seat === seat), text: String(seat),
            onclick: () => { ui.seat = seat; renderOrder(host, { order: order.id }); },
          })),
      ]),
    ]),
  ]);
}

function renderCategories(host) {
  return h('div.cats', { role: 'tablist' }, [
    { id: 'all', label: 'Everything' },
    ...CATEGORIES,
    { id: 'signature', label: 'Signatures' },
  ].map((category) =>
    h('button.cat', {
      type: 'button', role: 'tab',
      'aria-selected': String(ui.category === category.id),
      text: category.label,
      onclick: (event) => {
        ui.category = category.id;
        for (const tab of event.currentTarget.parentElement.children) {
          tab.setAttribute('aria-selected', String(tab === event.currentTarget));
        }
        repaintDishes(host);
      },
    })));
}

function visibleDishes() {
  return menu().filter((item) => {
    if (ui.category === 'signature' && !item.signature) return false;
    if (ui.category !== 'all' && ui.category !== 'signature' && item.category !== ui.category) return false;
    return matches(item.name, ui.query) || matches(item.description, ui.query);
  });
}

function repaintDishes(host, order) {
  const current = $('.dishes', host);
  if (!current) return;
  const found = order || currentOrder(host);
  current.replaceWith(renderDishes(host, found));
}

/** The pad's own order id is on the DOM, so a repaint does not need it passed. */
function currentOrder(host) {
  const id = $('.pad', host)?.dataset.order;
  return id ? orderById(id) : null;
}

function renderDishes(host, order) {
  const dishes = visibleDishes();
  if (!dishes.length) {
    return h('div.dishes', {}, empty('Nothing matches', 'Try a shorter search, or a different section of the carte.'));
  }

  return h('div.dishes', {}, dishes.map((item) => {
    const off = !item.available;
    return h(`button.dish${off ? '.dish--86' : ''}`, {
      type: 'button',
      disabled: off,
      title: off ? `${item.name} is 86 tonight` : item.description,
      onclick: () => pickDish(host, order, item),
      oncontextmenu: (event) => {
        // Long-press / right-click is how a captain 86s something from here.
        event.preventDefault();
        if (can('eightySix')) offerEightySix(host, order, item);
      },
    }, [
      item.signature ? h('span.dish__star', {}, icon('star', { size: 14, fill: 'currentColor' })) : null,
      h('div.dish__top', {}, [
        h('span', { class: `diet diet--${item.diet.toLowerCase()}`, title: item.diet }),
        h('span.dish__name', { text: item.name }),
      ]),
      item.description ? h('p.dish__desc', { text: item.description }) : null,
      h('div.dish__foot', {}, [
        h('span.dish__price', { text: money(item.pricePaise) }),
        h('span.dish__allergens', {}, (item.allergens || []).map((code) =>
          h('span.dish__allergen', { text: code, title: code }))),
      ]),
    ]);
  }));
}

/**
 * Tapping a dish adds it straight away when there is nothing to ask about, and
 * opens the modifier sheet when there is. Making every dish open a sheet would
 * add a tap to the ninety per cent of orders that need no choices at all.
 */
function pickDish(host, order, item) {
  if (!item.modifierGroups?.length) {
    addItem(order.id, item, { qty: 1, seat: ui.seat || null, course: item.course });
    toast(`${item.name} added${ui.seat ? ` · seat ${ui.seat}` : ''}`, 'good', 1600);
    renderOrder(host, { order: order.id });
    return;
  }
  openModifiers(host, order, item);
}

function openModifiers(host, order, item) {
  const chosen = new Map();
  let qty = 1;
  let course = item.course;
  const note = h('input.input', { placeholder: 'Anything the kitchen must know…' });

  const groups = item.modifierGroups.map((groupId) => {
    const group = MODIFIER_GROUPS[groupId];
    const buttons = group.options.map((option) =>
      h('button.btn.btn--outline.btn--sm', {
        type: 'button',
        onclick: () => {
          const set = chosen.get(group.id) || new Set();
          if (set.has(option.id)) set.delete(option.id);
          else {
            if (group.max === 1) set.clear();
            set.add(option.id);
          }
          chosen.set(group.id, set);
          for (const button of buttons) {
            button.classList.toggle(
              'btn--primary',
              set.has(button.dataset.option)
            );
          }
        },
        dataset: { option: option.id },
      }, [
        option.label,
        option.deltaPaise
          ? h('span.u-muted', { text: ` ${option.deltaPaise > 0 ? '+' : '−'}${money(Math.abs(option.deltaPaise))}` })
          : null,
      ]));

    return h('div.field', {}, [
      h('label.field__label', {
        text: group.required ? `${group.label} · required` : group.label,
      }),
      h('div.u-row.u-wrap', { style: { gap: '7px' } }, buttons),
    ]);
  });

  const qtyValue = h('span.stepper__value', { text: '1' });

  dialog({
    title: item.name,
    subtitle: item.description || `${stationById(item.station).label} · ${money(item.pricePaise)}`,
    body: h('div.grid', { style: { gap: '16px' } }, [
      ...groups,
      h('div.field', {}, [
        h('label.field__label', { text: 'Course' }),
        h('div.u-row.u-wrap', { style: { gap: '7px' } }, COURSES.map((option) =>
          h('button.btn.btn--outline.btn--sm', {
            type: 'button', text: option.label,
            class: option.id === course ? 'btn--primary' : '',
            onclick: (event) => {
              course = option.id;
              for (const sibling of event.currentTarget.parentElement.children) {
                sibling.classList.toggle('btn--primary', sibling === event.currentTarget);
              }
            },
          }))),
      ]),
      h('div.field', {}, [h('label.field__label', { text: 'Note to the kitchen' }), note]),
      h('div.u-row', {}, [
        h('span.field__label', { text: 'Quantity' }),
        h('div.stepper', {}, [
          h('button', { type: 'button', 'aria-label': 'Fewer', onclick: () => { qty = Math.max(1, qty - 1); qtyValue.textContent = qty; } }, icon('minus', { size: 15 })),
          qtyValue,
          h('button', { type: 'button', 'aria-label': 'More', onclick: () => { qty += 1; qtyValue.textContent = qty; } }, icon('plus', { size: 15 })),
        ]),
      ]),
    ]),
    actions: [
      { label: 'Cancel', onclick: (close) => close() },
      {
        label: 'Add to order', tone: 'primary', autofocus: true,
        onclick: (close) => {
          const modifiers = [...chosen.entries()].flatMap(([groupId, set]) =>
            MODIFIER_GROUPS[groupId].options.filter((o) => set.has(o.id)));
          addItem(order.id, item, {
            qty, seat: ui.seat || null, course, modifiers, notes: note.value.trim(),
          });
          close();
          toast(`${qty} × ${item.name} added`, 'good', 1600);
          renderOrder(host, { order: order.id });
        },
      },
    ],
  });
}

async function offerEightySix(host, order, item) {
  const ok = await confirm({
    title: item.eightySixed ? `Put ${item.name} back on?` : `86 ${item.name}?`,
    message: item.eightySixed
      ? 'It becomes orderable again straight away.'
      : 'It stays visible on the carte so a captain can tell a guest it has gone, but nobody can order it.',
    confirmLabel: item.eightySixed ? 'Put back on' : 'Mark 86',
    tone: item.eightySixed ? 'primary' : 'danger',
  });
  if (!ok) return;
  setEightySix(item.id, !item.eightySixed);
  toast(item.eightySixed ? `${item.name} back on` : `${item.name} is 86`, 'warn');
  renderOrder(host, { order: order.id });
}

/* --------------------------------------------------------------- pad --- */

function renderPad(host, order, totals, held) {
  const pacing = coursePacing(order);
  const ready = heldCourses(order);
  const again = () => renderOrder(host, { order: order.id });

  return h('aside.pad', { dataset: { order: order.id } }, [
    h('div.pad__head', {}, [
      h('div.pad__table', {}, [
        h('span.pad__title', { text: `Table ${order.tableLabel}` }),
        h('span.pad__code', { text: order.code }),
      ]),
      h('div.pad__meta', {}, [
        chip(plural(order.covers, 'cover'), 'gold', { icon: 'users' }),
        order.guestName ? chip(order.guestName, 'outline') : null,
        chip(elapsed(order.openedAt), 'outline', { icon: 'clock' }),
        order.notes ? chip('Table note', 'amber', { icon: 'note' }) : null,
      ]),
    ]),

    h('div.pacing', {}, pacing.map((entry) =>
      h(`div.pace.pace--${entry.state}`, { title: `${entry.course.label} — ${paceWord(entry.state)}` }, [
        h('div.pace__label', { text: entry.course.short }),
        h('div.pace__state', { text: entry.count ? `${entry.count} · ${paceWord(entry.state)}` : '—' }),
      ]))),

    h('div.pad__lines', {}, order.lines.length
      ? COURSES.flatMap((course) => {
        const lines = order.lines.filter((l) => l.course === course.id);
        if (!lines.length) return [];
        return [
          h('div.course-head', {}, [
            h('span.course-head__label', { text: course.label }),
            h('span.course-head__line'),
            ...(lines.some((l) => l.status === KOT_STATUS.HELD)
              ? [h('button.btn.btn--gold.btn--xs', {
                type: 'button',
                onclick: () => doFire(host, order, course.id),
              }, [icon('fire', { size: 13 }), 'Fire'])]
              : []),
          ]),
          ...lines.map((line) => renderLine(host, order, line, again)),
        ];
      })
      : empty('Nothing written yet', 'Tap a dish on the left to start the order.')),

    h('div.pad__foot', {}, [
      held.length
        ? notice(
          `${plural(held.reduce((n, l) => n + l.qty, 0), 'item')} waiting to go to the kitchen`
          + ` across ${plural(ready.length, 'course')}.`,
          'warn', 'clock'
        )
        : null,

      h('div.totals', {}, [
        totalRow('Items', money(totals.gross)),
        totals.comps ? totalRow('Compliments', `− ${money(totals.comps)}`) : null,
        totals.serviceCharge ? totalRow('Service charge', money(totals.serviceCharge)) : null,
        totalRow('Tax', money(totals.taxTotal)),
        h('div.totals__row.totals__row--grand', {}, [
          h('span', { text: 'Running total' }),
          h('span.u-num', { text: money(totals.total) }),
        ]),
      ]),

      h('div.pad__actions', {}, [
        h('button.btn.btn--gold', {
          type: 'button', disabled: !held.length,
          onclick: () => doFire(host, order, null),
        }, [icon('fire', { size: 17 }), held.length ? `Fire ${held.reduce((n, l) => n + l.qty, 0)}` : 'Nothing held']),
        h('button.btn.btn--primary', {
          type: 'button',
          disabled: !order.lines.some((l) => l.status !== KOT_STATUS.VOID),
          onclick: () => navigate('/bill', { order: order.id }),
        }, [icon('bill', { size: 17 }), 'Bill']),
      ]),
    ]),
  ]);
}

const paceWord = (state) => ({
  EMPTY: 'nothing', HELD: 'held', FIRED: 'cooking', READY: 'on pass', SERVED: 'served',
}[state]);

const totalRow = (label, value) => h('div.totals__row', {}, [
  h('span', { text: label }),
  h('span.u-num', { text: value }),
]);

function renderLine(host, order, line, again) {
  const state = line.status.toLowerCase();
  const kot = order.kots.find((k) => k.id === line.kotId);

  return h(`div.ln.ln--${state}${line.comp ? '.ln--comp' : ''}`, {}, [
    h('span.ln__qty', { text: String(line.qty) }),

    h('div', {}, [
      h('div.ln__name', { text: line.name }),
      line.modifiers.length
        ? h('div.ln__mods', { text: line.modifiers.map((m) => m.label).join(' · ') })
        : null,
      line.notes ? h('div.ln__note', {}, [icon('warn', { size: 12 }), line.notes]) : null,
      h('div.ln__tags', {}, [
        line.seat ? h('span.ln__tag', { text: `Seat ${line.seat}` }) : null,
        h('span.ln__tag', { text: stationById(line.station).short }),
        line.status !== KOT_STATUS.HELD && kot
          ? h('span.ln__tag', { text: `${kot.code} · ${statusWord(line.status)}` })
          : h('span.ln__tag', { text: 'held' }),
        line.comp ? h('span.ln__tag', { text: 'comped' }) : null,
        line.status === KOT_STATUS.VOID ? h('span.ln__tag', { text: line.voidReason }) : null,
      ]),
    ]),

    h('div.ln__right', {}, [
      h('span.ln__total', { text: line.comp ? '—' : money(lineGross(line)) }),
      h('div.ln__actions', {}, lineActions(host, order, line, again)),
    ]),
  ]);
}

const statusWord = (status) => ({
  FIRED: 'cooking', READY: 'on pass', SERVED: 'served', VOID: 'void',
}[status] || status.toLowerCase());

function lineActions(host, order, line, again) {
  if (line.status === KOT_STATUS.VOID) return [];

  if (line.status === KOT_STATUS.HELD) {
    return [
      h('div.stepper', {}, [
        h('button', {
          type: 'button', 'aria-label': 'One fewer',
          onclick: () => { changeQty(order.id, line.id, line.qty - 1); again(); },
        }, icon('minus', { size: 14 })),
        h('span.stepper__value', { text: String(line.qty) }),
        h('button', {
          type: 'button', 'aria-label': 'One more',
          onclick: () => { changeQty(order.id, line.id, line.qty + 1); again(); },
        }, icon('plus', { size: 14 })),
      ]),
      h('button.btn.btn--ghost.btn--icon.btn--sm', {
        type: 'button', 'aria-label': 'Remove',
        onclick: () => { dropLine(order.id, line.id); again(); },
      }, icon('trash', { size: 15 })),
    ];
  }

  // Once it has been cooked, the only ways out are a void or a comp, and both
  // need a manager's PIN. That is the whole point of the distinction.
  return [
    can('comp') ? h('button.btn.btn--ghost.btn--icon.btn--sm', {
      type: 'button', 'aria-label': line.comp ? 'Remove compliment' : 'Comp this',
      title: line.comp ? 'Remove compliment' : 'On the house',
      onclick: () => doComp(host, order, line, again),
    }, icon('star', { size: 15 })) : null,
    h('button.btn.btn--ghost.btn--icon.btn--sm', {
      type: 'button', 'aria-label': 'Void', title: 'Void this line',
      onclick: () => doVoid(host, order, line, again),
    }, icon('close', { size: 15 })),
  ];
}

async function doVoid(host, order, line, again) {
  const approver = await authorise({
    title: `Void ${line.qty} × ${line.name}?`,
    subtitle: 'This dish has already gone to the kitchen.',
    users: users(),
  });
  if (!approver) return;
  const reason = await askReason({
    title: 'Why is it being voided?',
    subtitle: 'It stays on the bill as a voided line so the day’s figures still add up.',
    reasons: VOID_REASONS,
  });
  if (!reason) return;
  killLine(order.id, line.id, reason, approver.name);
  toast('Line voided and logged', 'warn');
  again();
}

async function doComp(host, order, line, again) {
  if (line.comp) {
    toggleComp(order.id, line.id, '', session()?.name);
    again();
    return;
  }
  const approver = await authorise({
    title: `Put ${line.name} on the house?`,
    users: users(),
  });
  if (!approver) return;
  const reason = await askReason({
    title: 'Reason for the compliment',
    reasons: ['Anniversary / celebration', 'Long wait', 'Quality issue', 'Regular guest', 'Manager’s discretion'],
    confirmLabel: 'Comp it',
    tone: 'primary',
  });
  if (!reason) return;
  toggleComp(order.id, line.id, reason, approver.name);
  toast('Comped and logged', 'good');
  again();
}

/* -------------------------------------------------------------- fire --- */

/**
 * Fire, then print. One docket per station, each shown as a preview so the
 * demo can be run without a printer attached — and so anyone watching can see
 * exactly what the tandoor gets versus what the pastry section gets.
 */
async function doFire(host, order, courseId) {
  const kots = fire(order.id, courseId);
  if (!kots.length) { toast('Nothing held for that course', 'warn'); return; }

  const fresh = orderById(order.id);
  renderOrder(host, { order: order.id });

  const label = courseId ? courseById(courseId).label : 'the table';
  toast(`${kots.length} docket${kots.length > 1 ? 's' : ''} sent for ${label}`, 'good');

  showDockets(fresh, kots, {
    title: `Sent to the kitchen`,
    subtitle: kots.map((k) => stationById(k.station).label).join(' · '),
  });
}

export function showDockets(order, kots, { title, subtitle } = {}) {
  const docs = kots.map((kot) => renderKot(order, kot));
  dialog({
    title: title || 'Kitchen dockets',
    subtitle: subtitle || `${kots.length} station${kots.length > 1 ? 's' : ''}`,
    size: 'wide',
    body: h('div.grid', { style: { gap: '14px' } }, [
      notice(
        'Each station gets only its own dishes. In a live install these go straight '
        + 'to the printer at that section; here they are shown so you can see the split.',
        'info'
      ),
      h('div.preview', {}, docs),
    ]),
    actions: [
      { label: 'Close', onclick: (close) => close() },
      {
        label: 'Print dockets', tone: 'primary',
        onclick: () => {
          for (const kot of kots) markReprint(order.id, kot.id);
          printDocs(kots.map((kot) => renderKot(orderById(order.id), kot)));
        },
      },
    ],
  });
}

/* ------------------------------------------------------ table details --- */

function openCover(order, host) {
  const covers = h('input.input', { type: 'number', min: '1', value: String(order.covers) });
  const guest = h('input.input', { value: order.guestName });
  const note = h('textarea.textarea', {
    text: order.notes,
    placeholder: 'Allergies, celebrations, pacing — printed on every docket for this table.',
  });

  dialog({
    title: `Table ${order.tableLabel}`,
    subtitle: `${order.code} · opened ${elapsed(order.openedAt)} ago by ${order.captainName}`,
    size: 'slim',
    body: h('div.grid', { style: { gap: '14px' } }, [
      h('div.field', {}, [h('label.field__label', { text: 'Covers' }), covers]),
      h('div.field', {}, [h('label.field__label', { text: 'Guest' }), guest]),
      h('div.field', {}, [h('label.field__label', { text: 'Table note' }), note]),
      seatsUsed(order).length
        ? notice(`Seats in use: ${seatsUsed(order).join(', ')}. The bill can be split by seat.`, 'info')
        : null,
    ]),
    actions: [
      { label: 'Cancel', onclick: (close) => close() },
      {
        label: 'Save', tone: 'primary',
        onclick: (close) => {
          setCovers(order.id, Number(covers.value) || order.covers);
          setGuestName(order.id, guest.value.trim());
          setOrderNote(order.id, note.value.trim());
          close();
          renderOrder(host, { order: order.id });
          toast('Table updated', 'good');
        },
      },
    ],
  });
}
