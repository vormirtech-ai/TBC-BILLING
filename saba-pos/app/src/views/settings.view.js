/**
 * Setup.
 *
 * The parts an owner actually changes: the restaurant's details on the bill,
 * the staff who can sign in, and the backup. Everything on this screen talks
 * to the till, so a change made here is a change everywhere in the building
 * within a second.
 */

import { h, fill } from '../core/dom.js';
import { money, toPaise } from '../shared/money.js';
import { charges } from '../shared/pricing.js';
import { sections, tables as planTables, tablesInSection } from '../shared/floorplan.js';
import { longDate, clockTime, plural } from '../shared/format.js';
import {
  APP, STATIONS, COURSES, ROLE_LABELS, ROLE_ORDER, ROLE_ABILITIES,
} from '../shared/config.js';
import {
  settings, saveSettings, users, addUser, updateUser, session, can,
  takeBackup, downloadLinks, terminals, resetDemo, openOrders, settledToday,
  businessDay, api,
} from '../state.js';
import { setTopbar, repaint } from '../ui/shell.js';
import {
  setting, confirm, toast, icon, notice, chip, dialog, segmented, caps, empty,
} from '../ui/components.js';

/** Screen-local: fetched lists that are not part of the live working set. */
let staff = null;
let liveTerminals = null;
let loading = false;

export function renderSettings(host) {
  setTopbar({
    title: 'Setup',
    subtitle: `${APP.suite} ${APP.version}`,
  });

  if (!staff && !loading) load();

  const profile = settings().restaurant || {};

  fill(host, h('div.view__pad.grid', { style: { gap: '16px', maxWidth: '940px' } }, [
    renderProfile(profile),
    renderPeople(),
    renderCharges(),
    renderRoom(),
    renderKitchen(),
    renderPrinting(),
    renderData(),
    h('p.stat__note', {
      style: { textAlign: 'center', padding: '10px 0 24px' },
      text: `${APP.suite} ${APP.version} · no telemetry, no outbound connections`,
    }),
  ]));
}

async function load() {
  loading = true;
  try {
    if (can('users')) staff = await users();
    if (can('settings')) liveTerminals = await terminals().catch(() => null);
  } catch (error) {
    toast(error.message, 'bad', 4000);
  } finally {
    loading = false;
    repaint();
  }
}

/* ------------------------------------------------------------ profile --- */

function renderProfile(profile) {
  const editable = can('settings');
  const field = (key, label, value, hint) => setting(label, hint,
    editable
      ? h('button.btn.btn--outline.btn--sm', {
        type: 'button',
        text: value || 'Not set',
        onclick: () => editProfileField(key, label, value, profile),
      })
      : h('span', { text: value || '—', style: { fontWeight: '600', fontSize: '13.5px' } }));

  return card('The restaurant', 'Printed at the top of every bill', [
    field('name', 'Name', profile.name),
    field('legalName', 'Legal name', profile.legalName, 'Used on the tax invoice'),
    field('tagline', 'Tagline', profile.tagline),
    field('addressLines', 'Address', (profile.addressLines || []).join(', ')),
    field('phone', 'Telephone', profile.phone),
    field('email', 'Email', profile.email),
    field('gstin', 'GSTIN', profile.gstin),
    field('fssai', 'FSSAI licence', profile.fssai),
  ]);
}

function editProfileField(key, label, value, profile) {
  const isList = key === 'addressLines';
  const input = isList
    ? h('textarea.textarea', { text: (profile.addressLines || []).join('\n') })
    : h('input.input', { value: value || '', maxLength: 120 });

  dialog({
    title: label,
    subtitle: isList ? 'One line per line of the address' : null,
    size: 'slim',
    body: h('div.field', {}, [h('label.field__label', { text: label }), input]),
    actions: [
      { label: 'Cancel', onclick: (close) => close() },
      {
        label: 'Save',
        tone: 'primary',
        onclick: (close) => {
          close();
          const next = isList
            ? input.value.split('\n').map((l) => l.trim()).filter(Boolean)
            : input.value.trim();
          saveSettings({ restaurant: { ...profile, [key]: next } })
            .then(() => toast(`${label} updated`, 'good'))
            .catch((error) => toast(error.message, 'bad', 4000));
        },
      },
    ],
  });
}

/* ------------------------------------------------------------- people --- */

function renderPeople() {
  const me = session();

  if (!can('users')) {
    return card('You', null, [
      setting(me.name, ROLE_LABELS[me.role],
        chip(me.role, 'navy')),
      setting('Your PIN', 'Ask a manager to change it for you', chip('••••', 'outline')),
    ]);
  }

  if (!staff) return card('People', null, empty('Asking the till…'));

  return card('People', `${plural(staff.filter((u) => u.active).length, 'person')} can sign in`, [
    ...staff.map((person) => setting(
      person.name,
      `${ROLE_LABELS[person.role]} · can ${describeAbilities(person.role)}`,
      h('div.u-row', { style: { gap: '6px' } }, [
        person.active ? null : chip('Switched off', 'danger'),
        person.id === me.id ? chip('You', 'navy') : null,
        h('button.btn.btn--outline.btn--xs', {
          type: 'button', text: 'Edit', onclick: () => editPerson(person),
        }),
      ])
    )),
    setting('Add somebody', 'They sign in with a PIN of their own',
      h('button.btn.btn--primary.btn--sm', {
        type: 'button', onclick: () => editPerson(null),
      }, [icon('plus', { size: 16 }), 'Add'])),
  ]);
}

const describeAbilities = (role) => {
  const list = ROLE_ABILITIES[role] || [];
  if (!list.length) return 'work the kitchen display';
  const friendly = {
    void: 'void', discount: 'discount', comp: 'comp', reopen: 'reopen bills',
    settings: 'change setup', users: 'manage staff', shift: 'run the till',
    export: 'export', backup: 'back up', eightySix: '86 dishes', reprint: 'reprint',
  };
  return list.map((a) => friendly[a] || a).join(', ');
};

function editPerson(person) {
  const isNew = !person;
  const name = h('input.input', { value: person?.name || '', maxLength: 60 });
  const role = h('select.select', {}, ROLE_ORDER.map((r) =>
    h('option', { value: r, text: ROLE_LABELS[r], selected: person?.role === r })));
  const pin = h('input.input', {
    type: 'password', inputMode: 'numeric', maxLength: 8, autocomplete: 'new-password',
    placeholder: isNew ? 'Four to eight digits' : 'Leave blank to keep the current PIN',
  });
  const active = h('input', { type: 'checkbox', checked: person ? person.active : true });

  dialog({
    title: isNew ? 'Add somebody' : person.name,
    subtitle: isNew
      ? 'They will sign in by typing this PIN at any terminal.'
      : 'Changing a PIN signs that person out of every terminal.',
    size: 'slim',
    body: h('div.grid', { style: { gap: '13px' } }, [
      h('div.field', {}, [h('label.field__label', { text: 'Name' }), name]),
      h('div.field', {}, [h('label.field__label', { text: 'Role' }), role]),
      h('div.field', {}, [
        h('label.field__label', { text: isNew ? 'PIN' : 'New PIN' }),
        pin,
        h('p.setting__hint', {
          text: 'No repeated digits and no runs — 1111 and 1234 are refused.',
        }),
      ]),
      isNew ? null : h('label.switch', {}, [
        active,
        h('span.switch__track'),
        h('span', { text: 'Can sign in', style: { fontSize: '13.5px', fontWeight: '600' } }),
      ]),
      notice(
        'PINs are stored hashed. Nobody — including a manager — can read one '
        + 'back; a forgotten PIN is replaced, not recovered.',
        'info'
      ),
    ]),
    actions: [
      { label: 'Cancel', onclick: (close) => close() },
      {
        label: isNew ? 'Add' : 'Save',
        tone: 'primary',
        onclick: async (close) => {
          try {
            if (isNew) {
              await addUser({ name: name.value, role: role.value, pin: pin.value });
            } else {
              await updateUser(person.id, {
                name: name.value,
                role: role.value,
                active: active.checked,
                ...(pin.value ? { pin: pin.value } : {}),
              });
            }
            close();
            staff = await users();
            repaint();
            toast(isNew ? `${name.value} can now sign in` : 'Saved', 'good');
          } catch (error) {
            toast(error.message, 'bad', 5000);
          }
        },
      },
    ],
  });
}

/* ------------------------------------------------------------ charges --- */

/*
 * These are the numbers an owner changes and a programmer should not have to.
 * GST is not one rate, service charge is not universal, and a restaurant that
 * drops it should not need a new build to do so. Everything here is stored,
 * checked by the server, and in force on every terminal within a second.
 */

function renderCharges() {
  const c = charges();
  const editable = can('settings');
  const pc = (bps) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`;

  const value = (text, tone, onclick) => (editable
    ? h('button.btn.btn--outline.btn--sm', { type: 'button', text, onclick })
    : chip(text, tone));

  return card('Charges and tax',
    editable ? 'What the guest is charged, and what the restaurant owes on it' : null, [
      setting(
        c.serviceChargeLabel,
        `${pc(c.serviceChargeBps)} applied to food and drink after any discount, `
        + 'before tax. A cashier can take it off any bill without asking, because a '
        + 'guest requesting that should never become an argument.',
        value(c.serviceChargeBps ? pc(c.serviceChargeBps) : 'None', 'gold', editServiceCharge)
      ),

      ...c.taxComponents.map((component) => setting(
        component.label,
        `Charged at ${pc(component.bps)} on food, drink and service charge. `
        + 'Each component is worked out on the same taxable amount and never '
        + 'compounded on another.'
        + (editable ? ' Tap to change the rates, or to add or remove a line.' : ''),
        value(pc(component.bps), 'outline', editTaxes)
      )),

      c.taxComponents.length === 0
        ? setting('Tax', 'No tax is added to a bill on this install.',
          value('None', 'outline', editTaxes))
        : null,

      setting(
        'Round the total',
        'The payable total is rounded to the nearest rupee and the difference is '
        + 'printed as its own line, so the bill always adds up exactly.',
        editable
          ? h('button.btn.btn--outline.btn--sm', {
            type: 'button',
            text: c.roundOffEnabled ? 'On' : 'Off',
            onclick: () => save({ roundOffEnabled: !c.roundOffEnabled },
              `Rounding turned ${c.roundOffEnabled ? 'off' : 'on'}`),
          })
          : chip(c.roundOffEnabled ? 'On' : 'Off', c.roundOffEnabled ? 'olive' : 'outline')
      ),

      setting(
        'Discount needing approval',
        `Anything above ${c.discountApprovalPercent}% asks for a manager's PIN `
        + 'and records who gave it.',
        value(`${c.discountApprovalPercent}%`, 'outline', editApproval)
      ),

      setting(
        'Prices include tax',
        'Menu prices are exclusive; tax is added at settlement and shown as its '
        + 'own line, which is what a GST invoice has to show.',
        chip('Exclusive', 'outline')
      ),
    ].filter(Boolean));
}

/** Store a change to the tariff and say so. The server checks it first. */
function save(partial, message) {
  return saveSettings({ charges: { ...charges(), ...partial } })
    .then(() => toast(message, 'good'))
    .catch((error) => toast(error.message, 'bad', 5000));
}

/** A percentage field: typed as a percentage, stored as basis points. */
function percentField(label, bps, hint) {
  const input = h('input.input', {
    type: 'number', step: '0.25', min: '0',
    value: String(bps / 100),
    inputmode: 'decimal',
  });
  return {
    input,
    node: h('div.field', {}, [
      h('label.field__label', { text: label }),
      input,
      hint ? h('p.field__hint', { text: hint }) : null,
    ]),
  };
}

function editServiceCharge() {
  const c = charges();
  const name = h('input.input', { value: c.serviceChargeLabel, maxLength: 40 });
  const rate = percentField('Rate', c.serviceChargeBps,
    'Nought turns it off altogether. A cashier can still take it off one bill.');

  dialog({
    title: 'Service charge',
    size: 'slim',
    body: h('div.grid', { style: { gap: '14px' } }, [
      h('div.field', {}, [h('label.field__label', { text: 'Called' }), name]),
      rate.node,
    ]),
    actions: [
      { label: 'Cancel', onclick: (close) => close() },
      {
        label: 'Save',
        tone: 'primary',
        onclick: (close) => {
          close();
          save({
            serviceChargeLabel: name.value.trim() || 'Service Charge',
            serviceChargePercent: Number(rate.input.value),
          }, 'Service charge updated');
        },
      },
    ],
  });
}

function editTaxes() {
  const rows = charges().taxComponents.map((component) => ({ ...component }));
  const host = h('div.grid', { style: { gap: '12px' } });

  const paint = () => {
    fill(host, [
      ...rows.map((row, i) => h('div.u-row', { style: { gap: '8px', alignItems: 'flex-end' } }, [
        h('div.field.u-grow', {}, [
          h('label.field__label', { text: `Component ${i + 1}` }),
          h('input.input', {
            value: row.label, maxLength: 24, placeholder: 'CGST',
            oninput: (e) => { row.label = e.target.value; },
          }),
        ]),
        h('div.field', { style: { width: '92px' } }, [
          h('label.field__label', { text: 'Rate %' }),
          h('input.input', {
            type: 'number', step: '0.25', min: '0', inputmode: 'decimal',
            value: String(row.bps / 100),
            oninput: (e) => { row.bps = Math.round(Number(e.target.value) * 100); },
          }),
        ]),
        h('button.btn.btn--ghost.btn--icon.btn--sm', {
          type: 'button', 'aria-label': `Remove ${row.label || 'this component'}`,
          onclick: () => { rows.splice(i, 1); paint(); },
        }, icon('trash', { size: 16 })),
      ])),

      rows.length >= 4
        ? null
        : h('button.btn.btn--outline.btn--sm', {
          type: 'button',
          text: rows.length ? 'Add another' : 'Add a tax component',
          onclick: () => { rows.push({ id: '', label: '', bps: 0 }); paint(); },
        }),

      notice(
        'Each component is charged on the same taxable amount — items after '
        + 'discount, plus the service charge — and never on another component. '
        + 'For most Indian restaurants that is CGST and SGST at half the GST '
        + 'rate each.',
        'info', 'info'
      ),
    ]);
  };
  paint();

  dialog({
    title: 'Tax components',
    subtitle: 'As they are to be printed on the bill',
    body: host,
    actions: [
      { label: 'Cancel', onclick: (close) => close() },
      {
        label: 'Save',
        tone: 'primary',
        onclick: (close) => {
          close();
          save({ taxComponents: rows }, 'Tax updated');
        },
      },
    ],
  });
}

function editApproval() {
  const input = h('input.input', {
    type: 'number', min: '0', max: '100', step: '1', inputmode: 'numeric',
    value: String(charges().discountApprovalPercent),
  });

  dialog({
    title: 'Discount needing approval',
    size: 'slim',
    body: h('div.field', {}, [
      h('label.field__label', { text: 'Per cent' }),
      input,
      h('p.field__hint', {
        text: 'Above this, taking a discount asks for a manager\u2019s PIN at the '
          + 'moment it is given, and records who gave it. Nought makes every '
          + 'discount need one.',
      }),
    ]),
    actions: [
      { label: 'Cancel', onclick: (close) => close() },
      {
        label: 'Save',
        tone: 'primary',
        onclick: (close) => {
          close();
          save({ discountApprovalPercent: Number(input.value) },
            'Approval threshold updated');
        },
      },
    ],
  });
}

/* --------------------------------------------------------------- room --- */

/*
 * The room, as this restaurant has it. Tables are drawn on a plan rather than
 * listed as buttons, so the floor screen is a picture a captain can read at a
 * glance — which means a new table needs somewhere to go. It is placed in the
 * first free spot in its room, and nudged from the floor screen afterwards.
 */

function renderRoom() {
  const editable = can('settings');
  const rooms = sections();
  const all = planTables();

  return card('The room', `${rooms.length} rooms · ${plural(all.length, 'table')} · `
    + `${all.reduce((n, t) => n + t.seats, 0)} covers`, [
      ...rooms.map((room) => {
        const seats = tablesInSection(room.id);
        return setting(
          room.label,
          seats.length
            ? `${seats.map((t) => `${t.label} (${t.seats})`).join(' · ')}`
            : 'No tables in this room yet.',
          editable
            ? h('button.btn.btn--outline.btn--sm', {
              type: 'button', text: 'Edit', onclick: () => editRoom(room.id),
            })
            : chip(`${seats.reduce((n, t) => n + t.seats, 0)} covers`, 'outline')
        );
      }),

      editable
        ? setting('Another room', 'A terrace, a private room, a bar counter.',
          h('button.btn.btn--outline.btn--sm', {
            type: 'button', onclick: addRoom,
          }, [icon('plus', { size: 15 }), 'Add a room']))
        : null,
    ].filter(Boolean));
}

/** Store a whole plan. The server checks it and refuses to strand a table. */
function savePlan(next, message) {
  return saveSettings({ floorplan: next })
    .then(() => toast(message, 'good'))
    .catch((error) => toast(error.message, 'bad', 6000));
}

/**
 * Somewhere to put a new table.
 *
 * Tables sit on a 100×100 grid per room. A new one takes the first spot on a
 * four-by-four lattice that nothing is near, so it lands in open floor rather
 * than on top of table six.
 */
function freeSpot(roomId, existing) {
  const here = existing.filter((t) => t.sectionId === roomId);
  for (const y of [16, 40, 64, 88]) {
    for (const x of [14, 38, 62, 86]) {
      if (!here.some((t) => Math.abs(t.x - x) < 11 && Math.abs(t.y - y) < 11)) return { x, y };
    }
  }
  return { x: 50, y: 50 };
}

function addRoom() {
  const name = h('input.input', { maxLength: 40, placeholder: 'Garden Terrace' });
  dialog({
    title: 'A new room',
    size: 'slim',
    body: h('div.field', {}, [h('label.field__label', { text: 'Called' }), name]),
    actions: [
      { label: 'Cancel', onclick: (close) => close() },
      {
        label: 'Add',
        tone: 'primary',
        onclick: (close) => {
          const label = name.value.trim();
          if (!label) { toast('A room needs a name', 'bad'); return; }
          close();
          savePlan({
            sections: [...sections(), { id: '', label, short: label.slice(0, 12), note: '' }],
            tables: planTables(),
          }, `${label} added`);
        },
      },
    ],
  });
}

function editRoom(roomId) {
  const room = { ...sections().find((s) => s.id === roomId) };
  const others = planTables().filter((t) => t.sectionId !== roomId);
  const mine = tablesInSection(roomId).map((t) => ({ ...t }));

  const label = h('input.input', { value: room.label, maxLength: 40 });
  const note = h('input.input', {
    value: room.note || '', maxLength: 60, placeholder: 'Ground floor, 44 covers',
  });
  const host = h('div.grid', { style: { gap: '9px' } });

  const paint = () => {
    fill(host, [
      ...mine.map((table, i) => h('div.u-row', { style: { gap: '8px', alignItems: 'flex-end' } }, [
        h('div.field.u-grow', {}, [
          i === 0 ? h('label.field__label', { text: 'Table' }) : null,
          h('input.input', {
            value: table.label, maxLength: 12, placeholder: '12',
            oninput: (e) => { table.label = e.target.value; },
          }),
        ]),
        h('div.field', { style: { width: '94px' } }, [
          i === 0 ? h('label.field__label', { text: 'Seats' }) : null,
          h('input.input', {
            type: 'number', min: '1', max: '40', step: '1', inputmode: 'numeric',
            value: String(table.seats),
            oninput: (e) => { table.seats = Number(e.target.value); },
          }),
        ]),
        h('div.field', { style: { width: '112px' } }, [
          i === 0 ? h('label.field__label', { text: 'Shape' }) : null,
          h('select.select', {
            onchange: (e) => { table.shape = e.target.value; },
          }, [
            { id: 'round', label: 'Round' },
            { id: 'oval', label: 'Oval' },
            { id: 'long', label: 'Long' },
          ].map((shape) => h('option', {
            value: shape.id, text: shape.label, selected: (table.shape || 'round') === shape.id,
          }))),
        ]),
        h('button.btn.btn--ghost.btn--icon.btn--sm', {
          type: 'button', 'aria-label': `Remove table ${table.label}`,
          onclick: () => { mine.splice(i, 1); paint(); },
        }, icon('trash', { size: 16 })),
      ])),

      h('button.btn.btn--outline.btn--sm', {
        type: 'button',
        onclick: () => {
          mine.push({
            id: '', label: String(mine.length + 1), sectionId: roomId, seats: 2,
            shape: 'round', ...freeSpot(roomId, [...others, ...mine]),
          });
          paint();
        },
      }, [icon('plus', { size: 15 }), 'Add a table']),

      mine.length ? null : notice(
        'A room with no tables in it is shown on the floor screen as an empty '
        + 'section. Add the tables, or remove the room.',
        'info', 'info'
      ),
    ]);
  };
  paint();

  dialog({
    title: room.label,
    subtitle: 'Tables in this room',
    body: h('div.grid', { style: { gap: '14px' } }, [
      h('div.grid', { style: { gap: '13px', gridTemplateColumns: '1fr 1fr' } }, [
        h('div.field', {}, [h('label.field__label', { text: 'Room name' }), label]),
        h('div.field', {}, [h('label.field__label', { text: 'Note' }), note]),
      ]),
      host,
    ]),
    actions: [
      { label: 'Cancel', onclick: (close) => close() },
      {
        label: 'Remove this room',
        tone: 'quiet-danger',
        onclick: async (close) => {
          if (!(await confirm({
            title: `Remove ${room.label}?`,
            message: `${plural(mine.length, 'table')} in it will go with it. `
              + 'A table with an open bill on it cannot be removed.',
            confirmLabel: 'Remove',
            tone: 'danger',
          }))) return;
          close();
          savePlan({
            sections: sections().filter((s) => s.id !== roomId),
            tables: others,
          }, `${room.label} removed`);
        },
      },
      {
        label: 'Save',
        tone: 'primary',
        onclick: (close) => {
          close();
          savePlan({
            sections: sections().map((s) => (s.id === roomId
              ? { ...s, label: label.value.trim() || s.label, note: note.value.trim() }
              : s)),
            tables: [...others, ...mine.map((t) => ({ ...t, sectionId: roomId }))],
          }, `${label.value.trim() || room.label} saved`);
        },
      },
    ],
  });
}

function renderKitchen() {
  return card('Kitchen', 'Where each dish is cooked, and how long it should take', [
    setting(
      'Course pacing',
      `Items are held against one of ${COURSES.length} courses and only reach the `
      + 'kitchen when that course is fired.',
      h('div.u-row.u-wrap', { style: { gap: '6px', justifyContent: 'flex-end' } },
        COURSES.map((course) => chip(course.short, 'outline')))
    ),
    ...STATIONS.map((station) => setting(
      station.label,
      `Service target ${station.slaMinutes} minutes. The kitchen display turns amber `
      + `at ${Math.round(station.slaMinutes * 0.75)} minutes and red past `
      + `${station.slaMinutes}.`,
      chip(`${station.slaMinutes} min`, 'gold')
    )),
  ]);
}

function renderPrinting() {
  return card('Printing', null, [
    setting(
      'Guest bill',
      'A4 for the folder a fine-dining bill is presented in, or 80mm for a thermal '
      + 'roll at the till. Both are generated from the same document; pick the size '
      + 'on the bill screen.',
      chip('A4 and 80mm', 'outline')
    ),
    setting(
      'Station dockets',
      'One docket per station, routed by the kitchen section each dish belongs to. '
      + 'They go to the browser’s printer; a networked thermal printer per station '
      + 'is the usual next step.',
      h('div.u-row.u-wrap', { style: { gap: '6px', justifyContent: 'flex-end' } },
        STATIONS.map((s) => chip(s.short, 'outline')))
    ),
    setting(
      'Watermark on printed bills',
      'The medallion is embossed behind the items at 5% — visible on good '
      + 'stationery, invisible enough not to fight the figures.',
      chip('On', 'olive')
    ),
  ]);
}

/* --------------------------------------------------------------- data --- */

function renderData() {
  const rows = [
    setting(
      'Today',
      `${plural(openOrders().length, 'table')} open · `
      + `${plural(settledToday().length, 'bill')} settled · business day ${businessDay()}`,
      chip(longDate(Date.now()), 'outline')
    ),
  ];

  if (liveTerminals) {
    rows.push(setting(
      'Terminals connected',
      liveTerminals.map((t) => t.user).join(', ') || 'None',
      chip(String(liveTerminals.length), liveTerminals.length ? 'olive' : 'outline')
    ));
  }

  if (can('backup')) {
    rows.push(setting(
      'Back up now',
      'Writes a complete copy of the database beside the live one. The restaurant '
      + 'keeps trading while it runs.',
      h('div.u-row', { style: { gap: '7px' } }, [
        h('button.btn.btn--outline.btn--sm', {
          type: 'button',
          onclick: async (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            try {
              const result = await takeBackup();
              toast(`Backup written: ${result.name}`, 'good', 5000);
            } catch (error) {
              toast(error.message, 'bad', 5000);
            } finally {
              button.disabled = false;
            }
          },
        }, [icon('refresh', { size: 16 }), 'Back up']),
        h('a.btn.btn--primary.btn--sm', {
          href: downloadLinks.backup(), download: '',
        }, [icon('arrowDown', { size: 16 }), 'Download a copy']),
      ])
    ));
    rows.push(setting(
      'Where the data lives',
      'One SQLite file on the till computer. Copy that file and you have copied '
      + 'the restaurant — every bill, every docket, every audit entry. Keep a '
      + 'download of it somewhere that is not the till.',
      chip('data/saba.db', 'outline')
    ));
  }

  if (can('settings')) {
    rows.push(setting(
      'Start a demonstration again',
      'Puts every table, docket and bill back to how the worked example opened. '
      + 'Refused outright on a live install.',
      h('button.btn.btn--quiet-danger.btn--sm', {
        type: 'button',
        onclick: async () => {
          if (!(await confirm({
            title: 'Reset the demonstration?',
            message: 'Every order, booking and audit entry is deleted and the worked '
              + 'example is rebuilt. Staff accounts and the carte are kept.',
            confirmLabel: 'Reset',
            tone: 'danger',
          }))) return;
          try {
            await resetDemo();
            toast('Demonstration reset', 'good');
          } catch (error) {
            toast(error.message, 'bad', 6000);
          }
        },
      }, [icon('refresh', { size: 16 }), 'Reset'])
    ));
  }

  return card('This install', null, rows);
}

/* ---------------------------------------------------------------------- */

function card(title, subtitle, rows) {
  return h('section.card', {}, [
    h('div.card__head', {}, h('div.u-grow', {}, [
      h('h2.card__title', { text: title }),
      subtitle ? h('p.stat__note', { text: subtitle }) : null,
    ])),
    h('div.card__body', { style: { paddingTop: '4px', paddingBottom: '4px' } }, rows),
  ]);
}
