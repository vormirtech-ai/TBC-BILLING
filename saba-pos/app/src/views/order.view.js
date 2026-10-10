/**
 * The order screen — where a fine-dining system earns its keep.
 *
 * Three columns. On the left, everything that can be ordered, filtered and
 * searchable. In the middle-right, the pad: what has been written, grouped by
 * course, with each line showing whether it is still held, cooking, on the
 * pass or on the table. At the foot, what it comes to.
 *
 * The two ideas that make this different from a counter till:
 *
 *   SEATS. Every line can be pinned to a seat number, which costs the captain
 *   one tap and saves the cashier a re-key when the table asks to split.
 *
 *   COURSES AND FIRING. Writing an order and sending it to the kitchen are
 *   two separate actions. Items sit HELD until their course is fired, so a
 *   captain can take the whole meal in one visit and still pace it properly.
 *
 * Nothing on this screen is stored locally. Every tap is a command to the
 * till, and the pad is repainted from the till's reply — so two captains
 * working the same table see the same order.
 */

import { h, fill } from '../core/dom.js';
import {
  COURSES, KOT_STATUS, VOID_REASONS, COMP_REASONS, stationById, courseById,
} from '../shared/config.js';
import { CATEGORIES } from '../shared/catalogue.js';
import { money } from '../shared/money.js';
import { elapsed, matches, plural } from '../shared/format.js';
import { costOrder, lineGross } from '../shared/pricing.js';
import { coursePacing, heldLines, heldCourses, seatsUsed } from '../shared/orders.js';
import {
  menu, modifierGroups, orderForTable, orderById, addItem, changeQty, dropLine,
  killLine, toggleComp, fire, updateOrder, can, markReprint, setEightySix,
} from '../state.js';
import { navigate } from '../core/router.js';
import { setTopbar, repaint } from '../ui/shell.js';
import {
  dialog, confirm, askReason, authorise, toast, icon, empty, chip, notice,
} from '../ui/components.js';
import { renderKot, printDocs } from '../ui/print.js';

/**
 * Screen-local view state. Deliberately not sent to the server: which
 * category a captain is looking at is not something the restaurant needs to
 * know, and keeping it here is what lets the pad repaint under a live update
 * without the carte jumping back to the top.
 */
const ui = { category: 'all', query: '', seat: 0 };

/** Report a refused command in the captain's language, not the network's. */
const failed = (error) => toast(error.message || 'That did not go through', 'bad', 5000);

export function renderOrder(host, params) {
  const order = params.order ? orderById(params.order) : orderForTable(params.table);

  if (!order || order.status !== 'OPEN') {
    setTopbar({ title: 'Order' });
    fill(host, h('div.view__pad', {}, empty(
      'No table open',
      'Pick a table on the floor plan to start an order.',
      h('button.btn.btn--primary', {
        type: 'button', text: 'Go to the floor', onclick: () => navigate('/floor'),
      })
    )));
    return;
  }

  const totals = costOrder(order);
  const held = heldLines(order);

  setTopbar({
    title: `Table ${order.tableLabel}`,
    subtitle: `${order.code} · ${plural(order.covers, 'cover')} · open ${elapsed(order.openedAt)}`
      + ` · ${order.captainName}`,
    actions: [
      h('button.btn.btn--ghost.btn--sm', {
        type: 'button', onclick: () => navigate('/floor'),
      }, [icon('back', { size: 16 }), 'Floor']),
      h('button.btn.btn--outline.btn--sm', {
        type: 'button', onclick: () => openTableDetails(order),
      }, [icon('users', { size: 16 }), 'Table']),
      h('button.btn.btn--outline.btn--sm', {
        type: 'button', onclick: () => navigate('/bill', { order: order.id }),
      }, [icon('bill', { size: 16 }), 'Bill']),
    ],
  });

  fill(host, h('div.order', {}, [
    h('div.order__left', {}, [
      renderTools(order),
      renderCategories(),
      renderDishes(order),
    ]),
    renderPad(order, totals, held),
  ]));
}

/* --------------------------------------------------------- left side --- */

function renderTools(order) {
  const search = h('input#dishSearch.input', {
    type: 'search',
    placeholder: 'Search the carte…',
    value: ui.query,
    oninput: (event) => { ui.query = event.target.value; repaint(); },
  });

  const seats = [0, ...Array.from({ length: Math.min(order.covers, 20) }, (_, i) => i + 1)];

  return h('div.order__tools', {}, [
    h('div.search', {}, [
      h('span.search__icon', {}, icon('search', { size: 17 })),
      search,
    ]),

    // "Table" means the dish is shared and belongs to nobody, which is the
    // right default for mezze and the wrong one for a main.
    h('div.seats', {}, [
      h('span.u-caps', { text: 'Seat' }),
      h('div.segmented', { role: 'tablist' }, seats.map((seat) =>
        h('button.segmented__btn', {
          type: 'button',
          role: 'tab',
          'aria-selected': String(ui.seat === seat),
          text: seat === 0 ? 'Table' : String(seat),
          onclick: () => { ui.seat = seat; repaint(); },
        }))),
    ]),
  ]);
}

function renderCategories() {
  const tabs = [
    { id: 'all', label: 'Everything' },
    ...CATEGORIES,
    { id: 'signature', label: 'Signatures' },
  ];
  return h('div.cats', { role: 'tablist' }, tabs.map((category) =>
    h('button.cat', {
      type: 'button',
      role: 'tab',
      'aria-selected': String(ui.category === category.id),
      text: category.label,
      onclick: () => { ui.category = category.id; repaint(); },
    })));
}

function visibleDishes() {
  return menu().filter((item) => {
    if (item.active === false) return false;
    if (ui.category === 'signature' && !item.signature) return false;
    if (ui.category !== 'all' && ui.category !== 'signature'
        && item.category !== ui.category) return false;
    return matches(item.name, ui.query) || matches(item.description, ui.query);
  });
}

function renderDishes(order) {
  const dishes = visibleDishes();
  if (!dishes.length) {
    return h('div.dishes', {}, empty(
      'Nothing matches',
      'Try a shorter search, or a different section of the carte.'
    ));
  }

  return h('div.dishes', {}, dishes.map((item) => {
    const off = !item.available;
    return h(`button.dish${off ? '.dish--86' : ''}`, {
      type: 'button',
      disabled: off,
      title: off
        ? `${item.name} is 86 tonight${item.eightySix?.note ? ` — ${item.eightySix.note}` : ''}`
        : item.description,
      onclick: () => pickDish(order, item),
      oncontextmenu: (event) => {
        // Long-press or right-click is how a captain 86s something from here.
        event.preventDefault();
        if (can('eightySix')) offerEightySix(item);
      },
    }, [
      item.signature
        ? h('span.dish__star', {}, icon('star', { size: 14, fill: 'currentColor' }))
        : null,
      h('div.dish__top', {}, [
        h('span', { class: `diet diet--${String(item.diet).toLowerCase()}`, title: item.diet }),
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
 * Tapping a dish adds it straight away when there is nothing to ask about,
 * and opens the modifier sheet when there is. Making every dish open a sheet
 * would add a tap to the ninety per cent of orders that need no choices.
 */
function pickDish(order, item) {
  if (!item.modifierGroups?.length) {
    addItem(order.id, item, { qty: 1, seat: ui.seat || null, course: item.course })
      .then(() => toast(`${item.name} added${ui.seat ? ` · seat ${ui.seat}` : ''}`, 'good', 1600))
      .catch(failed);
    return;
  }
  openModifiers(order, item);
}

function openModifiers(order, item) {
  const groups = modifierGroups();
  const chosen = new Map();
  let qty = 1;
  let course = item.course;

  const note = h('input.input', { placeholder: 'Anything the kitchen must know…' });
  const qtyValue = h('span.stepper__value', { text: '1' });

  const fields = (item.modifierGroups || []).map((groupId) => {
    const group = groups[groupId];
    if (!group) return null;
    const buttons = group.options.map((option) =>
      h('button.btn.btn--outline.btn--sm', {
        type: 'button',
        dataset: { option: option.id },
        onclick: () => {
          const set = chosen.get(group.id) || new Set();
          if (set.has(option.id)) set.delete(option.id);
          else {
            if (group.max === 1) set.clear();
            set.add(option.id);
          }
          chosen.set(group.id, set);
          for (const button of buttons) {
            button.classList.toggle('btn--primary', set.has(button.dataset.option));
          }
        },
      }, [
        option.label,
        option.deltaPaise
          ? h('span.u-muted', {
            text: ` ${option.deltaPaise > 0 ? '+' : '−'}${money(Math.abs(option.deltaPaise))}`,
          })
          : null,
      ]));

    return h('div.field', {}, [
      h('label.field__label', {
        text: group.required ? `${group.label} · required` : group.label,
      }),
      h('div.u-row.u-wrap', { style: { gap: '7px' } }, buttons),
    ]);
  }).filter(Boolean);

  dialog({
    title: item.name,
    subtitle: item.description
      || `${stationById(item.station).label} · ${money(item.pricePaise)}`,
    body: h('div.grid', { style: { gap: '16px' } }, [
      ...fields,
      h('div.field', {}, [
        h('label.field__label', { text: 'Course' }),
        h('div.u-row.u-wrap', { style: { gap: '7px' } }, COURSES.map((option) =>
          h('button.btn.btn--outline.btn--sm', {
            type: 'button',
            text: option.label,
            class: option.id === course ? 'btn--primary' : '',
            onclick: (event) => {
              course = option.id;
              for (const sibling of event.currentTarget.parentElement.children) {
                sibling.classList.toggle('btn--primary', sibling === event.currentTarget);
              }
            },
          }))),
      ]),
      h('div.field', {}, [
        h('label.field__label', { text: 'Note to the kitchen' }),
        note,
      ]),
      h('div.u-row', {}, [
        h('span.field__label', { text: 'Quantity' }),
        h('div.stepper', {}, [
          h('button', {
            type: 'button', 'aria-label': 'Fewer',
            onclick: () => { qty = Math.max(1, qty - 1); qtyValue.textContent = qty; },
          }, icon('minus', { size: 15 })),
          qtyValue,
          h('button', {
            type: 'button', 'aria-label': 'More',
            onclick: () => { qty += 1; qtyValue.textContent = qty; },
          }, icon('plus', { size: 15 })),
        ]),
      ]),
    ]),
    actions: [
      { label: 'Cancel', onclick: (close) => close() },
      {
        label: 'Add to order',
        tone: 'primary',
        autofocus: true,
        onclick: (close) => {
          const modifiers = [...chosen.entries()].flatMap(([groupId, set]) =>
            (groups[groupId]?.options || []).filter((o) => set.has(o.id)));
          close();
          addItem(order.id, item, {
            qty, seat: ui.seat || null, course, modifiers, notes: note.value.trim(),
          })
            .then(() => toast(`${qty} × ${item.name} added`, 'good', 1600))
            .catch(failed);
        },
      },
    ],
  });
}

async function offerEightySix(item) {
  const ok = await confirm({
    title: item.eightySixed ? `Put ${item.name} back on?` : `86 ${item.name}?`,
    message: item.eightySixed
      ? 'It becomes orderable again straight away, on every terminal.'
      : 'It stays visible on the carte so a captain can tell a guest it has gone, '
        + 'but nobody in the building can order it.',
    confirmLabel: item.eightySixed ? 'Put back on' : 'Mark 86',
    tone: item.eightySixed ? 'primary' : 'danger',
  });
  if (!ok) return;
  try {
    await setEightySix(item.id, !item.eightySixed);
    toast(item.eightySixed ? `${item.name} back on` : `${item.name} is 86`, 'warn');
  } catch (error) { failed(error); }
}

/* --------------------------------------------------------------- pad --- */

function renderPad(order, totals, held) {
  const pacing = coursePacing(order);
  const ready = heldCourses(order);
  const heldCount = held.reduce((n, l) => n + l.qty, 0);

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
      h(`div.pace.pace--${entry.state}`, {
        title: `${entry.course.label} — ${paceWord(entry.state)}`,
      }, [
        h('div.pace__label', { text: entry.course.short }),
        h('div.pace__state', {
          text: entry.count ? `${entry.count} · ${paceWord(entry.state)}` : '—',
        }),
      ]))),

    h('div.pad__lines', {}, order.lines.length
      ? COURSES.flatMap((course) => {
        const lines = order.lines.filter((l) => l.course === course.id);
        if (!lines.length) return [];
        const hasHeld = lines.some((l) => l.status === KOT_STATUS.HELD);
        return [
          h('div.course-head', {}, [
            h('span.course-head__label', { text: course.label }),
            h('span.course-head__line'),
            hasHeld
              ? h('button.btn.btn--gold.btn--xs', {
                type: 'button',
                onclick: () => doFire(order, course.id),
              }, [icon('fire', { size: 13 }), 'Fire'])
              : null,
          ]),
          ...lines.map((line) => renderLine(order, line)),
        ];
      })
      : empty('Nothing written yet', 'Tap a dish on the left to start the order.')),

    h('div.pad__foot', {}, [
      heldCount
        ? notice(
          `${plural(heldCount, 'item')} waiting to go to the kitchen across `
          + `${plural(ready.length, 'course')}.`,
          'warn', 'clock'
        )
        : null,

      h('div.totals', {}, [
        totalRow('Items', money(totals.gross)),
        totals.comps ? totalRow('Compliments', `− ${money(totals.comps)}`) : null,
        totals.discount ? totalRow('Discount', `− ${money(totals.discount)}`) : null,
        totals.serviceCharge ? totalRow('Service charge', money(totals.serviceCharge)) : null,
        totalRow('Tax', money(totals.taxTotal)),
        h('div.totals__row.totals__row--grand', {}, [
          h('span', { text: 'Running total' }),
          h('span.u-num', { text: money(totals.total) }),
        ]),
      ]),

      h('div.pad__actions', {}, [
        h('button.btn.btn--gold', {
          type: 'button',
          disabled: !heldCount,
          onclick: () => doFire(order, null),
        }, [
          icon('fire', { size: 17 }),
          heldCount ? `Fire ${heldCount}` : 'Nothing held',
        ]),
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

function renderLine(order, line) {
  const kot = order.kots.find((k) => k.id === line.kotId);

  return h(`div.ln.ln--${line.status.toLowerCase()}${line.comp ? '.ln--comp' : ''}`, {}, [
    h('span.ln__qty', { text: String(line.qty) }),

    h('div', {}, [
      h('div.ln__name', { text: line.name }),
      line.modifiers.length
        ? h('div.ln__mods', { text: line.modifiers.map((m) => m.label).join(' · ') })
        : null,
      line.notes
        ? h('div.ln__note', {}, [icon('warn', { size: 12 }), line.notes])
        : null,
      h('div.ln__tags', {}, [
        line.seat ? h('span.ln__tag', { text: `Seat ${line.seat}` }) : null,
        h('span.ln__tag', { text: stationById(line.station).short }),
        line.status !== KOT_STATUS.HELD && kot
          ? h('span.ln__tag', { text: `${kot.code} · ${statusWord(line.status)}` })
          : h('span.ln__tag', { text: 'held' }),
        line.comp ? h('span.ln__tag', { text: 'comped' }) : null,
        line.status === KOT_STATUS.VOID
          ? h('span.ln__tag', { text: line.voidReason })
          : null,
      ]),
    ]),

    h('div.ln__right', {}, [
      h('span.ln__total', { text: line.comp ? '—' : money(lineGross(line)) }),
      h('div.ln__actions', {}, lineActions(order, line)),
    ]),
  ]);
}

const statusWord = (status) => ({
  FIRED: 'cooking', READY: 'on pass', SERVED: 'served', VOID: 'void',
}[status] || status.toLowerCase());

function lineActions(order, line) {
  if (line.status === KOT_STATUS.VOID) return [];

  if (line.status === KOT_STATUS.HELD) {
    return [
      h('div.stepper', {}, [
        h('button', {
          type: 'button',
          'aria-label': 'One fewer',
          onclick: () => changeQty(order.id, line.id, line.qty - 1).catch(failed),
        }, icon('minus', { size: 14 })),
        h('span.stepper__value', { text: String(line.qty) }),
        h('button', {
          type: 'button',
          'aria-label': 'One more',
          onclick: () => changeQty(order.id, line.id, line.qty + 1).catch(failed),
        }, icon('plus', { size: 14 })),
      ]),
      h('button.btn.btn--ghost.btn--icon.btn--sm', {
        type: 'button',
        'aria-label': 'Remove',
        onclick: () => dropLine(order.id, line.id).catch(failed),
      }, icon('trash', { size: 15 })),
    ];
  }

  // Once it has been cooked, the only ways out are a void or a comp, and both
  // need a manager's PIN. That is the whole point of the distinction.
  //
  // Both buttons are shown to every role on purpose: the manager walks over
  // and types four digits. Hiding them from a captain would only mean the
  // captain hands the tablet over, which is the same thing with more steps.
  return [
    h('button.btn.btn--ghost.btn--icon.btn--sm', {
      type: 'button',
      'aria-label': line.comp ? 'Remove the compliment' : 'Put this on the house',
      title: line.comp ? 'Remove the compliment' : 'On the house',
      onclick: () => doComp(order, line),
    }, icon('star', { size: 15 })),
    h('button.btn.btn--ghost.btn--icon.btn--sm', {
      type: 'button',
      'aria-label': 'Void',
      title: 'Void this line',
      onclick: () => doVoid(order, line),
    }, icon('close', { size: 15 })),
  ];
}

async function doVoid(order, line) {
  const approval = await authorise({
    title: `Void ${line.qty} × ${line.name}?`,
    subtitle: 'This dish has already gone to the kitchen.',
    ability: 'void',
  });
  if (!approval) return;

  const reason = await askReason({
    title: 'Why is it being voided?',
    subtitle: 'It stays on the bill as a voided line so the day’s figures still add up.',
    reasons: VOID_REASONS,
  });
  if (!reason) return;

  try {
    await killLine(order.id, line.id, reason, approval.pin);
    toast('Line voided and logged', 'warn');
  } catch (error) { failed(error); }
}

async function doComp(order, line) {
  if (line.comp) {
    const approval = await authorise({
      title: `Charge for ${line.name} after all?`,
      ability: 'comp',
    });
    if (!approval) return;
    toggleComp(order.id, line.id, '', approval.pin).catch(failed);
    return;
  }

  const approval = await authorise({
    title: `Put ${line.name} on the house?`,
    ability: 'comp',
  });
  if (!approval) return;

  const reason = await askReason({
    title: 'Reason for the compliment',
    reasons: COMP_REASONS,
    confirmLabel: 'Comp it',
    tone: 'primary',
  });
  if (!reason) return;

  try {
    await toggleComp(order.id, line.id, reason, approval.pin);
    toast('Comped and logged', 'good');
  } catch (error) { failed(error); }
}

/* -------------------------------------------------------------- fire --- */

/**
 * Fire, then print. One docket per station, each shown as a preview so
 * anyone watching can see exactly what the tandoor gets and what the pastry
 * section gets.
 */
async function doFire(order, courseId) {
  let kots;
  try {
    kots = await fire(order.id, courseId);
  } catch (error) {
    failed(error);
    return;
  }

  const label = courseId ? courseById(courseId).label : 'the table';
  toast(`${kots.length} docket${kots.length > 1 ? 's' : ''} sent for ${label}`, 'good');
  showDockets(orderById(order.id), kots, {
    title: 'Sent to the kitchen',
    subtitle: kots.map((k) => stationById(k.station).label).join(' · '),
  });
}

export function showDockets(order, kots, { title, subtitle } = {}) {
  dialog({
    title: title || 'Kitchen dockets',
    subtitle: subtitle || `${kots.length} station${kots.length > 1 ? 's' : ''}`,
    size: 'wide',
    body: h('div.grid', { style: { gap: '14px' } }, [
      notice(
        'Each station gets only its own dishes. In a live install these go '
        + 'straight to the printer at that section; here they are shown so you '
        + 'can see the split.',
        'info'
      ),
      h('div.preview', {}, kots.map((kot) => renderKot(order, kot))),
    ]),
    actions: [
      { label: 'Close', onclick: (close) => close() },
      {
        label: 'Print dockets',
        tone: 'primary',
        onclick: () => {
          const fresh = orderById(order.id) || order;
          for (const kot of kots) markReprint(kot.id).catch(() => {});
          printDocs(kots.map((kot) => renderKot(fresh, kot)));
        },
      },
    ],
  });
}

/* ------------------------------------------------------ table details --- */

function openTableDetails(order) {
  const covers = h('input.input', {
    type: 'number', min: '1', max: '60', value: String(order.covers),
  });
  const guest = h('input.input', { value: order.guestName, maxLength: 80 });
  const note = h('textarea.textarea', {
    text: order.notes,
    maxLength: 400,
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
        ? notice(
          `Seats in use: ${seatsUsed(order).join(', ')}. The bill can be split by seat.`,
          'info'
        )
        : null,
    ]),
    actions: [
      { label: 'Cancel', onclick: (close) => close() },
      {
        label: 'Save',
        tone: 'primary',
        onclick: (close) => {
          close();
          updateOrder(order.id, {
            covers: Number(covers.value) || order.covers,
            guestName: guest.value.trim(),
            notes: note.value.trim(),
          })
            .then(() => toast('Table updated', 'good'))
            .catch(failed);
        },
      },
    ],
  });
}
