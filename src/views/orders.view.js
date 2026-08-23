/**
 * The queue of orders sent in from table QR codes.
 *
 * This is a working screen for someone standing behind a counter, so it is
 * built around one decision: make it, or don't. Accepting an order loads it
 * straight onto the till, priced from this device's menu, ready for payment.
 *
 * It also takes orders in the other way. When the cafe has no shared backend, a
 * customer's phone shows a code; "Scan a customer's code" reads it with the
 * camera where the browser can, and accepts it typed in where it cannot.
 */

import { el, clear, formatTime, formatDateTime } from '../core/utils.js';
import { formatMoney } from '../core/money.js';
import { getSettings } from '../repositories/settings.repo.js';
import * as ordersRepo from '../repositories/onlineOrders.repo.js';
import { ONLINE_ORDER_STATUS } from '../config/app.config.js';
import { subscribeOrders, pullRemoteOrders } from '../services/orderChannel.service.js';
import { isCloudEnabled } from '../services/cloudSync.service.js';
import * as incoming from '../services/incomingOrder.service.js';
import { openModal } from '../ui/modal.js';
import { toast, reportError } from '../ui/toast.js';
import { navigate } from '../core/router.js';

const STATUS_LABELS = {
  [ONLINE_ORDER_STATUS.NEW]: 'Waiting',
  [ONLINE_ORDER_STATUS.ACCEPTED]: 'Accepted',
  [ONLINE_ORDER_STATUS.BILLED]: 'Billed',
  [ONLINE_ORDER_STATUS.REJECTED]: 'Not accepted',
};

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

  async function accept(order) {
    try {
      const result = await incoming.acceptAndLoad(order.id);
      reportGaps(result);
      toast.success(`Order ${order.code} is on the counter.`);
      navigate('/pos');
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

  function orderCard(order, { waiting }) {
    const lines = order.lines.map((line) =>
      el('div.ordercard__line', {}, [
        el('span', { text: `${line.quantity} × ${line.name}` }),
        el('span', { text: formatMoney(line.unitPrice * line.quantity, symbol) }),
      ])
    );

    return el('article.ordercard', { class: waiting ? 'is-waiting' : '' }, [
      el('header.ordercard__head', {}, [
        el('div', {}, [
          el('h3.ordercard__table', { text: order.tableName || 'Unknown table' }),
          el('span.ordercard__meta', {
            text: `${order.code} · ${formatTime(order.placedAt)}${
              order.customerName ? ` · ${order.customerName}` : ''
            }`,
          }),
        ]),
        el(`span.pill.pill--${String(order.status).toLowerCase()}`, {
          text: STATUS_LABELS[order.status] || order.status,
        }),
      ]),

      el('div.ordercard__lines', {}, lines),

      order.note ? el('p.ordercard__note', { text: `“${order.note}”` }) : null,

      el('div.ordercard__foot', {}, [
        el('span.ordercard__total', {
          text: `About ${formatMoney(order.estimatedTotal, symbol)}`,
          title: 'The counter prices the order from this device’s menu when it is billed.',
        }),
        waiting
          ? el('div.ordercard__actions', {}, [
              el('button.btn.btn--ghost.btn--sm', {
                type: 'button',
                text: 'Turn down',
                onclick: () => reject(order),
              }),
              el('button.btn.btn--primary.btn--sm', {
                type: 'button',
                text: 'Accept and bill',
                onclick: () => accept(order),
              }),
            ])
          : order.status === ONLINE_ORDER_STATUS.ACCEPTED
          ? el('button.btn.btn--primary.btn--sm', {
              type: 'button',
              text: 'Put on the counter',
              onclick: () => accept(order),
            })
          : order.orderNo
          ? el('a.btn.btn--ghost.btn--sm', {
              href: `#/history?bill=${encodeURIComponent(order.orderNo)}`,
              text: order.orderNo,
            })
          : null,
      ]),
    ]);
  }

  async function paint() {
    const all = await ordersRepo.listOrders();
    const waiting = all.filter((order) => order.status === ONLINE_ORDER_STATUS.NEW);
    const accepted = all.filter((order) => order.status === ONLINE_ORDER_STATUS.ACCEPTED);
    const rest = all
      .filter(
        (order) =>
          order.status !== ONLINE_ORDER_STATUS.NEW && order.status !== ONLINE_ORDER_STATUS.ACCEPTED
      )
      .slice(0, 12);

    summary.textContent = waiting.length
      ? `${waiting.length} waiting${accepted.length ? `, ${accepted.length} being made` : ''}`
      : accepted.length
      ? `${accepted.length} being made`
      : 'Nothing waiting.';

    clear(waitingList);
    const active = [...waiting, ...accepted];
    if (!active.length) {
      waitingList.appendChild(
        el('div.empty', {}, [
          el('p', { text: 'No orders waiting.' }),
          el('p.hint', {
            text: isCloudEnabled()
              ? 'Orders from table QR codes appear here on their own.'
              : 'When a customer orders from their phone, use “Scan a customer’s code” to bring it in.',
          }),
        ])
      );
    } else {
      for (const order of waiting) waitingList.appendChild(orderCard(order, { waiting: true }));
      for (const order of accepted) waitingList.appendChild(orderCard(order, { waiting: false }));
    }

    clear(recentList);
    if (rest.length) {
      recentList.append(
        el('h2.panel__title', { text: 'Earlier today' }),
        ...rest.map((order) =>
          el('div.orders__row', {}, [
            el('span.mono', { text: order.code }),
            el('span', { text: order.tableName || '—' }),
            el('span', { text: formatDateTime(order.placedAt) }),
            el('span', { text: STATUS_LABELS[order.status] || order.status }),
            el('span.table__num', { text: formatMoney(order.estimatedTotal, symbol) }),
          ])
        )
      );
    }
  }

  /* ---------------------------------------------------------- assembly --- */

  const page = el('div.page', {}, [
    el('div.page__head', {}, [
      el('div', {}, [el('h1.page__title', { text: 'QR orders' }), summary]),
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
        el('button.btn.btn--primary', {
          type: 'button',
          text: 'Scan a customer’s code',
          onclick: openScanner,
        }),
      ]),
    ]),

    el('p.callout', {
      text: isCloudEnabled()
        ? 'Live ordering is on: orders sent from a phone arrive here by themselves.'
        : 'This counter is running on-device. Orders arrive from another tab on this device, or by scanning the code on a customer’s phone. Turn on live ordering in Settings to have them arrive by themselves.',
    }),

    waitingList,
    recentList,
  ]);

  clear(outlet).appendChild(page);
  await paint();

  // Repaint whenever an order arrives, from any route.
  const unsubscribe = subscribeOrders(() => paint());
  return () => unsubscribe();
}
