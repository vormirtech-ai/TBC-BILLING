/**
 * The walkthrough.
 *
 * A demonstration is only as good as the story told over it, and the person
 * telling it is usually not the person who built it. This is the crib sheet:
 * the moments worth stopping on, in the order that makes them land.
 */

import { h } from '../core/dom.js';
import { dialog, icon, notice } from '../ui/components.js';
import { navigate } from '../core/router.js';
import { openOrders } from '../state.js';

const STEPS = [
  {
    title: 'Open on a room that is already busy',
    where: '/floor',
    body: 'The stripe down each card says what is happening: gold is seated, '
      + 'amber means food is in the kitchen, green means everything is on the '
      + 'table, navy means the bill has been printed. A red dot means a plate '
      + 'has been sitting on the pass too long, and the floor plan is the first '
      + 'place that shows.',
  },
  {
    title: 'Take an order the way a captain does',
    where: '/order',
    body: 'Pick a seat number at the top, tap a dish, and it lands on that seat '
      + 'under its course. Try the Barg Fillet — it asks for doneness, because a '
      + 'fine-dining system that does not ask is not one. Nothing has gone to the '
      + 'kitchen yet: everything is held.',
  },
  {
    title: 'Fire a course, and watch it split by station',
    where: '/order',
    body: 'Press Fire. One order becomes one docket per kitchen section — the '
      + 'tandoor never sees the dessert line, the bar never sees the lamb. That '
      + 'split is the single thing cheap systems get wrong, and it is why food '
      + 'arrives cold.',
  },
  {
    title: 'Stand at the pass',
    where: '/kds',
    body: 'The kitchen display, read at three metres. Colour means one thing '
      + 'only: how long this has waited against that station’s own target. Bump '
      + 'a docket to Ready, then Away — and watch the floor plan change colour '
      + 'behind you, on every other screen in the building at the same moment.',
  },
  {
    title: 'Two terminals, one restaurant',
    body: 'This is the part worth showing twice. Open the system on a second '
      + 'device — a phone on the same wifi will do — and put the floor plan on '
      + 'one and the kitchen on the other. Bump a docket on one and the other '
      + 'moves. There is no refresh button because there is nothing to refresh.',
  },
  {
    title: 'Split a bill three ways',
    where: '/bill',
    body: 'Down the middle, by item, or — the one worth showing — by seat, which '
      + 'works only because the captain recorded seat numbers when the order was '
      + 'taken. Each share carries its own proportion of the service charge and '
      + 'the tax, so the shares add back to exactly the one bill.',
  },
  {
    title: 'Close the day',
    where: '/reports',
    body: 'Reports → Day close. Takings split by tender, because only cash should '
      + 'be in the drawer; the expected figure against what was counted; and the '
      + 'variance stated plainly. Then the Audit tab: every void, comp and '
      + 'discount with the reason given and the manager who approved it.',
  },
];

export function openGuide() {
  const firstOrder = openOrders()[0];

  const handle = dialog({
    title: 'Walking somebody through this',
    subtitle: 'Seven moments, in the order that makes them land.',
    size: 'wide',
    body: h('div.grid', { style: { gap: '18px' } }, [
      notice(
        'Everything here is live. Anything you change during a demonstration is '
        + 'a real change to the data — Setup → Reset puts a demonstration install '
        + 'back to the beginning.',
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
                const params = step.where === '/order' && firstOrder
                  ? { order: firstOrder.id }
                  : {};
                navigate(step.where, params);
              },
            }, [icon('chevronRight', { size: 13 }), 'Take me there']) : null,
          ]),
        ]))),

      notice(
        'Worth saying out loud: this runs with the internet unplugged. The till '
        + 'is a computer in the restaurant, the terminals are on its own wifi, '
        + 'and there is no cloud service to stop working and no subscription to '
        + 'lapse. For a restaurant on a Saturday night, that is the whole '
        + 'argument.',
        '', 'lock'
      ),
    ]),
    actions: [{ label: 'Close', tone: 'primary', onclick: (close) => close() }],
  });
}
