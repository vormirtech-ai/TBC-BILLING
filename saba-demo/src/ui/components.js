/**
 * Shared interface pieces: toasts, dialogs, the prompts that stand between a
 * member of staff and an action they cannot undo, and the small primitives the
 * screens build out of.
 *
 * Every dialog here returns a Promise, so a view reads as
 *   `if (!(await confirm(...))) return;`
 * rather than as a nest of callbacks.
 */

import { h, add, clear, trapFocus, nextFrame, $ } from '../core/dom.js';
import { icon } from './icons.js';
import { VOID_REASONS } from '../config.js';

/* ------------------------------------------------------------- toast --- */

let toastHost = null;

export function toast(message, tone = 'default', ms = 3000) {
  if (!toastHost) {
    toastHost = h('div.toasts', { role: 'status', aria: { live: 'polite' } });
    document.body.appendChild(toastHost);
  }
  const glyph = { good: 'check', warn: 'warn', bad: 'warn' }[tone];
  const node = h(`div.toast${tone === 'default' ? '' : `.toast--${tone}`}`, {}, [
    glyph ? h('span.toast__icon', {}, icon(glyph, { size: 18 })) : null,
    h('span', { text: message }),
  ]);
  toastHost.appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity .2s, transform .2s';
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    setTimeout(() => node.remove(), 220);
  }, ms);
  return node;
}

/* ------------------------------------------------------------ dialog --- */

/**
 * Open a dialog.
 *
 * @param {object} spec
 * @param {string} spec.title
 * @param {string} [spec.subtitle]
 * @param {Node|Node[]} spec.body
 * @param {Array} [spec.actions]  [{ label, tone, onclick(close), autofocus }]
 * @param {string} [spec.size]    'slim' | 'wide'
 * @param {boolean} [spec.dismissible=true]
 * @returns {{ close: Function, root: Node }}
 */
export function dialog(spec) {
  const previous = document.activeElement;
  let releaseTrap = null;

  const close = (result) => {
    document.removeEventListener('keydown', onKey, true);
    releaseTrap?.();
    scrim.style.animation = 'fade-in .14s reverse both';
    setTimeout(() => scrim.remove(), 130);
    if (previous?.focus) previous.focus();
    spec.onclose?.(result);
  };

  function onKey(event) {
    if (event.key === 'Escape' && spec.dismissible !== false) {
      event.stopPropagation();
      close(null);
    }
  }

  const foot = (spec.actions || []).map((action) =>
    h(`button.btn${action.tone ? `.btn--${action.tone}` : '.btn--ghost'}`, {
      type: 'button',
      text: action.label,
      disabled: action.disabled,
      onclick: () => action.onclick?.(close),
      dataset: action.autofocus ? { autofocus: '1' } : {},
    })
  );

  const modal = h(`div.modal${spec.size ? `.modal--${spec.size}` : ''}`, {
    role: 'dialog', 'aria-modal': 'true', 'aria-label': spec.title,
  }, [
    h('div.modal__head', {}, [
      h('div.u-grow', {}, [
        h('h2.modal__title', { text: spec.title }),
        spec.subtitle ? h('p.modal__sub', { text: spec.subtitle }) : null,
      ]),
      spec.dismissible === false ? null : h('button.btn.btn--ghost.btn--icon.btn--sm', {
        type: 'button', 'aria-label': 'Close', onclick: () => close(null),
      }, icon('close', { size: 18 })),
    ]),
    h('div.modal__body', {}, spec.body),
    foot.length ? h('div.modal__foot', {}, foot) : null,
  ]);

  const scrim = h('div.scrim', {
    onclick: (event) => {
      if (event.target === scrim && spec.dismissible !== false) close(null);
    },
  }, modal);

  document.body.appendChild(scrim);
  document.addEventListener('keydown', onKey, true);
  releaseTrap = trapFocus(modal);
  nextFrame(() => {
    const target = $('[data-autofocus]', modal)
      || $('input,select,textarea,button', modal.querySelector('.modal__body'))
      || $('.modal__foot .btn', modal);
    target?.focus();
  });

  return { close, root: modal };
}

/** A yes/no question. Resolves true only if the affirmative was chosen. */
export function confirm({
  title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'primary', body,
}) {
  return new Promise((resolve) => {
    let answered = false;
    dialog({
      title,
      size: 'slim',
      body: body || h('p', { text: message, style: { color: 'var(--ink-2)', lineHeight: '1.6' } }),
      actions: [
        { label: cancelLabel, onclick: (close) => close() },
        {
          label: confirmLabel, tone, autofocus: true,
          onclick: (close) => { answered = true; close(); },
        },
      ],
      onclose: () => resolve(answered),
    });
  });
}

/** Ask for a single value. Resolves the string, or null if cancelled. */
export function prompt({
  title, subtitle, label, value = '', placeholder = '', type = 'text',
  confirmLabel = 'Save', hint,
}) {
  return new Promise((resolve) => {
    let result = null;
    const input = h(`input.input${type === 'textarea' ? '' : ''}`, {
      type: type === 'textarea' ? 'text' : type, value, placeholder,
    });
    const field = type === 'textarea'
      ? h('textarea.textarea', { placeholder, text: value })
      : input;

    const submit = (close) => { result = field.value.trim(); close(); };

    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && type !== 'textarea') {
        event.preventDefault();
        result = field.value.trim();
        handle.close();
      }
    });

    const handle = dialog({
      title,
      subtitle,
      size: 'slim',
      body: h('div.field', {}, [
        label ? h('label.field__label', { text: label }) : null,
        field,
        hint ? h('p.setting__hint', { text: hint }) : null,
      ]),
      actions: [
        { label: 'Cancel', onclick: (close) => { result = null; close(); } },
        { label: confirmLabel, tone: 'primary', onclick: submit },
      ],
      onclose: () => resolve(result),
    });
  });
}

/**
 * The reason prompt that guards every destructive action. A void without a
 * reason is a hole in the day's figures, so the confirm button stays disabled
 * until one is chosen — deliberately, and not apologetically.
 */
export function askReason({
  title, subtitle, reasons = VOID_REASONS, confirmLabel = 'Void', tone = 'danger',
}) {
  return new Promise((resolve) => {
    let chosen = null;
    let result = null;
    const other = h('input.input', { placeholder: 'Or type another reason…' });

    const buttons = reasons.map((reason) =>
      h('button.btn.btn--outline.btn--block', {
        type: 'button', text: reason,
        style: { justifyContent: 'flex-start' },
        onclick: (event) => {
          chosen = reason;
          other.value = '';
          for (const btn of buttons) btn.classList.remove('btn--primary');
          event.currentTarget.classList.add('btn--primary');
          sync();
        },
      })
    );

    other.addEventListener('input', () => {
      if (other.value.trim()) {
        chosen = null;
        for (const btn of buttons) btn.classList.remove('btn--primary');
      }
      sync();
    });

    const handle = dialog({
      title,
      subtitle,
      size: 'slim',
      body: h('div.grid', { style: { gap: '10px' } }, [
        h('p.u-caps', { text: 'Reason' }),
        ...buttons,
        h('div.divider'),
        other,
      ]),
      actions: [
        { label: 'Cancel', onclick: (close) => close() },
        {
          label: confirmLabel, tone, disabled: true,
          onclick: (close) => { result = chosen || other.value.trim(); close(); },
        },
      ],
      onclose: () => resolve(result),
    });

    function sync() {
      const button = handle.root.querySelector('.modal__foot .btn:last-child');
      button.disabled = !(chosen || other.value.trim());
    }
  });
}

/**
 * Manager authorisation. Anything that moves money away from the restaurant —
 * a comp, a heavy discount, reopening a settled bill — passes through here.
 * The demo prints the PIN on screen; a real install would not.
 */
export function authorise({ title, subtitle, users, allow = ['manager'] }) {
  return new Promise((resolve) => {
    let approved = null;
    const dots = h('div.pin__dots', {},
      Array.from({ length: 4 }, () => h('span.pin__dot')));
    const wrap = h('div.pin', {}, [dots]);
    let entry = '';

    const eligible = users.filter((u) => allow.includes(u.role));

    const paint = () => {
      [...dots.children].forEach((dot, i) => dot.classList.toggle('pin__dot--on', i < entry.length));
    };

    const press = (key) => {
      if (key === 'del') entry = entry.slice(0, -1);
      else if (entry.length < 4) entry += key;
      paint();
      if (entry.length === 4) {
        const match = eligible.find((u) => u.pin === entry);
        if (match) { approved = match; handle.close(); }
        else {
          wrap.classList.add('pin--bad');
          setTimeout(() => { wrap.classList.remove('pin--bad'); entry = ''; paint(); }, 480);
        }
      }
    };

    const keypad = h('div.keypad', {}, [
      ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) =>
        h('button.keypad__key', { type: 'button', text: k, onclick: () => press(k) })),
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
    };
    document.addEventListener('keydown', onKey);

    const handle = dialog({
      title,
      subtitle: subtitle || 'A manager must approve this.',
      size: 'slim',
      body: h('div.grid', { style: { gap: '16px', justifyItems: 'center' } }, [
        wrap,
        keypad,
        h('p.lock__note', {
          style: { textAlign: 'center' },
          text: `Demo PINs — ${eligible.map((u) => `${u.name.split(' ')[0]} ${u.pin}`).join(' · ')}`,
        }),
      ]),
      onclose: () => {
        document.removeEventListener('keydown', onKey);
        resolve(approved);
      },
    });
  });
}

/* -------------------------------------------------------- primitives --- */

export const chip = (text, tone, opts = {}) =>
  h(`span.chip${tone ? `.chip--${tone}` : ''}`, opts, [
    opts.dot ? h('span.chip__dot') : null,
    opts.icon ? icon(opts.icon, { size: 13 }) : null,
    text,
  ]);

export const caps = (text) => h('p.u-caps', { text });

export const rule = () => h('div.rule', {}, h('span.rule__mark'));

export function field(label, control, hint) {
  return h('div.field', {}, [
    h('label.field__label', { text: label }),
    control,
    hint ? h('p.setting__hint', { text: hint }) : null,
  ]);
}

export function setting(name, hint, control) {
  return h('div.setting', {}, [
    h('div.setting__text', {}, [
      h('div.setting__name', { text: name }),
      hint ? h('div.setting__hint', { text: hint }) : null,
    ]),
    h('div.setting__control', {}, control),
  ]);
}

export function toggle(checked, onchange) {
  const input = h('input', { type: 'checkbox', checked, onchange: (e) => onchange(e.target.checked) });
  return h('label.switch', {}, [input, h('span.switch__track')]);
}

export function segmented(options, selected, onpick, opts = {}) {
  return h('div.segmented', { role: 'tablist', ...(opts.props || {}) },
    options.map((option) =>
      h('button.segmented__btn', {
        type: 'button',
        role: 'tab',
        'aria-selected': String(option.id === selected),
        onclick: () => onpick(option.id),
      }, [
        option.icon ? icon(option.icon, { size: 15 }) : null,
        option.label,
        option.count != null ? h('span.segmented__count', { text: String(option.count) }) : null,
      ])
    ));
}

export function empty(title, message, action) {
  return h('div.empty', {}, [
    h('div.empty__mark'),
    h('p.empty__title', { text: title }),
    message ? h('p', { text: message, style: { maxWidth: '28rem' } }) : null,
    action || null,
  ]);
}

export function notice(text, tone = '', glyph = 'info') {
  return h(`div.notice${tone ? `.notice--${tone}` : ''}`, {}, [
    h('span.notice__icon', {}, icon(glyph, { size: 17 })),
    h('div', {}, text),
  ]);
}

export function statTile({ label, value, note, tone, delta: change, deltaLabel }) {
  return h(`div.stat${tone ? `.stat--${tone}` : ''}`, {}, [
    h('p.stat__label', { text: label }),
    h('p.stat__value', { text: value }),
    change != null && Number.isFinite(change)
      ? h(`span.delta.delta--${change >= 0 ? 'up' : 'down'}`, {}, [
        icon(change >= 0 ? 'arrowUp' : 'arrowDown', { size: 13 }),
        `${Math.abs(change).toFixed(1)}% ${deltaLabel || 'vs previous'}`,
      ])
      : note ? h('p.stat__note', { text: note }) : null,
  ]);
}

/** Header row used at the top of every full-page screen. */
export function pageHead(title, subtitle, actions = []) {
  return h('div.u-row', { style: { marginBottom: '18px', gap: '14px', flexWrap: 'wrap' } }, [
    h('div.u-grow', {}, [
      h('h1', { text: title, style: { font: '600 22px/1.2 var(--serif)' } }),
      subtitle ? h('p.u-muted', { text: subtitle, style: { fontSize: '13px', marginTop: '3px' } }) : null,
    ]),
    ...actions,
  ]);
}

export { h, add, clear, icon };
