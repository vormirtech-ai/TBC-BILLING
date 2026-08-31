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
import { money, toPaise } from '../core/money.js';
import { CATEGORIES } from '../data/menu.seed.js';
import { stationById, courseById, ALLERGENS } from '../config.js';
import { clockTime } from '../core/format.js';
import { menu, setEightySix, setMenuOverride, getState, can } from '../state.js';
import { setTopbar } from '../ui/shell.js';
import {
  dialog, toast, icon, empty, chip, segmented, notice, } from '../ui/components.js';

let category = 'all';
let query = '';

export function renderMenuAdmin(host) {
  const items = menu();
  const off = items.filter((i) => i.eightySixed);

  setTopbar({
    title: 'Menu',
    subtitle: `${items.length} dishes · ${off.length} marked 86 tonight`,
  });

  const shown = items.filter((item) =>
    (category === 'all' || item.category === category)
    && (!query || item.name.toLowerCase().includes(query.toLowerCase())));

  fill(host, h('div.view__pad.grid', { style: { gap: '16px' } }, [
    off.length ? renderEightySixBoard(host, off) : null,

    h('div.u-row.u-wrap', { style: { gap: '10px' } }, [
      h('div.search', { style: { flex: '1', minWidth: '200px', maxWidth: '340px' } }, [
        h('span.search__icon', {}, icon('search', { size: 17 })),
        h('input.input', {
          type: 'search', placeholder: 'Find a dish…', value: query,
          oninput: (event) => { query = event.target.value; renderMenuAdmin(host); },
        }),
      ]),
      segmented(
        [{ id: 'all', label: 'All' }, ...CATEGORIES.map((c) => ({ id: c.id, label: c.label }))],
        category,
        (id) => { category = id; renderMenuAdmin(host); }
      ),
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
          h('tbody', {}, shown.map((item) => renderRow(host, item))),
        ])),
    ]) : empty('Nothing matches', 'Try a shorter search.'),
  ]));
}

function renderEightySixBoard(host, off) {
  const log = getState().eightySix;
  return h('section.card', { style: { borderColor: 'var(--danger-tint)' } }, [
    h('div.card__head', {}, [
      h('span', { style: { color: 'var(--danger)' } }, icon('warn', { size: 18 })),
      h('h2.card__title', { text: 'The 86 board' }),
      h('span.stat__note', { text: 'Visible on every order screen in the building' }),
    ]),
    h('div.card__body.card__body--tight', {},
      h('div.u-row.u-wrap', { style: { gap: '8px' } }, off.map((item) => {
        const entry = log.find((e) => e.itemId === item.id);
        return h('button.btn.btn--quiet-danger.btn--sm', {
          type: 'button',
          title: entry ? `Marked by ${entry.by} at ${clockTime(entry.at)}${entry.note ? ` — ${entry.note}` : ''}` : '',
          onclick: () => { setEightySix(item.id, false); toast(`${item.name} back on`, 'good'); renderMenuAdmin(host); },
        }, [item.name, icon('close', { size: 14 })]);
      }))),
  ]);
}

function renderRow(host, item) {
  const margin = item.pricePaise
    ? ((item.pricePaise - item.costPaise) / item.pricePaise) * 100
    : 0;

  return h('tr', {}, [
    h('td', {}, h('div.u-row', { style: { gap: '8px' } }, [
      h('span', { class: `diet diet--${item.diet.toLowerCase()}` }),
      h('div', {}, [
        h('div', { style: { fontWeight: '600' } }, [
          item.name,
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
      h('button.btn.btn--outline.btn--xs', {
        type: 'button',
        text: item.eightySixed ? 'Put back on' : '86 it',
        onclick: () => toggle86(host, item),
      }),
      can('settings') ? h('button.btn.btn--ghost.btn--icon.btn--xs', {
        type: 'button', 'aria-label': 'Edit price',
        onclick: () => editItem(host, item),
      }, icon('edit', { size: 14 })) : null,
    ])),
  ]);
}

async function toggle86(host, item) {
  if (item.eightySixed) {
    setEightySix(item.id, false);
    toast(`${item.name} back on the carte`, 'good');
    renderMenuAdmin(host);
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
          setEightySix(item.id, true, note.value.trim());
          close();
          toast(`${item.name} is 86`, 'warn');
          renderMenuAdmin(host);
        },
      },
    ],
  });
}

function editItem(host, item) {
  const price = h('input.input', {
    type: 'number', step: '1', min: '0', value: String(item.pricePaise / 100),
  });
  const cost = h('input.input', {
    type: 'number', step: '1', min: '0', value: String(item.costPaise / 100),
  });
  const preview = h('p.setting__hint');

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

  dialog({
    title: item.name,
    subtitle: `${stationById(item.station).label} · ${courseById(item.course).label}`,
    size: 'slim',
    body: h('div.grid', { style: { gap: '13px' } }, [
      h('div.grid', { style: { gap: '13px', gridTemplateColumns: '1fr 1fr' } }, [
        h('div.field', {}, [h('label.field__label', { text: 'Menu price (₹)' }), price]),
        h('div.field', {}, [h('label.field__label', { text: 'Food cost (₹)' }), cost]),
      ]),
      preview,
      notice(
        'Changing a price here affects new lines only. Anything already written on '
        + 'an open table keeps the price it was ordered at, which is the only honest '
        + 'way to handle a mid-service change.',
        'info'
      ),
    ]),
    actions: [
      { label: 'Cancel', onclick: (close) => close() },
      {
        label: 'Save', tone: 'primary',
        onclick: (close) => {
          setMenuOverride(item.id, {
            pricePaise: toPaise(price.value),
            costPaise: toPaise(cost.value),
          });
          close();
          renderMenuAdmin(host);
          toast(`${item.name} updated`, 'good');
        },
      },
    ],
  });
}
