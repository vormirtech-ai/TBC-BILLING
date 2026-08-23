/** Corner notifications. Errors stay until dismissed; successes fade. */

import { el } from '../core/utils.js';

let host = null;

function container() {
  if (!host) {
    host = el('div#toastHost.toast-host', { role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(host);
  }
  return host;
}

function show(message, tone, timeout) {
  const node = el(`div.toast.toast--${tone}`, {}, [
    el('div.toast__body', { text: message }),
    el('button.toast__close', {
      type: 'button',
      'aria-label': 'Dismiss',
      text: '×',
      onclick: () => node.remove(),
    }),
  ]);
  container().appendChild(node);
  if (timeout) setTimeout(() => node.remove(), timeout);
  return node;
}

export const toast = {
  success: (message) => show(message, 'success', 3200),
  info: (message) => show(message, 'info', 3600),
  warn: (message) => show(message, 'warn', 5200),
  error: (message) => show(message, 'error', 7000),
};

/**
 * Turn any thrown value into something a cashier can act on. AppError messages
 * are written for humans and pass through; anything else is a bug, so we log the
 * detail for the developer and show a plain sentence at the counter.
 */
export function reportError(error, fallback = 'Something went wrong. Nothing was saved.') {
  const message = error?.name === 'AppError' ? error.message : fallback;
  if (error?.name !== 'AppError') console.error('[TBC POS]', error);
  toast.error(message);
  return message;
}
