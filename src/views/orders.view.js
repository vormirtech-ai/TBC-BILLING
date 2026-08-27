/**
 * The order board.
 *
 * Every order the cafe has agreed to make and has not yet been paid for, in one
 * place: the ones taken at the counter and sent to the kitchen, and the ones
 * that came in from a table's QR code. They sit in the state they are actually
 * in — waiting, being made, ready, served — and move along with one tap.
 *
 * This is a working screen for somebody standing up, so every card answers the
 * same two questions without being opened: how long has this been waiting, and
 * what happens to it next.
 *
 * It also takes orders in the other way. When the cafe has no shared backend, a
 * customer's phone shows a code; "Scan a customer's code" reads it with the
 * camera where the browser can, and accepts it typed in where it cannot.
 */

import { el, clear, formatTime, formatDateTime } from '../core/utils.js';
import { formatMoney } from '../core/money.js';
import { getSettings } from '../repositories/settings.repo.js';
import * as ordersRepo from '../repositories/onlineOrders.repo.js';
import {
  ONLINE_ORDER_STATUS,
  ORDER_STATUS_LABELS,
  ORDER_SOURCES,
} from '../config/app.config.js';
import { subscribeOrders, pullRemoteOrders, announceStatus } from '../services/orderChannel.service.js';
import { isCloudEnabled } from '../services/cloudSync.service.js';
import * as incoming from '../services/incomingOrder.service.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toast, reportError } from '../ui/toast.js';
import { navigate } from '../core/router.js';

const STATUS_LABELS = ORDER_STATUS_LABELS;

/** The board, top to bottom. Oldest work first, in the order a shift works it. */
const LANES = [
  {
    status: ONLINE_ORDER_STATUS.NEW,
    title: 'Waiting to be accepted',
    hint: 'Sent in from a table. Nobody is making these yet.',
  },
  { status: ONLINE_ORDER_STATUS.ACCEPTED, title: 'Being made', hint: '' },
  { status: ONLINE_ORDER_STATUS.READY, title: 'Ready to go out', hint: '' },
  {
    status: ONLINE_ORDER_STATUS.SERVED,
    title: 'Served · waiting to pay',
    hint: 'On the table. Tap “Take payment” when they ask for the bill.',
  },
];

/** "4m" — how long this order has been waiting, which is the number that matters. */
function waitedFor(order) {
  const from = new Date(order.readyAt || order.acceptedAt || order.placedAt).getTime();
  const minutes = Math.max(0, Math.round((Date.now() - from) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export async function renderOrders({ outlet }) {
  const settings = getSettings();
  const symbol = settings.currencySymbol || '₹';

  const waitingList = el('div.orders__list');
  const recentList = el('div.orders__recent');
  const summary = el('p.page__sub');

  /* ------------------------------------------------------------ actions --- */

  /**
   * Put an order on the counter. Anything that could not be matched to this
   * device's menu is said out loud rather than quietly dropped — a missing line
   * is a drink somebody is waiting for.
   */
  function reportGaps(result) {
    for (const line of result.unknown || []) {
      toast.warn(`"${line.name}" is not on this menu — add it to the bill by hand.`);
    }
    for (const line of result.unavailable || []) {
      toast.warn(`"${line.name}" is marked unavailable — it was left off the bill.`);
    }
  }

  /** Accept a QR order and take it straight to the till. */
  async function acceptAndBill(order) {
    try {
      const result = await incoming.acceptAndLoad(order.id);
      reportGaps(result);
      toast.success(`Order ${order.code} is on the counter.`);
      navigate('/pos');
    } catch (error) {
      reportError(error);
    }
  }

  /**
   * Bring an order that is already being made to the till to be paid for. Its
   * place on the board does not change until the bill exists.
   */
  async function bill(order) {
    try {
      const result = await incoming.recallOrder(order.id);
      reportGaps(result);
      toast.success(`Order ${order.code} is on the counter.`);
      navigate('/pos');
    } catch (error) {
      reportError(error);
    }
  }

  /** Move an order along the board, and tell the customer's phone about it. */
  async function move(order, status) {
    try {
      const moved = await ordersRepo.setOrderStatus(order.id, status);
      // A phone watching this order should hear that it is on its way.
      await announceStatus(moved).catch(() => {});
      await paint();
    } catch (error) {
      reportError(error);
    }
  }

  /** Cancel an order the counter took. A QR order is turned down with a reason. */
  async function cancel(order) {
    if (order.source === ORDER_SOURCES.QR) {
      reject(order);
      return;
    }
    const ok = await confirmDialog({
      title: `Cancel order ${order.code}?`,
      message: 'It comes off the board. Nothing has been charged for it.',
      confirmLabel: 'Cancel the order',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await ordersRepo.rejectOrder(order.id, 'Cancelled at the counter');
      await paint();
    } catch (error) {
      reportError(error);
    }
  }

  function reject(order) {
    const reason = el('input.input', {
      type: 'text',
      placeholder: 'We have run out of that, sorry',
      maxlength: 160,
    });

    const modal = openModal({
      title: `Turn down order ${order.code}?`,
      subtitle: order.tableName || 'Unknown table',
      size: 'sm',
      body: el('div.stack', {}, [
        el('p.modal__text', {
          text: 'The customer sees this on their phone, so write something they can act on.',
        }),
        el('label.field', {}, [el('span.field__label', { text: 'Reason' }), reason]),
      ]),
      actions: [
        el('button.btn.btn--ghost', { type: 'button', text: 'Cancel', onclick: () => modal.close() }),
        el('button.btn.btn--danger', {
          type: 'button',
          text: 'Turn it down',
          onclick: async () => {
            try {
              await incoming.rejectAndAnnounce(order.id, reason.value);
              toast.success('The customer has been told.');
              modal.close();
              await paint();
            } catch (error) {
              reportError(error);
            }
          },
        }),
      ],
    });
    requestAnimationFrame(() => reason.focus());
  }

  /* --------------------------------------------------------- scan a code --- */

  function openScanner() {
    const manual = el('input.input.input--mono', {
      type: 'text',
      placeholder: 'TBC1|…',
      'aria-label': 'Customer order code',
      autocapitalize: 'none',
      spellcheck: false,
    });

    const video = el('video.scanner__video', {
      playsinline: true,
      muted: true,
      'aria-label': 'Camera preview',
    });
    const scannerNote = el('p.hint');
    const scannerBox = el('div.scanner', { hidden: true }, [video, scannerNote]);

    let stream = null;
    let scanning = false;

    async function submit(text) {
      try {
        const result = await incoming.importHandoff(text);
        reportGaps(result);
        stop();
        modal.close();
        toast.success(
          result.reused
            ? `Order ${result.order.code} was already in the queue — it is on the counter now.`
            : `Order ${result.order.code} is on the counter.`
        );
        navigate('/pos');
      } catch (error) {
        reportError(error);
      }
    }

    function stop() {
      scanning = false;
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
      }
    }

    /**
     * Camera scanning uses the browser's own barcode detector where it exists.
     * It is missing on plenty of desktop browsers, so this is an accelerator
     * for the typed code, never the only way in.
     */
    async function startCamera() {
      if (!('BarcodeDetector' in window)) {
        scannerNote.textContent =
          'This browser cannot use the camera to read codes. Type the code below instead.';
        scannerBox.hidden = false;
        return;
      }
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats();
        if (!formats.includes('qr_code')) {
          scannerNote.textContent = 'This browser cannot read QR codes. Type the code below instead.';
          scannerBox.hidden = false;
          return;
        }

        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        video.srcObject = stream;
        await video.play();

        scannerBox.hidden = false;
        scannerNote.textContent = 'Hold the customer’s code in front of the camera.';

        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        scanning = true;

        const tick = async () => {
          if (!scanning) return;
          try {
            const codes = await detector.detect(video);
            if (codes.length && codes[0].rawValue) {
              scanning = false;
              await submit(codes[0].rawValue);
              return;
            }
          } catch {
            /* a frame that will not decode is normal; try the next one */
          }
          if (scanning) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      } catch (error) {
        scannerBox.hidden = false;
        scannerNote.textContent =
          error?.name === 'NotAllowedError'
            ? 'The camera was blocked. Type the code below instead.'
            : 'The camera could not be opened. Type the code below instead.';
      }
    }

    const modal = openModal({
      title: 'Take a customer’s order code',
      subtitle: 'Scan the code on their phone, or type the characters underneath it.',
      body: el('div.stack', {}, [
        el('div.actionrow', {}, [
          el('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            text: 'Use the camera',
            onclick: (event) => {
              event.currentTarget.disabled = true;
              startCamera();
            },
          }),
        ]),
        scannerBox,
        el('label.field', {}, [
          el('span.field__label', { text: 'Or paste the code' }),
          manual,
          el('span.hint', { text: 'The long code beginning TBC1, from under the QR on their screen.' }),
        ]),
      ]),
      actions: [
        el('button.btn.btn--ghost', {
          type: 'button',
          text: 'Cancel',
          onclick: () => {
            stop();
            modal.close();
          },
        }),
        el('button.btn.btn--primary', {
          type: 'button',
          text: 'Load the order',
          onclick: () => submit(manual.value),
        }),
      ],
      onClose: stop,
    });

    manual.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submit(manual.value);
    });
    requestAnimationFrame(() => manual.focus());
  }

  /* -------------------------------------------------------------- paint --- */

  /** What this order lets you do next, in the order the buttons should read. */
  function cardActions(order) {
    switch (order.status) {
      case ONLINE_ORDER_STATUS.NEW:
        return [
          ['ghost', 'Turn down', () => reject(order)],
          ['ghost', 'Start making', () => move(order, ONLINE_ORDER_STATUS.ACCEPTED)],
          ['primary', 'Accept and bill', () => acceptAndBill(order)],
        ];
      case ONLINE_ORDER_STATUS.ACCEPTED:
        return [
          ['ghost', 'Cancel', () => cancel(order)],
          ['ghost', 'Take payment', () => bill(order)],
          ['primary', 'Mark ready', () => move(order, ONLINE_ORDER_STATUS.READY)],
        ];
      case ONLINE_ORDER_STATUS.READY:
        return [
          ['ghost', 'Back to making', () => move(order, ONLINE_ORDER_STATUS.ACCEPTED)],
          ['ghost', 'Take payment', () => bill(order)],
          ['primary', 'Mark served', () => move(order, ONLINE_ORDER_STATUS.SERVED)],
        ];
      case ONLINE_ORDER_STATUS.SERVED:
        return [
          ['ghost', 'Back to ready', () => move(order, ONLINE_ORDER_STATUS.READY)],
          ['primary', 'Take payment', () => bill(order)],
        ];
      default:
        return [];
    }
  }

  function orderCard(order) {
    const lines = order.lines.map((line) =>
      el('div.ordercard__line', {}, [
        el('span', { text: `${line.quantity} × ${line.name}${line.note ? ` — ${line.note}` : ''}` }),
        el('span', { text: formatMoney(line.unitPrice * line.quantity, symbol) }),
      ])
    );

    const fromQr = order.source === ORDER_SOURCES.QR || Boolean(order.tableToken);

    return el(
      'article.ordercard',
      { class: order.status === ONLINE_ORDER_STATUS.NEW ? 'is-waiting' : '' },
      [
        el('header.ordercard__head', {}, [
          el('div', {}, [
            el('h3.ordercard__table', { text: order.tableName || 'Counter' }),
            el('span.ordercard__meta', {
              text: [
                order.code,
                formatTime(order.placedAt),
                `waiting ${waitedFor(order)}`,
                order.customerName || '',
              ]
                .filter(Boolean)
                .join(' · '),
            }),
          ]),
          el('div.ordercard__tags', {}, [
            el('span.pill.pill--source', { text: fromQr ? 'QR' : 'Counter' }),
            el(`span.pill.pill--${String(order.status).toLowerCase()}`, {
              text: STATUS_LABELS[order.status] || order.status,
            }),
          ]),
        ]),

        el('div.ordercard__lines', {}, lines),

        order.note ? el('p.ordercard__note', { text: `“${order.note}”` }) : null,

        el('div.ordercard__foot', {}, [
          el('span.ordercard__total', {
            text: `About ${formatMoney(order.estimatedTotal, symbol)}`,
            title: 'The counter prices the order from this device’s menu when it is billed.',
          }),
          el(
            'div.ordercard__actions',
            {},
            cardActions(order).map(([tone, label, handler]) =>
              el(`button.btn.btn--${tone}.btn--sm`, { type: 'button', text: label, onclick: handler })
            )
          ),
        ]),
      ]
    );
  }

  async function paint() {
    const all = await ordersRepo.listOrders();
    const open = LANES.map((lane) => ({
      ...lane,
      // Oldest first inside a lane: whoever has been waiting longest is served
      // first, which is the opposite of how the list is stored.
      orders: all.filter((order) => order.status === lane.status).reverse(),
    }));

    const counts = Object.fromEntries(open.map((lane) => [lane.status, lane.orders.length]));
    const live = open.reduce((total, lane) => total + lane.orders.length, 0);

    summary.textContent = live
      ? [
          counts[ONLINE_ORDER_STATUS.NEW] ? `${counts[ONLINE_ORDER_STATUS.NEW]} waiting` : '',
          counts[ONLINE_ORDER_STATUS.ACCEPTED]
            ? `${counts[ONLINE_ORDER_STATUS.ACCEPTED]} being made`
            : '',
          counts[ONLINE_ORDER_STATUS.READY] ? `${counts[ONLINE_ORDER_STATUS.READY]} ready` : '',
          counts[ONLINE_ORDER_STATUS.SERVED]
            ? `${counts[ONLINE_ORDER_STATUS.SERVED]} waiting to pay`
            : '',
        ]
          .filter(Boolean)
          .join(' · ')
      : 'Nothing on the board.';

    clear(waitingList);

    if (!live) {
      waitingList.appendChild(
        el('div.empty', {}, [
          el('p', { text: 'Nothing on the board.' }),
          el('p.hint', {
            text: isCloudEnabled()
              ? 'Send an order to the kitchen from the counter, or wait for one from a table QR code — those arrive on their own, and this counter makes a sound when one does.'
              : 'Send an order to the kitchen from the counter. For an order from a customer’s phone, use “Scan a customer’s code”.',
          }),
        ])
      );
    } else {
      for (const lane of open) {
        if (!lane.orders.length) continue;
        waitingList.append(
          el('div.orders__lane', {}, [
            el('h2.panel__title', { text: `${lane.title} · ${lane.orders.length}` }),
            lane.hint ? el('p.hint', { text: lane.hint }) : null,
            el('div.orders__lanelist', {}, lane.orders.map((order) => orderCard(order))),
          ])
        );
      }
    }

    // Finished with: billed and cancelled, newest first.
    const done = all
      .filter((order) =>
        [ONLINE_ORDER_STATUS.BILLED, ONLINE_ORDER_STATUS.REJECTED].includes(order.status)
      )
      .slice(0, 12);

    clear(recentList);
    if (done.length) {
      recentList.append(
        el('h2.panel__title', { text: 'Finished' }),
        ...done.map((order) =>
          el('div.orders__row', {}, [
            el('span.mono', { text: order.code }),
            el('span', { text: order.tableName || 'Counter' }),
            el('span', { text: formatDateTime(order.placedAt) }),
            el('span', { text: STATUS_LABELS[order.status] || order.status }),
            order.orderNo
              ? el('a.table__num', {
                  href: `#/history?bill=${encodeURIComponent(order.orderNo)}`,
                  text: order.orderNo,
                })
              : el('span.table__num', { text: formatMoney(order.estimatedTotal, symbol) }),
          ])
        )
      );
    }
  }

  /* ---------------------------------------------------------- assembly --- */

  const page = el('div.page', {}, [
    el('div.page__head', {}, [
      el('div', {}, [el('h1.page__title', { text: 'Orders' }), summary]),
      el('div.page__actions', {}, [
        el('button.btn.btn--ghost', {
          type: 'button',
          text: 'Refresh',
          onclick: async (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            try {
              if (isCloudEnabled()) await pullRemoteOrders();
              await paint();
            } finally {
              button.disabled = false;
            }
          },
        }),
        // With the cafe database connected, orders arrive on their own and
        // this is only ever a fallback, so it stops being the loudest button
        // on the screen.
        el(isCloudEnabled() ? 'button.btn.btn--ghost' : 'button.btn.btn--primary', {
          type: 'button',
          text: isCloudEnabled() ? 'Enter a code by hand' : 'Scan a customer’s code',
          onclick: openScanner,
        }),
      ]),
    ]),

    isCloudEnabled()
      ? null
      : el('p.callout.callout--warn', {}, [
          el('strong', { text: 'Orders cannot reach this counter on their own yet. ' }),
          el('span', {
            text:
              'This device is storing data by itself, so an order from a customer’s phone has to be handed over as a code. Connect the cafe database and they arrive here within seconds.',
          }),
          el('a.btn.btn--primary.btn--sm', { href: '#/setup', text: 'Set up the cafe database' }),
        ]),

    waitingList,
    recentList,
  ]);

  clear(outlet).appendChild(page);
  await paint();

  // Repaint whenever an order arrives, from any route.
  const unsubscribe = subscribeOrders(() => paint());

  // "waiting 4m" has to keep counting, or the board quietly starts lying about
  // how long somebody has been sitting there.
  const clock = setInterval(() => paint(), 60000);

  return () => {
    unsubscribe();
    clearInterval(clock);
  };
}
