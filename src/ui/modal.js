/** Modal dialogs: focus-trapped, escape-closable, keyboard reachable. */

import { el, clear, $$ } from '../core/utils.js';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * @param {{title:string, subtitle?:string, body:Node, actions?:Node[], size?:'sm'|'md'|'lg',
 *          dismissible?:boolean, onClose?:Function}} options
 */
export function openModal(options) {
  const {
    title,
    subtitle = '',
    body,
    actions = [],
    size = 'md',
    dismissible = true,
    onClose,
  } = options;

  const previouslyFocused = document.activeElement;

  const dialog = el(`div.modal.modal--${size}`, {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title,
  });

  const header = el('header.modal__head', {}, [
    el('div', {}, [
      el('h2.modal__title', { text: title }),
      subtitle ? el('p.modal__subtitle', { text: subtitle }) : null,
    ]),
    dismissible
      ? el('button.icon-btn', {
          type: 'button',
          'aria-label': 'Close',
          text: '×',
          onclick: () => close(),
        })
      : null,
  ]);

  const content = el('div.modal__body', {}, [body]);
  const footer = actions.length ? el('footer.modal__foot', {}, actions) : null;

  const overlay = el('div.overlay', {
    onclick: (event) => {
      if (dismissible && event.target === overlay) close();
    },
  });

  dialog.append(header, content);
  if (footer) dialog.append(footer);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  document.body.classList.add('is-modal-open');

  function onKeyDown(event) {
    if (event.key === 'Escape' && dismissible) {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = $$(FOCUSABLE, dialog).filter((node) => node.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  document.addEventListener('keydown', onKeyDown, true);

  let closed = false;
  function close(result) {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeyDown, true);
    overlay.remove();
    if (!document.querySelector('.overlay')) document.body.classList.remove('is-modal-open');
    if (previouslyFocused?.focus) previouslyFocused.focus();
    onClose?.(result);
  }

  // Focus the first meaningful control, not the close button.
  requestAnimationFrame(() => {
    const focusable = $$(FOCUSABLE, dialog).filter((node) => !node.classList.contains('icon-btn'));
    (focusable[0] || dialog).focus?.();
  });

  return {
    close,
    setBody(node) {
      clear(content).appendChild(node);
    },
    dialog,
  };
}

/** Yes/no confirmation. Resolves true only if the confirm button is used. */
export function confirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary',
  detail = null,
}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const body = el('div.stack', {}, [
      el('p.modal__text', { text: message }),
      detail ? el('div.modal__detail', { text: detail }) : null,
    ]);

    const modal = openModal({
      title,
      body,
      size: 'sm',
      actions: [
        el('button.btn.btn--ghost', {
          type: 'button',
          text: cancelLabel,
          onclick: () => {
            finish(false);
            modal.close();
          },
        }),
        el(`button.btn.btn--${tone}`, {
          type: 'button',
          text: confirmLabel,
          onclick: () => {
            finish(true);
            modal.close();
          },
        }),
      ],
      onClose: () => finish(false),
    });
  });
}
