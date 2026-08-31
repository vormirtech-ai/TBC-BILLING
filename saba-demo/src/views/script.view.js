/**
 * The walkthrough.
 *
 * A demo is only as good as the story told over it, and the person telling it
 * is usually not the person who built it. This is the crib sheet: the six
 * moments in this build that are worth stopping on, in the order that makes
 * them land, with the exact table numbers already set up in the opening state.
 */

import { h } from '../core/dom.js';
import { dialog, icon, notice } from '../ui/components.js';
import { navigate } from '../core/router.js';

const STEPS = [
  {
    title: 'Open on a room that is already busy',
    where: '/floor',
    body: 'Eight tables are in service. The stripe down each card says what is '
      + 'happening: gold is seated, amber means food is in the kitchen, green '
      + 'means everything is on the table, burgundy means the bill has been '
      + 'printed. Table 6 has a red dot — a plate has been sitting on the pass '
      + 'too long, and the floor plan is the first place that shows.',
  },
  {
    title: 'Take an order the way a captain does',
    where: '/order?table=g2',
    body: 'Terrace G2 is mid-order. Pick a seat number at the top, tap a dish, '
      + 'and it lands on that seat under its course. Try the Barg Fillet — it '
      + 'asks for doneness, because a fine-dining system that does not ask is '
      + 'not one. Nothing has gone to the kitchen yet: everything is held.',
  },
  {
    title: 'Fire a course, and watch it split by station',
    where: '/order?table=g2',
    body: 'Press Fire. One order becomes one docket per kitchen section — the '
      + 'tandoor never sees the dessert line, the bar never sees the lamb. That '
      + 'split is the single thing cheap systems get wrong, and it is why food '
      + 'arrives cold. The dockets are shown on screen; in a real install they '
      + 'are already printing at each section.',
  },
  {
    title: 'Stand at the pass',
    where: '/kds',
    body: 'The kitchen display, read at three metres. Colour means one thing '
      + 'only: how long this has been waiting against that station’s own target. '
      + 'The Tandoor ticket for table 6 is pulsing because it was plated fifteen '
      + 'minutes ago and no runner has taken it. Bump one to Ready, then Away, '
      + 'and watch the floor plan change colour behind you.',
  },
  {
    title: 'Split a bill three ways',
    where: '/bill',
    body: 'Open table 6 and press Split. Down the middle, by item, or — the one '
      + 'worth showing — by seat, which works only because the captain recorded '
      + 'seat numbers when the order was taken. Each share carries its own '
      + 'proportion of the service charge and tax, so the three add back to '
      + 'exactly the one bill.',
  },
  {
    title: 'Show what a manager can see',
    where: '/reports',
    body: 'Thirty days of trading, average check, table turn time, kitchen '
      + 'timings by station, and the audit tab — every void, comp and discount '
      + 'with the reason given and the manager who authorised it. Nothing here '
      + 'is stored: it is all derived from the same bills, so it can never '
      + 'disagree with the till.',
  },
];

const CREDENTIALS = [
  ['1111', 'Farid Naqvi', 'Manager — everything, including voids and reports'],
  ['2222', 'Alina Rahman', 'Captain — floor, orders, kitchen, bills'],
  ['3333', 'Devesh Kamat', 'Cashier — floor, orders, bills, reports'],
  ['4444', 'Pass', 'Kitchen — the display, and nothing else'],
];

export function openDemoScript() {
  const handle = dialog({
    title: 'Walking a client through this',
    subtitle: 'Six moments, in the order that makes them land.',
    size: 'wide',
    body: h('div.grid', { style: { gap: '18px' } }, [
      notice(
        'Every table named below is already set up in the opening state. If a '
        + 'demo goes off the rails, Setup → Reset puts the whole evening back.',
        'info'
      ),

      h('div.script', {}, STEPS.map((step, i) =>
        h('div.script__step', {}, [
          h('span.script__num', { text: String(i + 1) }),
          h('div', {}, [
            h('div.script__title', { text: step.title }),
            h('p.script__body', { text: step.body }),
            step.where ? h('button.btn.btn--outline.btn--xs', {
              type: 'button',
              style: { marginTop: '7px' },
              onclick: () => {
                handle.close();
                const [path, query] = step.where.split('?');
                navigate(path, query ? Object.fromEntries(new URLSearchParams(query)) : {});
              },
            }, [icon('chevronRight', { size: 13 }), 'Take me there']) : null,
          ]),
        ]))),

      h('div.divider'),

      h('div', {}, [
        h('p.u-caps', { text: 'Sign-in PINs' }),
        h('div.list', { style: { marginTop: '8px' } }, CREDENTIALS.map(([pin, name, role]) =>
          h('div.row-card', {}, [
            h('span.row-card__time', { text: pin }),
            h('div.u-grow', {}, [
              h('div.row-card__name', { text: name }),
              h('div.row-card__note', { text: role }),
            ]),
          ]))),
      ]),

      notice(
        'Worth saying out loud: this runs with the network cable pulled out. No '
        + 'server, no cloud, no subscription that stops working when the line '
        + 'goes down — which for a restaurant on a Saturday night is the whole '
        + 'argument.',
        '', 'lock'
      ),
    ]),
    actions: [{ label: 'Close', tone: 'primary', onclick: (close) => close() }],
  });
}
