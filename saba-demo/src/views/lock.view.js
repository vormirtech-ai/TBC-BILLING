/**
 * The lock screen.
 *
 * It is the first thing a client sees, so it carries the medallion at full size
 * and behaves like the door of the restaurant rather than a login form. The four
 * demo PINs are printed on it deliberately: nobody presenting this should have
 * to remember a password, and a real install replaces this panel outright.
 */

import { h, fill } from '../core/dom.js';
import { APP, ASSETS, RESTAURANT, ROLE_LABELS } from '../config.js';
import { users, signIn, homeFor } from '../state.js';
import { navigate } from '../core/router.js';
import { isPersistent } from '../core/store.js';
import { notice } from '../ui/components.js';
import { longDate } from '../core/format.js';

export function renderLock(host) {
  let chosen = users()[0];
  let entry = '';

  const dots = h('div.pin__dots', {},
    Array.from({ length: 4 }, () => h('span.pin__dot')));
  const pin = h('div.pin', {}, [dots]);

  const paint = () => {
    [...dots.children].forEach((dot, i) =>
      dot.classList.toggle('pin__dot--on', i < entry.length));
  };

  const reject = () => {
    pin.classList.add('pin--bad');
    setTimeout(() => { pin.classList.remove('pin--bad'); entry = ''; paint(); }, 480);
  };

  const submit = () => {
    // Any of the four PINs works from any card: the person at the terminal is
    // whoever the PIN belongs to, not whoever was highlighted.
    const match = users().find((u) => u.pin === entry);
    if (!match) { reject(); return; }
    signIn(match);
    navigate(homeFor(match.role));
  };

  const press = (key) => {
    if (key === 'del') entry = entry.slice(0, -1);
    else if (entry.length < 4) entry += key;
    paint();
    if (entry.length === 4) setTimeout(submit, 140);
  };

  const cards = users().map((user) =>
    h('button.who__btn', {
      type: 'button',
      'aria-pressed': String(user.id === chosen.id),
      onclick: () => {
        chosen = user;
        for (const card of cards) card.setAttribute('aria-pressed', 'false');
        cards[users().indexOf(user)].setAttribute('aria-pressed', 'true');
        entry = user.pin;
        paint();
        setTimeout(submit, 220);
      },
    }, [
      h('span.who__avatar', { text: user.initials }),
      h('span.u-grow', {}, [
        h('span.who__name', { text: user.name }),
        h('span.who__role', { text: ROLE_LABELS[user.role] }),
      ]),
      h('span.who__pin', { text: user.pin }),
    ]));

  const keypad = h('div.keypad', {}, [
    ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((key) =>
      h('button.keypad__key', { type: 'button', text: key, onclick: () => press(key) })),
    h('button.keypad__key.keypad__key--wide', {
      type: 'button', text: 'Clear', onclick: () => { entry = ''; paint(); },
    }),
    h('button.keypad__key', { type: 'button', text: '0', onclick: () => press('0') }),
    h('button.keypad__key.keypad__key--wide', {
      type: 'button', text: 'Delete', onclick: () => press('del'),
    }),
  ]);

  const onKey = (event) => {
    if (/^\d$/.test(event.key)) press(event.key);
    else if (event.key === 'Backspace') press('del');
    else if (event.key === 'Enter' && entry.length === 4) submit();
  };
  document.addEventListener('keydown', onKey);

  const screen = h('div.lock', {}, [
    h('section.lock__brand', {}, [
      // The medallion already carries the wordmark, so the name is not set
      // again beneath it — it is in the alt text and the page title instead.
      h('img.lock__logo', { src: ASSETS.logo, alt: RESTAURANT.name }),
      h('h1.lock__tag', { text: RESTAURANT.tagline }),
      h('p.lock__meta', { text: `${APP.suite} · ${APP.version} · ${longDate(Date.now())}` }),
    ]),

    h('section.lock__panel', {}, [
      h('div', {}, [
        h('h2.lock__heading', { text: 'Good evening' }),
        h('p.lock__hint', { text: 'Tap your name, or enter a four-digit PIN.' }),
      ]),
      h('div.who', {}, cards),
      pin,
      keypad,
      isPersistent() ? null : notice(
        'This browser will not let the demo save to the device, so the evening resets when the tab closes. Everything else works exactly the same.',
        'warn', 'warn'
      ),
      h('p.lock__note', {}, [
        h('strong', { text: 'Demonstration build. ' }),
        'Runs entirely on this device — no server, no network, no account. '
        + 'PINs are shown above because nothing here is real. ',
      ]),
    ]),
  ]);

  screen.addEventListener('DOMNodeRemovedFromDocument', () => {}, { once: true });
  fill(host, screen);
  paint();

  return () => document.removeEventListener('keydown', onKey);
}
