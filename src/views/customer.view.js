/**
 * The screen a customer sees after scanning the QR code on their table.
 *
 * Written for a stranger holding a phone in one hand: no sign-in, no jargon, no
 * assumptions about what they know. It has to work on a phone that has never
 * opened this site before, on a cafe's patchy wi-fi, and it has to be honest
 * about what happens next — an order placed here is a REQUEST. Nothing is
 * charged, nothing is taken, and a member of staff confirms it.
 *
 * When the cafe has no shared backend, the order cannot travel to the counter
 * by itself. Rather than pretend otherwise, the confirmation screen turns into
 * something genuinely useful: a code the customer shows to staff, as a QR the
 * counter can scan and as four characters they can read out.
 */

import { el, clear, append, formatTime } from '../core/utils.js';
import { formatMoney } from '../core/money.js';
import { renderQrSvg, ECC } from '../lib/qrcode.js';
import { parseHash } from '../core/router.js';
import { ONLINE_ORDER_STATUS } from '../config/app.config.js';
import { applyDeviceSettings } from '../repositories/settings.repo.js';
import { loadPublicMenu } from '../services/publicMenu.service.js';
import { sendOrder, encodeHandoff, deviceId, deliveryRoute } from '../services/orderChannel.service.js';
import * as ordersRepo from '../repositories/onlineOrders.repo.js';
import * as tablesRepo from '../repositories/tables.repo.js';
import * as cloud from '../services/cloudSync.service.js';
import { reportError } from '../ui/toast.js';

const STATUS_MESSAGES = {
  [ONLINE_ORDER_STATUS.NEW]: {
    title: 'Order sent',
    text: 'Waiting for the counter to confirm it.',
    tone: 'wait',
  },
  [ONLINE_ORDER_STATUS.ACCEPTED]: {
    title: 'Confirmed',
    text: 'The counter has your order and is making it now.',
    tone: 'ok',
  },
  [ONLINE_ORDER_STATUS.BILLED]: {
    title: 'On its way',
    text: 'Your bill is ready at the counter.',
    tone: 'ok',
  },
  [ONLINE_ORDER_STATUS.REJECTED]: {
    title: 'Not accepted',
    text: 'Please speak to a member of staff.',
    tone: 'bad',
  },
};

export async function renderCustomerOrder({ outlet }) {
  document.body.classList.add('is-customer');

  const { query } = parseHash();
  const token = String(query.t || '').trim();
  const tableNameFromLink = String(query.n || '').trim();

  // The table card can carry the cafe's connection, which is the only way a
  // phone that has never been here can send an order straight to the counter.
  // Stored device-only: this phone will never push anything but its own order.
  if (query.c) {
    try {
      const normalised = String(query.c).replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4);
      const connection = JSON.parse(atob(padded));

      if (connection?.v === 1 && connection.url && connection.key) {
        await applyDeviceSettings({
          cloudSyncUrl: String(connection.url),
          cloudSyncKey: String(connection.key),
          cloudSyncTable: String(connection.table || 'tbc_sync'),
          cloudSyncEnabled: true,
        });
      }
    } catch (error) {
      // A damaged code still shows the menu; the order just falls back to
      // being handed over rather than travelling on its own.
      console.error('[TBC POS] the table code carried an unreadable connection', error);
    }
  }

  clear(outlet).appendChild(el('div.loading', { text: 'Opening the menu…' }));

  if (!token) {
    clear(outlet).appendChild(
      el('div.customer', {}, [
        el('div.customer__card', {}, [
          el('h1.customer__title', { text: 'Scan the code on your table' }),
          el('p.customer__text', {
            text:
              'This page opens from the QR code on a table. Scan the code again, or ask a member of staff for help.',
          }),
        ]),
      ])
    );
    return () => document.body.classList.remove('is-customer');
  }

  /* -------------------------------------------------------------- data --- */

  const { snapshot, source } = await loadPublicMenu();
  // The token is what identifies the table; the name in the link is only used
  // when this device has no table list of its own, which is the normal case on
  // a customer's phone.
  const knownTable = await tablesRepo.findByToken(token);
  const tableName = knownTable?.name || tableNameFromLink || 'your table';

  const symbol = snapshot.currencySymbol || '₹';
  const acceptsOrders = snapshot.acceptsOrders !== false;

  const state = {
    lines: new Map(), // code -> { item, quantity }
    category: 'All',
    placed: null,
  };

  const categories = ['All', ...new Set(snapshot.items.map((item) => item.category))];

  /* ------------------------------------------------------------ layout --- */

  const chips = el('div.chips.customer__chips', { role: 'tablist', 'aria-label': 'Menu sections' });
  const list = el('div.customer__list');
  const basketBar = el('div.customer__bar', { hidden: true });
  const screen = el('div.customer');

  function total() {
    let sum = 0;
    for (const { item, quantity } of state.lines.values()) sum += item.price * quantity;
    return sum;
  }

  function itemCount() {
    let count = 0;
    for (const { quantity } of state.lines.values()) count += quantity;
    return count;
  }

  function change(item, delta) {
    const existing = state.lines.get(item.code);
    const quantity = Math.min(99, Math.max(0, (existing?.quantity || 0) + delta));
    if (quantity === 0) state.lines.delete(item.code);
    else state.lines.set(item.code, { item, quantity });
    paintList();
    paintBar();
  }

  function paintChips() {
    clear(chips);
    for (const category of categories) {
      chips.appendChild(
        el('button.chip', {
          type: 'button',
          role: 'tab',
          text: category,
          'aria-selected': state.category === category ? 'true' : 'false',
          class: state.category === category ? 'is-active' : '',
          onclick: () => {
            state.category = category;
            paintChips();
            paintList();
          },
        })
      );
    }
  }

  function paintList() {
    clear(list);
    const items = snapshot.items.filter(
      (item) => state.category === 'All' || item.category === state.category
    );

    if (!items.length) {
      list.appendChild(el('p.empty', { text: 'Nothing in this section right now.' }));
      return;
    }

    let lastCategory = null;
    for (const item of items) {
      if (state.category === 'All' && item.category !== lastCategory) {
        lastCategory = item.category;
        list.appendChild(el('h2.customer__section', { text: item.category }));
      }

      const quantity = state.lines.get(item.code)?.quantity || 0;
      list.appendChild(
        el('article.customer__item', { class: quantity ? 'is-chosen' : '' }, [
          el('div.customer__itemtext', {}, [
            el('h3.customer__itemname', { text: item.name }),
            item.description ? el('p.customer__itemdesc', { text: item.description }) : null,
            el('span.customer__itemprice', { text: formatMoney(item.price, symbol) }),
          ]),
          acceptsOrders
            ? el('div.customer__stepper', {}, [
                quantity
                  ? el('button.qty__btn', {
                      type: 'button',
                      text: '−',
                      'aria-label': `One less ${item.name}`,
                      onclick: () => change(item, -1),
                    })
                  : null,
                quantity ? el('span.customer__qty', { text: String(quantity) }) : null,
                el('button.qty__btn.qty__btn--add', {
                  type: 'button',
                  text: quantity ? '+' : 'Add',
                  'aria-label': `Add ${item.name}`,
                  onclick: () => change(item, 1),
                }),
              ])
            : null,
        ])
      );
    }
  }

  function paintBar() {
    const count = itemCount();
    basketBar.hidden = count === 0;
    clear(basketBar).append(
      el('div.customer__barinfo', {}, [
        el('span.customer__barcount', {
          text: `${count} item${count === 1 ? '' : 's'}`,
        }),
        el('span.customer__bartotal', { text: formatMoney(total(), symbol) }),
      ]),
      el('button.btn.btn--pay', {
        type: 'button',
        text: 'Review order',
        onclick: openReview,
      })
    );
  }

  /* ------------------------------------------------------------ review --- */

  function openReview() {
    if (!state.lines.size) return;

    const nameInput = el('input.input', {
      type: 'text',
      placeholder: 'Your name (optional)',
      maxlength: 60,
      autocomplete: 'name',
    });
    const noteInput = el('input.input', {
      type: 'text',
      placeholder: 'Anything we should know? (optional)',
      maxlength: 200,
    });

    // Optional, and said plainly: the number is what links this order to the
    // customer's own visits, and nothing else is done with it.
    const phoneInput = el('input.input', {
      type: 'tel',
      inputmode: 'numeric',
      placeholder: 'Your phone number (optional)',
      maxlength: 18,
      autocomplete: 'tel',
    });

    const lines = [...state.lines.values()].map(({ item, quantity }) =>
      el('div.customer__reviewline', {}, [
        el('span', { text: `${quantity} × ${item.name}` }),
        el('span', { text: formatMoney(item.price * quantity, symbol) }),
      ])
    );

    const send = el('button.btn.btn--pay.btn--block', {
      type: 'button',
      text: `Send order · ${formatMoney(total(), symbol)}`,
    });

    const sheet = el('div.sheet', {}, [
      el('div.sheet__panel', {}, [
        el('header.sheet__head', {}, [
          el('h2.sheet__title', { text: 'Your order' }),
          el('button.icon-btn', {
            type: 'button',
            text: '×',
            'aria-label': 'Back to the menu',
            onclick: () => sheet.remove(),
          }),
        ]),
        el('p.sheet__sub', { text: `For ${tableName}` }),
        el('div.customer__review', {}, lines),
        el('div.customer__reviewline.customer__reviewline--total', {}, [
          el('span', { text: 'Estimated total' }),
          el('span', { text: formatMoney(total(), symbol) }),
        ]),
        snapshot.taxNote ? el('p.hint', { text: snapshot.taxNote }) : null,
        nameInput,
        phoneInput,
        el('p.hint', {
          text: 'A phone number keeps your visits counted, so the cafe knows when a coffee is on them.',
        }),
        noteInput,
        send,
        el('p.customer__smallprint', {
          text:
            'Nothing is charged here. The counter confirms your order and you pay as usual.',
        }),
      ]),
    ]);

    send.addEventListener('click', async () => {
      send.disabled = true;
      send.textContent = 'Sending…';
      try {
        const order = await sendOrder({
          tableId: knownTable?.id || '',
          tableToken: token,
          tableName,
          customerName: nameInput.value,
          customerPhone: phoneInput.value,
          note: noteInput.value,
          lines: [...state.lines.values()].map(({ item, quantity }) => ({
            code: item.code,
            name: item.name,
            category: item.category,
            unitPrice: item.price,
            quantity,
          })),
        });

        state.placed = order;
        sheet.remove();
        paintPlaced(order);
      } catch (error) {
        reportError(error, 'The order could not be sent. Please speak to a member of staff.');
        send.disabled = false;
        send.textContent = `Send order · ${formatMoney(total(), symbol)}`;
      }
    });

    screen.appendChild(sheet);
    requestAnimationFrame(() => nameInput.focus());
  }

  /* ------------------------------------------------------- confirmation --- */

  function paintPlaced(order) {
    const handoff = encodeHandoff(order);
    const viaCloud = deliveryRoute() === 'CLOUD';
    const statusBox = el('div.customer__status');

    const body = el('div.customer__done', {}, [
      el('div.customer__tick', { text: '✓' }),
      el('h1.customer__title', { text: 'Order sent' }),
      el('p.customer__text', { text: `${order.lines.length} line${order.lines.length === 1 ? '' : 's'} for ${tableName}` }),

      statusBox,

      // Without a shared backend the order cannot reach the counter on its own,
      // so the customer is given something that genuinely works instead.
      viaCloud
        ? null
        : el('section.customer__handoff', {}, [
            el('h2.customer__handofftitle', { text: 'Show this to a member of staff' }),
            el('div.customer__handoffcode', {}, [
              renderQrSvg(handoff, { size: 200, ecc: ECC.MEDIUM, title: 'Your order code' }),
            ]),
            el('p.customer__handoffref', { text: order.code }),
            el('p.customer__text', {
              text: 'They will scan this, or you can read the four characters out.',
            }),
          ]),

      el('div.customer__summary', {}, [
        ...order.lines.map((line) =>
          el('div.customer__reviewline', {}, [
            el('span', { text: `${line.quantity} × ${line.name}` }),
            el('span', { text: formatMoney(line.unitPrice * line.quantity, symbol) }),
          ])
        ),
        el('div.customer__reviewline.customer__reviewline--total', {}, [
          el('span', { text: 'Estimated total' }),
          el('span', { text: formatMoney(order.estimatedTotal, symbol) }),
        ]),
      ]),

      el('p.customer__smallprint', {
        text: snapshot.orderingNote || 'A member of staff will bring your order over.',
      }),
      el('button.btn.btn--ghost.btn--block', {
        type: 'button',
        text: 'Order something else',
        onclick: () => {
          state.lines.clear();
          state.placed = null;
          paintMenu();
        },
      }),
    ]);

    clear(screen).appendChild(body);
    paintStatus(statusBox, order);
    watchStatus(statusBox, order);
  }

  function paintStatus(box, order) {
    let message = STATUS_MESSAGES[order.status] || STATUS_MESSAGES[ONLINE_ORDER_STATUS.NEW];

    // Without a shared backend this phone has no way to hear back from the
    // counter, so promising an update it cannot deliver would be a lie. Say
    // what actually needs to happen instead.
    if (order.status === ONLINE_ORDER_STATUS.NEW && deliveryRoute() === 'HANDOFF') {
      message = {
        title: 'Ready to show',
        text: 'Show the code below to a member of staff and they will make it.',
        tone: 'wait',
      };
    }
    clear(box).append(
      el(`div.customer__statusbox.is-${message.tone}`, {}, [
        el('span.customer__statustitle', { text: message.title }),
        el('span.customer__statustext', {
          text: order.status === ONLINE_ORDER_STATUS.REJECTED && order.rejectReason
            ? order.rejectReason
            : message.text,
        }),
        el('span.customer__statustime', { text: `Sent at ${formatTime(order.placedAt)}` }),
      ])
    );
  }

  /**
   * Follow this one order until it reaches a final state. Local first — the
   * counter may be another tab on this very device — then the shared backend
   * if there is one.
   */
  let statusTimer = null;
  function watchStatus(box, order) {
    stopWatching();

    const finished = (status) =>
      status === ONLINE_ORDER_STATUS.BILLED || status === ONLINE_ORDER_STATUS.REJECTED;

    const tick = async () => {
      try {
        const local = await ordersRepo.getOrder(order.id);
        if (local && local.status !== order.status) {
          paintStatus(box, local);
          if (finished(local.status)) return stopWatching();
        }

        if (cloud.isCloudEnabled()) {
          const remote = await cloud.fetchOrder(order.id);
          if (remote && remote.status !== (local?.status || order.status)) {
            await ordersRepo.receiveOrder(remote).catch(() => {});
            paintStatus(box, remote);
            if (finished(remote.status)) stopWatching();
          }
        }
      } catch (error) {
        // A phone that loses signal should sit quietly, not shout at the
        // customer. The next tick will catch up.
        console.error('[TBC POS] could not refresh the order status', error);
      }
    };

    statusTimer = setInterval(tick, 8000);
    tick();
  }

  function stopWatching() {
    if (statusTimer) {
      clearInterval(statusTimer);
      statusTimer = null;
    }
  }

  /* ---------------------------------------------------------- assembly --- */

  function paintMenu() {
    // `append` from utils, not the DOM's own: this list has conditional
    // entries, and Node.append() would render a null as the text "null".
    append(clear(screen), [
      el('header.customer__head', {}, [
        el('img.customer__logo', { src: 'assets/logo.jpg', alt: '' }),
        el('h1.customer__cafe', { text: snapshot.cafeName || 'The Baruch Cafe' }),
        snapshot.tagline ? el('p.customer__tagline', { text: snapshot.tagline }) : null,
        el('p.customer__table', { text: tableName }),
      ]),
      acceptsOrders
        ? null
        : el('p.callout', {
            text: 'Ordering from your phone is switched off just now — please order at the counter.',
          }),
      chips,
      list,
      el('footer.customer__foot', {}, [
        el('p.customer__smallprint', {
          text:
            source === 'local'
              ? 'Prices are a guide. The counter confirms the total.'
              : 'Prices as shown at the counter today.',
        }),
      ]),
    ]);
    screen.appendChild(basketBar);
    paintChips();
    paintList();
    paintBar();
  }

  clear(outlet).appendChild(screen);
  paintMenu();

  // If this phone already has an order in flight, show it rather than a menu.
  try {
    const mine = await ordersRepo.listForDevice(deviceId());
    const live = mine.find(
      (row) => row.status === ONLINE_ORDER_STATUS.NEW || row.status === ONLINE_ORDER_STATUS.ACCEPTED
    );
    if (live) {
      state.placed = live;
      paintPlaced(live);
    }
  } catch {
    /* no previous order on this device */
  }

  return () => {
    stopWatching();
    document.body.classList.remove('is-customer');
  };
}
