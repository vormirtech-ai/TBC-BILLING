/**
 * Settings.
 *
 * In the demo most of these are read-only: they exist to show a client what a
 * real install exposes, and to be honest about which parts are configuration
 * and which parts are code. The three that do work — printer format, the demo
 * reset, and the users list — are the three anyone presenting actually needs.
 */

import { h, fill } from '../core/dom.js';
import { longDate, plural } from '../core/format.js';
import {
  APP, RESTAURANT, CHARGES, STATIONS, ROLE_LABELS, COURSES,
} from '../config.js';
import { isPersistent } from '../core/store.js';
import { users, getState, reset, session } from '../state.js';
import { navigate } from '../core/router.js';
import { setTopbar } from '../ui/shell.js';
import {
  setting, confirm, toast, icon, notice, chip, segmented, } from '../ui/components.js';

let printFormat = 'A4';

export function renderSettings(host) {
  const state = getState();

  setTopbar({
    title: 'Setup',
    subtitle: `${APP.suite} ${APP.version}`,
  });

  fill(host, h('div.view__pad.grid', { style: { gap: '16px', maxWidth: '900px' } }, [
    notice(
      'This is a demonstration build. It runs entirely on this device — no server, '
      + 'no network requests, no accounts. Settings marked "fixed in this build" are '
      + 'configuration in a real install; they are shown so you can see what is on offer.',
      'warn', 'info'
    ),

    card('The restaurant', [
      row('Name', RESTAURANT.name),
      row('Tagline', RESTAURANT.tagline),
      row('Address', RESTAURANT.addressLines.join(', ')),
      row('Telephone', RESTAURANT.phone),
      row('GSTIN', RESTAURANT.gstin),
      row('FSSAI licence', RESTAURANT.fssai),
    ]),

    card('Charges and tax', [
      setting(
        'Service charge',
        `${CHARGES.serviceChargeBps / 100}% applied to food and drink after any discount, before tax. `
        + 'Removable per bill by the cashier, with no manager approval — because a guest '
        + 'asking for it to come off should never become an argument.',
        chip(`${CHARGES.serviceChargeBps / 100}%`, 'gold')
      ),
      ...CHARGES.taxComponents.map((component) => setting(
        component.label,
        `Charged at ${(component.bps / 100).toFixed(2)}% on the value of food, drink and service charge.`,
        chip(`${(component.bps / 100).toFixed(2)}%`, 'outline')
      )),
      setting(
        'Prices include tax',
        CHARGES.pricesIncludeTax
          ? 'Menu prices are tax-inclusive and the tax is backed out on the bill.'
          : 'Menu prices are exclusive; tax is added at settlement and shown as its own line.',
        chip(CHARGES.pricesIncludeTax ? 'Inclusive' : 'Exclusive', 'outline')
      ),
      setting(
        'Round the total',
        'The payable total is rounded to the nearest rupee and the difference is printed '
        + 'as its own line, so the bill always adds up exactly.',
        chip(CHARGES.roundOffEnabled ? 'On' : 'Off', CHARGES.roundOffEnabled ? 'sage' : 'outline')
      ),
      setting(
        'Discount needing approval',
        `Anything above ${CHARGES.discountApprovalPercent}% asks for a manager's PIN and records who gave it.`,
        chip(`${CHARGES.discountApprovalPercent}%`, 'outline')
      ),
    ]),

    card('Printing', [
      setting(
        'Guest bill format',
        'A4 for the folder a fine-dining bill is presented in; 80mm for a thermal roll '
        + 'at the till. Both are generated from the same document.',
        segmented(
          [{ id: 'A4', label: 'A4' }, { id: 'THERMAL', label: '80mm' }],
          printFormat,
          (id) => { printFormat = id; toast(`Bills will preview as ${id === 'A4' ? 'A4' : '80mm thermal'}`); renderSettings(host); }
        )
      ),
      setting(
        'Station printers',
        'One docket per station, routed by the kitchen section each dish belongs to. '
        + 'This demo shows the dockets on screen instead of sending them to hardware.',
        h('div.u-row.u-wrap', { style: { gap: '6px', justifyContent: 'flex-end' } },
          STATIONS.map((station) => chip(`${station.short} · ${station.slaMinutes}m`, 'outline')))
      ),
      setting(
        'Watermark on printed bills',
        'The medallion is embossed behind the items at 6% — visible on good stationery, '
        + 'invisible enough not to fight the figures.',
        chip('On', 'sage')
      ),
    ]),

    card('Kitchen', [
      setting(
        'Course pacing',
        `Items are held against one of ${COURSES.length} courses and only reach the kitchen `
        + 'when that course is fired.',
        h('div.u-row.u-wrap', { style: { gap: '6px', justifyContent: 'flex-end' } },
          COURSES.map((course) => chip(course.label, 'outline')))
      ),
      ...STATIONS.map((station) => setting(
        station.label,
        `Service target ${station.slaMinutes} minutes. The kitchen display turns amber at `
        + `${Math.round(station.slaMinutes * 0.75)} minutes and red past ${station.slaMinutes}.`,
        chip(`${station.slaMinutes} min`, 'gold')
      )),
    ]),

    card('People', [
      ...users().map((user) => setting(
        user.name,
        `${ROLE_LABELS[user.role]} · PIN ${user.pin} — shown because this is a demo. `
        + 'A real install issues one PIN per person and never displays it.',
        chip(user.role, session()?.id === user.id ? 'burgundy' : 'outline')
      )),
    ]),

    card('This device', [
      setting(
        'Saving',
        isPersistent()
          ? 'The evening is saved to this browser as you go, so closing the tab loses nothing.'
          : 'This browser refused local storage, so the demo is running from memory. '
            + 'Everything works; it simply resets when the tab closes.',
        chip(isPersistent() ? 'Saving locally' : 'Memory only', isPersistent() ? 'sage' : 'amber')
      ),
      setting(
        'Tonight so far',
        `${plural(state.orders.length, 'table')} open · ${plural(state.settled.length, 'bill')} settled · `
        + `${plural(state.activity.length, 'entry')} in the audit log`,
        chip(longDate(Date.now()), 'outline')
      ),
      setting(
        'Start the evening again',
        'Puts every table, docket and bill back to how the demo opened. Nothing else on '
        + 'this device is touched.',
        h('button.btn.btn--quiet-danger.btn--sm', {
          type: 'button',
          onclick: async () => {
            if (await confirm({
              title: 'Reset the demo?',
              message: 'Every table, docket and bill goes back to the opening state. '
                + 'The thirty days of trading history is regenerated identically.',
              confirmLabel: 'Reset',
              tone: 'danger',
            })) {
              reset();
              toast('Demo reset — service restarted', 'good');
              navigate('/floor');
            }
          },
        }, [icon('refresh', { size: 16 }), 'Reset'])
      ),
    ]),

    h('p.stat__note', {
      style: { textAlign: 'center', padding: '10px 0 20px' },
      text: `${APP.suite} ${APP.version} · built for ${RESTAURANT.name} · no network, no telemetry`,
    }),
  ]));
}

function card(title, rows) {
  return h('section.card', {}, [
    h('div.card__head', {}, h('h2.card__title', { text: title })),
    h('div.card__body', { style: { paddingTop: '4px', paddingBottom: '4px' } }, rows),
  ]);
}

const row = (label, value) => setting(label, null, h('span', {
  text: value, style: { fontWeight: '600', fontSize: '13.5px' },
}));

export { printFormat };
