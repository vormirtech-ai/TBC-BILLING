/**
 * Menu manager.
 *
 * Two jobs, and they are not the same job. Changing a price is an accounting
 * decision a manager makes between services. Marking something 86 is an
 * operational decision a captain makes mid-service when the last portion of sea
 * bass walks out of the kitchen — so it is one tap from here and from the order
 * screen, and it never touches the price.
 */

import { h, fill } from '../core/dom.js';
import { money, toPaise } from '../shared/money.js';
import { CATEGORIES } from '../shared/catalogue.js';
import { STATIONS, COURSES, stationById, courseById, ALLERGENS } from '../shared/config.js';
import { clockTime } from '../shared/format.js';
import { menu, setEightySix, updateMenuItem, addMenuItem, can } from '../state.js';
import { setTopbar, repaint } from '../ui/shell.js';
import {
  dialog, toast, icon, empty, chip, segmented, notice, } from '../ui/components.js';

let category = 'all';
let query = '';

export function renderMenuAdmin(host) {
  const items = menu();
  const off = items.filter((i) => i.eightySixed);

  setTopbar({
    title: 'Menu',
    subtitle: `${items.filter((i) => i.active).length} dishes on the carte · `
      + `${off.length} marked 86 tonight`,
  });

  const shown = items.filter((item) =>
    (category === 'all' || item.category === category)
    && (!query || item.name.toLowerCase().includes(query.toLowerCase())));

  fill(host, h('div.view__pad.grid', { style: { gap: '16px' } }, [
    off.length ? renderEightySixBoard(off) : null,

    h('div.u-row.u-wrap', { style: { gap: '10px' } }, [
      h('div.search', { style: { flex: '1', minWidth: '200px', maxWidth: '340px' } }, [
        h('span.search__icon', {}, icon('search', { size: 17 })),
        h('input.input', {
          type: 'search', placeholder: 'Find a dish…', value: query,
          oninput: (event) => { query = event.target.value; repaint(); },
        }),
      ]),
      segmented(
        [{ id: 'all', label: 'All' }, ...CATEGORIES.map((c) => ({ id: c.id, label: c.label }))],
        category,
        (id) => { category = id; repaint(); }
      ),
      can('settings')
        ? h('button.btn.btn--primary.btn--sm', {
          type: 'button',
          style: { marginLeft: 'auto' },
          onclick: () => editItem(null),
        }, [icon('plus', { size: 16 }), 'Add a dish'])
        : null,
    ]),

    shown.length ? h('section.card', {}, [
      h('div', { style: { overflowX: 'auto' } },
        h('table.table', {}, [
          h('thead', {}, h('tr', {}, [
            h('th', { text: 'Dish' }),
            h('th', { text: 'Section' }),
            h('th', { text: 'Kitchen' }),
            h('th', { text: 'Course' }),
            h('th.num', { text: 'Price' }),
            h('th.num', { text: 'Food cost' }),
            h('th.num', { text: 'Margin' }),
            h('th', { text: 'Tonight' }),
          ])),
          h('tbody', {}, shown.map(renderRow)),
        ])),
    ]) : empty('Nothing matches', 'Try a shorter search.'),
  ]));
}

function renderEightySixBoard(off) {
  return h('section.card', { style: { borderColor: 'var(--danger-tint)' } }, [
    h('div.card__head', {}, [
      h('span', { style: { color: 'var(--danger)' } }, icon('warn', { size: 18 })),
      h('h2.card__title', { text: 'The 86 board' }),
      h('span.stat__note', { text: 'Visible on every order screen in the building' }),
    ]),
    h('div.card__body.card__body--tight', {},
      h('div.u-row.u-wrap', { style: { gap: '8px' } }, off.map((item) => {
        const entry = item.eightySix;
        return h('button.btn.btn--quiet-danger.btn--sm', {
          type: 'button',
          title: entry
            ? `Marked by ${entry.by} at ${clockTime(entry.at)}`
              + (entry.note ? ` — ${entry.note}` : '')
            : '',
          onclick: () => setEightySix(item.id, false)
            .then(() => toast(`${item.name} back on`, 'good'))
            .catch((error) => toast(error.message, 'bad', 4000)),
        }, [item.name, icon('close', { size: 14 })]);
      }))),
  ]);
}

function renderRow(item) {
  const margin = item.pricePaise
    ? ((item.pricePaise - item.costPaise) / item.pricePaise) * 100
    : 0;

  return h('tr', { class: item.active ? '' : 'tr--retired' }, [
    h('td', {}, h('div.u-row', { style: { gap: '8px' } }, [
      h('span', { class: `diet diet--${item.diet.toLowerCase()}` }),
      h('div', {}, [
        h('div', { style: { fontWeight: '600' } }, [
          item.name,
          item.active ? null : chip('Off the menu', 'outline'),
          item.signature ? h('span', { style: { color: 'var(--gold)', marginLeft: '5px' } }, icon('star', { size: 12, fill: 'currentColor' })) : null,
        ]),
        item.allergens?.length
          ? h('div.stat__note', { text: item.allergens.map((a) => ALLERGENS[a] || a).join(', ') })
          : null,
      ]),
    ])),
    h('td', { text: CATEGORIES.find((c) => c.id === item.category)?.label || item.category }),
    h('td', {}, chip(stationById(item.station).label, 'outline')),
    h('td', { text: courseById(item.course).label }),
    h('td.num', { text: money(item.pricePaise) }),
    h('td.num', { text: money(item.costPaise) }),
    h('td.num', {}, h('span', {
      class: margin >= 65 ? 'delta delta--up' : 'delta',
      text: `${margin.toFixed(0)}%`,
    })),
    h('td', {}, h('div.u-row', { style: { gap: '6px' } }, [
      item.active
        ? h('button.btn.btn--outline.btn--xs', {
          type: 'button',
          text: item.eightySixed ? 'Put back on' : '86 it',
          onclick: () => toggle86(item),
        })
        : null,
      can('settings') ? h('button.btn.btn--ghost.btn--icon.btn--xs', {
        type: 'button', 'aria-label': `Edit ${item.name}`,
        onclick: () => editItem(item),
      }, icon('edit', { size: 14 })) : null,
    ])),
  ]);
}

async function toggle86(item) {
  if (item.eightySixed) {
    try {
      await setEightySix(item.id, false);
      toast(`${item.name} back on the carte`, 'good');
    } catch (error) { toast(error.message, 'bad', 4000); }
    return;
  }

  const note = h('input.input', { placeholder: 'Why? (shown to the captains)' });
  dialog({
    title: `Mark ${item.name} as 86?`,
    subtitle: 'It stays on the carte so a captain can tell a guest it has gone, but nobody can order it.',
    size: 'slim',
    body: h('div.field', {}, [h('label.field__label', { text: 'Note' }), note]),
    actions: [
      { label: 'Cancel', onclick: (close) => close() },
      {
        label: 'Mark 86', tone: 'danger', autofocus: true,
        onclick: (close) => {
          close();
          setEightySix(item.id, true, note.value.trim())
            .then(() => toast(`${item.name} is 86 on every terminal`, 'warn'))
            .catch((error) => toast(error.message, 'bad', 4000));
        },
      },
    ],
  });
}

/**
 * The whole dish, not just its price.
 *
 * A restaurant changes its carte with the season and should not need us to
 * do it. The one thing that cannot be changed is that a dish is retired
 * rather than deleted: every line of every bill ever taken points at it, and
 * a bill from last March has to still say what was eaten.
 */
function editItem(item) {
  const isNew = !item;
  const dish = item || {
    name: '', category: category === 'all' ? CATEGORIES[0].id : category,
    station: STATIONS[0].id, course: COURSES[1]?.id || COURSES[0].id,
    pricePaise: 0, costPaise: 0, description: '', diet: 'VEG', active: true,
  };

  const name = h('input.input', { value: dish.name, maxLength: 80, placeholder: 'Lamb Shank Harissa' });
  const description = h('input.input', {
    value: dish.description || '', maxLength: 240,
    placeholder: 'Braised eight hours, preserved lemon',
  });
  const price = h('input.input', {
    type: 'number', step: '1', min: '0', inputmode: 'decimal',
    value: dish.pricePaise ? String(dish.pricePaise / 100) : '',
  });
  const cost = h('input.input', {
    type: 'number', step: '1', min: '0', inputmode: 'decimal',
    value: dish.costPaise ? String(dish.costPaise / 100) : '',
  });

  const choose = (list, selected) => h('select.select', {}, list.map((entry) =>
    h('option', { value: entry.id, text: entry.label, selected: entry.id === selected })));

  const section = choose(CATEGORIES, dish.category);
  const station = choose(STATIONS, dish.station);
  const course = choose(COURSES, dish.course);
  const diet = choose(
    [{ id: 'VEG', label: 'Vegetarian' }, { id: 'NON_VEG', label: 'Non-vegetarian' }],
    dish.diet || 'VEG'
  );

  const preview = h('p.field__hint');
  const paint = () => {
    const sell = toPaise(price.value);
    const food = toPaise(cost.value);
    preview.textContent = sell
      ? `Gross margin ${(((sell - food) / sell) * 100).toFixed(1)}% · ${money(sell - food)} a plate.`
      : 'Set a price to see the margin.';
  };
  price.addEventListener('input', paint);
  cost.addEventListener('input', paint);
  paint();

  const field = (label, control, hint) => h('div.field', {}, [
    h('label.field__label', { text: label }),
    control,
    hint ? h('p.field__hint', { text: hint }) : null,
  ]);

  const two = (a, b) => h('div.grid', { style: { gap: '13px', gridTemplateColumns: '1fr 1fr' } }, [a, b]);

  const actions = [{ label: 'Cancel', onclick: (close) => close() }];

  if (!isNew) {
    actions.push({
      label: dish.active ? 'Take off the menu' : 'Put back on',
      tone: dish.active ? 'quiet-danger' : 'outline',
      onclick: (close) => {
        close();
        updateMenuItem(dish.id, { active: !dish.active })
          .then(() => toast(
            `${dish.name} ${dish.active ? 'taken off the menu' : 'is back on'}`, 'good'))
          .catch((error) => toast(error.message, 'bad', 4000));
      },
    });
  }

  actions.push({
    label: isNew ? 'Add to the carte' : 'Save',
    tone: 'primary',
    onclick: (close) => {
      const body = {
        name: name.value.trim(),
        description: description.value.trim(),
        category: section.value,
        station: station.value,
        course: course.value,
        diet: diet.value,
        pricePaise: toPaise(price.value),
        costPaise: toPaise(cost.value),
      };
      if (!body.name) {
        toast('A dish needs a name', 'bad');
        return;
      }
      close();
      (isNew ? addMenuItem(body) : updateMenuItem(dish.id, body))
        .then((saved) => toast(
          `${saved.name} ${isNew ? 'added to the carte' : 'updated'}`, 'good'))
        .catch((error) => toast(error.message, 'bad', 5000));
    },
  });

  dialog({
    title: isNew ? 'A new dish' : dish.name,
    subtitle: isNew
      ? 'It appears on every order screen in the building as soon as it is saved'
      : `${stationById(dish.station).label} · ${courseById(dish.course).label}`,
    body: h('div.grid', { style: { gap: '13px' } }, [
      field('Name', name),
      field('On the menu, under it', description, 'Optional. Printed under the dish.'),
      two(field('Menu section', section), field('Course', course,
        'When the kitchen is allowed to start it')),
      two(field('Kitchen station', station, 'Whose docket it lands on'), field('Diet', diet)),
      two(field('Menu price (₹)', price), field('Food cost (₹)', cost)),
      preview,
      notice(
        isNew
          ? 'Nothing here is final — a price, a section or a station can be '
          + 'changed at any time, and a dish is taken off the menu rather than '
          + 'deleted so that old bills still say what was eaten.'
          : 'Changing a price here affects new lines only. Anything already written '
          + 'on an open table keeps the price it was ordered at, which is the only '
          + 'honest way to handle a mid-service change.',
        'info'
      ),
    ]),
    actions,
  });
}
