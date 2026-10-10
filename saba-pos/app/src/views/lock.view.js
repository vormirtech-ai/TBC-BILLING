/**
 * The lock screen.
 *
 * The first thing anybody sees, so it carries the mark at full size and
 * behaves like the door of the restaurant rather than a login form.
 *
 * Tap your name, then type your PIN. Naming yourself first is not a step for
 * the sake of it: it lets the till check exactly one password hash instead of
 * every staff member's, which is the difference between signing in instantly
 * and waiting two seconds at the start of every shift. It is also how every
 * POS on a restaurant floor already works, so nobody has to be taught it.
 */

import { h, fill } from '../core/dom.js';
import { APP, ASSETS, ROLE_LABELS } from '../shared/config.js';
import * as state from '../state.js';
import { longDate } from '../shared/format.js';
import { notice, icon, empty } from '../ui/components.js';

export function renderLock(host, { onSignedIn }) {
  let staff = [];
  let chosen = null;
  let entry = '';
  let busy = false;

  const panel = h('section.lock__panel');

  const screen = h('div.lock', {}, [
    h('section.lock__brand', {}, [
      // The mark already carries the name, so it is not set again beneath it.
      h('img.lock__logo', { src: ASSETS.logo, alt: 'Saba Fine Dine' }),
      h('p.lock__meta', {
        text: `${APP.suite} ${APP.version} · ${longDate(Date.now())}`,
      }),
    ]),
    panel,
  ]);

  fill(host, screen);

  /* ----------------------------------------------------------- picking --- */

  function paintRoster() {
    fill(panel, [
      h('div', {}, [
        h('h2.lock__heading', { text: greeting() }),
        h('p.lock__hint', { text: 'Tap your name to open this terminal.' }),
      ]),
      staff.length
        ? h('div.who', {}, staff.map((person) =>
          h('button.who__btn', {
            type: 'button',
            onclick: () => { chosen = person; entry = ''; paintPin(); },
          }, [
            h('span.who__avatar', { text: person.initials }),
            h('span.u-grow', {}, [
              h('span.who__name', { text: person.name }),
              h('span.who__role', { text: ROLE_LABELS[person.role] || person.role }),
            ]),
            h('span', { style: { color: 'var(--ink-4)' } }, icon('chevronRight', { size: 18 })),
          ])))
        : empty('Nobody can sign in yet',
          'No staff accounts exist on this till. Check the installation notes.'),
    ]);
  }

  /* --------------------------------------------------------------- PIN --- */

  function paintPin() {
    const dots = h('div.pin__dots', {},
      Array.from({ length: 4 }, () => h('span.pin__dot')));
    const message = h('p.pin__message', { text: ' ' });
    const pin = h('div.pin', {}, [dots, message]);

    const paint = () => {
      const filled = Math.min(entry.length, dots.children.length);
      [...dots.children].forEach((dot, i) =>
        dot.classList.toggle('pin__dot--on', i < filled));
    };

    const reject = (text) => {
      pin.classList.add('pin--bad');
      message.textContent = text;
      setTimeout(() => {
        pin.classList.remove('pin--bad');
        entry = '';
        paint();
      }, 560);
    };

    const submit = async () => {
      if (busy || entry.length < 4) return;
      busy = true;
      pin.classList.add('pin--checking');
      message.textContent = 'Signing in…';
      try {
        await state.signIn(chosen.id, entry);
        detach();
        onSignedIn();
      } catch (error) {
        reject(error.message || 'That PIN was not recognised');
      } finally {
        busy = false;
        pin.classList.remove('pin--checking');
      }
    };

    const press = (key) => {
      if (busy) return;
      if (key === 'del') entry = entry.slice(0, -1);
      else if (entry.length < 8) entry += key;
      message.textContent = ' ';
      paint();
      // Four digits is the common case; a longer PIN is sent with Enter.
      if (entry.length === 4) setTimeout(submit, 120);
    };

    onKey = (event) => {
      if (/^\d$/.test(event.key)) press(event.key);
      else if (event.key === 'Backspace') press('del');
      else if (event.key === 'Enter') submit();
      else if (event.key === 'Escape') { chosen = null; paintRoster(); }
    };

    fill(panel, h('div.lock__step', {}, [
      h('button.lock__back', {
        type: 'button',
        onclick: () => { chosen = null; entry = ''; paintRoster(); },
      }, [icon('back', { size: 16 }), 'Not you?']),

      h('div.lock__who', {}, [
        h('span.who__avatar.who__avatar--lg', { text: chosen.initials }),
        h('div', {}, [
          h('h2.lock__heading', { text: chosen.name }),
          h('p.lock__hint', { text: ROLE_LABELS[chosen.role] || chosen.role }),
        ]),
      ]),

      pin,

      h('div.keypad', {}, [
        ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((key) =>
          h('button.keypad__key', { type: 'button', text: key, onclick: () => press(key) })),
        h('button.keypad__key.keypad__key--wide', {
          type: 'button', text: 'Clear', onclick: () => { entry = ''; paint(); },
        }),
        h('button.keypad__key', { type: 'button', text: '0', onclick: () => press('0') }),
        h('button.keypad__key.keypad__key--wide', {
          type: 'button', text: 'Delete', onclick: () => press('del'),
        }),
      ]),
    ]));

    paint();
  }

  /* -------------------------------------------------------------- wire --- */

  let onKey = () => {};
  const listener = (event) => onKey(event);
  document.addEventListener('keydown', listener);
  const detach = () => document.removeEventListener('keydown', listener);

  fill(panel, empty('Finding the till…'));

  state.staff()
    .then((list) => {
      staff = list;
      paintRoster();
    })
    .catch(() => {
      fill(panel, [
        h('h2.lock__heading', { text: 'The till is not answering' }),
        notice(
          'This terminal cannot reach the till computer. Check that it is '
          + 'switched on and that this device is on the restaurant’s own '
          + 'network, then try again.',
          'danger', 'warn'
        ),
        h('button.btn.btn--primary', {
          type: 'button',
          text: 'Try again',
          onclick: () => window.location.reload(),
        }),
      ]);
    });

  return detach;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
