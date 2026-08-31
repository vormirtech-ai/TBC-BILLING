/**
 * The bill: preview on the left, settlement on the right.
 *
 * The left is the actual printed document, rendered from the same code that
 * feeds the printer — there is no second template that could drift.
 *
 * The right is everything a cashier does to it: service charge on or off,
 * discounts (with a manager's PIN past the approval threshold), gratuity,
 * splitting three different ways, and taking payment across as many tenders as
 * the table wants.
 */

import { h, fill } from '../core/dom.js';
import {
  CHARGES, PAYMENT_METHODS, TIP_PRESETS, paymentLabel, KOT_STATUS, } from '../config.js';
import { money, toPaise, pct, splitEvenly } from '../core/money.js';
import { elapsed, clockTime, plural } from '../core/format.js';
import { costOrder, buildSplit, costSplit } from '../domain/pricing.js';
import {
  orderById, openOrders, costOrder as setServiceCharge, setDiscount, setTip,
  setSplit, raiseInvoice, addPayment, removePayment, settleOrder, reopenOrder,
  can, users, session, getState,
} from '../state.js';
import { navigate } from '../core/router.js';
import { setTopbar } from '../ui/shell.js';
import {
  dialog, confirm, authorise, askReason, toast, icon, empty, chip, segmented,
  notice, caps,
} from '../ui/components.js';
import { renderBill, printDocs } from '../ui/print.js';

/** Screen-local: which tender the cashier has selected, and the amount typed. */
const ui = { method: 'CARD', amount: '', share: null, format: 'A4' };

export function renderBillView(host, params) {
  const order = params.order ? orderById(params.order) : pickWaiting();

  if (!order) {
    setTopbar({ title: 'Bills' });
    fill(host, renderQueue());
    return;
  }

  const totals = costOrder(order);
  const settled = order.status === 'SETTLED';

  setTopbar({
    title: `Bill · Table ${order.tableLabel}`,
    subtitle: `${order.invoice?.code || order.code} · ${plural(order.covers, 'cover')} · ${
      settled ? `settled ${clockTime(order.closedAt)}` : `open ${elapsed(order.openedAt)}`}`,
    actions: [
      h('button.btn.btn--ghost.btn--sm', {
        type: 'button', onclick: () => navigate('/bill'),
      }, [icon('back', { size: 16 }), 'All bills']),
      settled ? null : h('button.btn.btn--outline.btn--sm', {
        type: 'button', onclick: () => navigate('/order', { order: order.id }),
      }, [icon('order', { size: 16 }), 'Back to order']),
    ],
  });

  fill(host, h('div.settle', {}, [
    h('div.settle__left', {}, [
      h('div.u-row', { style: { marginBottom: '14px', justifyContent: 'center', gap: '8px' } }, [
        segmented(
          [{ id: 'A4', label: 'A4 invoice' }, { id: 'THERMAL', label: '80mm thermal' }],
          ui.format,
          (id) => { ui.format = id; renderBillView(host, params); }
        ),
      ]),
      h('div.paper-wrap', { style: { display: 'grid', justifyItems: 'center' } },
        renderBill(order, totals, {
          format: ui.format,
          copy: settled ? 'Duplicate' : 'Not yet settled',
          showVoids: can('void'),
        })),
    ]),

    h('aside.settle__right', {}, settled
      ? renderSettled(host, order, totals)
      : renderSettle(host, order, totals)),
  ]));
}

/* -------------------------------------------------------------- queue --- */

function pickWaiting() {
  const waiting = openOrders().filter((o) => o.invoice);
  return waiting.length === 1 ? waiting[0] : null;
}

function renderQueue() {
  const live = openOrders();
  const awaiting = live.filter((o) => o.invoice);
  const open = live.filter((o) => !o.invoice && o.lines.some((l) => l.status !== KOT_STATUS.VOID));
  const done = getState().settled;

  return h('div.view__pad.grid', { style: { gap: '22px' } }, [
    awaiting.length ? section('Waiting to pay', awaiting, 'burgundy') : null,
    open.length ? section('Open tables', open, 'gold') : null,
    done.length ? settledSection(done) : null,
    !awaiting.length && !open.length && !done.length
      ? empty('No bills yet', 'Open a table and take an order — it will appear here.')
      : null,
  ]);
}

function section(title, orders, tone) {
  return h('section', {}, [
    h('h2', { text: title, style: { font: '600 17px/1.2 var(--serif)', marginBottom: '10px' } }),
    h('div.list', {}, orders.map((order) => {
      const totals = costOrder(order);
      return h('div.row-card', {}, [
        h('span.row-card__time', { text: order.tableLabel }),
        h('div.u-grow', {}, [
          h('div.row-card__name', { text: order.guestName || `${order.covers} covers` }),
          h('div.row-card__note', {
            text: `${order.invoice?.code || order.code} · ${plural(totals.itemCount, 'item')} · open ${elapsed(order.openedAt)} · ${order.captainName}`,
          }),
        ]),
        chip(money(totals.total), tone),
        h('div.row-card__actions', {}, [
          h('button.btn.btn--primary.btn--sm', {
            type: 'button', text: order.invoice ? 'Settle' : 'Bill',
            onclick: () => navigate('/bill', { order: order.id }),
          }),
        ]),
      ]);
    })),
  ]);
}

function settledSection(done) {
  return h('section', {}, [
    h('h2', { text: 'Settled today', style: { font: '600 17px/1.2 var(--serif)', marginBottom: '10px' } }),
    h('div.list', {}, done.slice(0, 12).map((order) => {
      const totals = costOrder(order);
      return h('div.row-card', {}, [
        h('span.row-card__time', { text: clockTime(order.closedAt) }),
        h('div.u-grow', {}, [
          h('div.row-card__name', { text: `Table ${order.tableLabel} · ${order.invoice?.code}` }),
          h('div.row-card__note', {
            text: `${plural(order.covers, 'cover')} · ${order.payments.map((p) => paymentLabel(p.method)).join(' + ') || 'unpaid'}`,
          }),
        ]),
        chip(money(totals.total), 'sage'),
        h('div.row-card__actions', {}, [
          h('button.btn.btn--outline.btn--sm', {
            type: 'button', text: 'View',
            onclick: () => navigate('/bill', { order: order.id }),
          }),
        ]),
      ]);
    })),
  ]);
}

/* ------------------------------------------------------------ settle --- */

function renderSettle(host, order, totals) {
  const again = () => renderBillView(host, { order: order.id });
  const balance = totals.balance;
  const split = order.split;

  return [
    /* --- what is owed --- */
    h(`div.due${balance <= 0 ? '.due--clear' : ''}`, {}, [
      h('span.due__label', { text: balance > 0 ? 'Balance due' : 'Fully paid' }),
      h('span.due__value', { text: money(Math.abs(balance)) }),
      h('span.due__hint', {
        text: totals.paid
          ? `${money(totals.paid)} taken of ${money(totals.total)}`
          : `${plural(totals.itemCount, 'item')} · ${plural(order.covers, 'cover')}`,
      }),
    ]),

    h('div.divider'),

    /* --- adjustments --- */
    caps('Adjustments'),
    h('div.grid', { style: { gap: '8px' } }, [
      h('button.btn.btn--outline.btn--block', {
        type: 'button',
        style: { justifyContent: 'space-between' },
        onclick: () => { setServiceCharge(order.id, !totals.serviceChargeApplied); again(); },
      }, [
        h('span.u-row', {}, [
          icon('users', { size: 16 }),
          `${CHARGES.serviceChargeLabel} ${CHARGES.serviceChargeBps / 100}%`,
        ]),
        h('span', { text: totals.serviceChargeApplied ? money(totals.serviceCharge) : 'Removed' }),
      ]),

      h('button.btn.btn--outline.btn--block', {
        type: 'button',
        style: { justifyContent: 'space-between' },
        onclick: () => openDiscount(host, order),
      }, [
        h('span.u-row', {}, [icon('voucher', { size: 16 }), 'Discount']),
        h('span', { text: totals.discount ? `− ${money(totals.discount)}` : 'None' }),
      ]),

      h('button.btn.btn--outline.btn--block', {
        type: 'button',
        style: { justifyContent: 'space-between' },
        onclick: () => openTip(host, order, totals),
      }, [
        h('span.u-row', {}, [icon('star', { size: 16 }), 'Gratuity']),
        h('span', { text: totals.tip ? money(totals.tip) : 'None' }),
      ]),

      h('button.btn.btn--outline.btn--block', {
        type: 'button',
        style: { justifyContent: 'space-between' },
        onclick: () => openSplit(host, order),
      }, [
        h('span.u-row', {}, [icon('split', { size: 16 }), 'Split the bill']),
        h('span', { text: split ? `${split.shares.length} ways` : 'One bill' }),
      ]),
    ]),

    split ? renderSplit(host, order, split) : null,

    h('div.divider'),

    /* --- print --- */
    order.invoice
      ? notice(`Bill ${order.invoice.code} printed at ${clockTime(order.invoice.at)} by ${order.invoice.by}.`, 'info')
      : null,

    h('div.grid', { style: { gap: '8px', gridTemplateColumns: '1fr 1fr' } }, [
      h('button.btn.btn--outline', {
        type: 'button',
        onclick: () => {
          const invoice = raiseInvoice(order.id);
          const fresh = orderById(order.id);
          printDocs([renderBill(fresh, costOrder(fresh), { format: ui.format, copy: 'Guest copy' })]);
          toast(`Bill ${invoice.code} printed`, 'good');
          again();
        },
      }, [icon('print', { size: 16 }), order.invoice ? 'Reprint' : 'Print bill']),

      h('button.btn.btn--ghost', {
        type: 'button',
        onclick: () => {
          const fresh = orderById(order.id);
          printDocs([
            renderBill(fresh, costOrder(fresh), { format: ui.format, copy: 'Guest copy' }),
            renderBill(fresh, costOrder(fresh), { format: ui.format, copy: 'Restaurant copy', showVoids: true }),
          ]);
        },
      }, [icon('print', { size: 16 }), 'Both copies']),
    ]),

    h('div.divider'),

    /* --- payment --- */
    caps('Take payment'),
    h('div.tender', {}, PAYMENT_METHODS.map((method) =>
      h('button.tender__btn', {
        type: 'button',
        'aria-pressed': String(ui.method === method.id),
        onclick: () => { ui.method = method.id; again(); },
      }, [icon(method.icon, { size: 20 }), method.label]))),

    balance > 0 ? renderTenderPad(host, order, totals) : null,

    order.payments.length ? h('div.grid', { style: { gap: '7px' } }, [
      caps('Taken'),
      ...order.payments.map((payment) => h('div.paid-row', {}, [
        icon('check', { size: 16 }),
        h('span.u-grow', { text: `${paymentLabel(payment.method)}${payment.ref ? ` · ${payment.ref}` : ''}` }),
        h('span.money', { text: money(payment.paise) }),
        h('button.btn.btn--ghost.btn--icon.btn--xs', {
          type: 'button', 'aria-label': 'Remove',
          onclick: () => { removePayment(order.id, payment.id); again(); },
        }, icon('trash', { size: 14 })),
      ])),
    ]) : null,

    h('div.divider'),

    h('button.btn.btn--primary.btn--lg.btn--block', {
      type: 'button',
      disabled: balance > 0,
      onclick: () => closeTable(host, order),
    }, [
      icon('check', { size: 18 }),
      balance > 0 ? `${money(balance)} still due` : 'Close table',
    ]),
  ];
}

/** Cash pad with the notes an Indian till actually holds, plus exact change. */
function renderTenderPad(host, order, totals) {
  const again = () => renderBillView(host, { order: order.id });
  const balance = totals.balance;

  const amount = h('input.input', {
    type: 'number', step: '0.01', min: '0',
    value: ui.amount || (balance / 100).toFixed(2),
    style: { fontSize: '19px', fontWeight: '600', textAlign: 'right' },
    oninput: (event) => { ui.amount = event.target.value; },
  });

  const take = (paise, ref) => {
    if (paise <= 0) return;
    addPayment(order.id, { method: ui.method, paise, ref });
    ui.amount = '';
    const after = costOrder(orderById(order.id));
    toast(
      after.balance > 0
        ? `${money(paise)} taken · ${money(after.balance)} still due`
        : after.balance < 0
          ? `${money(paise)} taken · change ${money(-after.balance)}`
          : `${money(paise)} taken · paid in full`,
      'good'
    );
    again();
  };

  const notes = [500, 1000, 2000, 5000].map((rupees) => rupees * 100);
  const rounded = Math.ceil(balance / 50000) * 50000;

  return h('div.grid', { style: { gap: '9px' } }, [
    h('div.field', {}, [
      h('label.field__label', { text: `Amount · ${paymentLabel(ui.method)}` }),
      amount,
    ]),

    ui.method === 'CASH'
      ? h('div.quickcash', {}, [
        h('button.btn.btn--outline.btn--sm', {
          type: 'button', text: 'Exact', onclick: () => take(balance),
        }),
        ...notes.filter((n) => n >= balance).slice(0, 3).map((paise) =>
          h('button.btn.btn--outline.btn--sm', {
            type: 'button', text: money(paise), onclick: () => take(paise),
          })),
        rounded > balance ? h('button.btn.btn--outline.btn--sm', {
          type: 'button', text: money(rounded), onclick: () => take(rounded),
        }) : null,
      ])
      : h('div.quickcash', {}, [
        h('button.btn.btn--outline.btn--sm', {
          type: 'button', text: `Full ${money(balance)}`, onclick: () => take(balance),
        }),
        h('button.btn.btn--outline.btn--sm', {
          type: 'button', text: 'Half', onclick: () => take(splitEvenly(balance, 2)[0]),
        }),
      ]),

    h('button.btn.btn--gold.btn--block', {
      type: 'button',
      onclick: () => {
        const paise = toPaise(amount.value);
        if (!paise) { toast('Enter an amount first', 'warn'); return; }
        if (ui.method === 'CARD' || ui.method === 'UPI') {
          take(paise, `Ref ${String(Date.now()).slice(-6)}`);
        } else take(paise);
      },
    }, [icon('plus', { size: 17 }), `Take ${paymentLabel(ui.method)}`]),
  ]);
}

/* ------------------------------------------------------------- split --- */

function openSplit(host, order) {
  let mode = order.split?.mode || 'EQUAL';
  let ways = order.split?.shares.length || Math.min(order.covers, 4);

  const waysInput = h('input.input', {
    type: 'number', min: '2', max: '20', value: String(ways),
    oninput: (event) => { ways = Number(event.target.value) || 2; },
  });

  const seatCount = new Set(order.lines.filter((l) => l.seat).map((l) => l.seat)).size;

  dialog({
    title: 'Split the bill',
    subtitle: 'Three ways, because guests ask for all three.',
    body: h('div.grid', { style: { gap: '14px' } }, [
      h('div.grid', { style: { gap: '8px' } }, [
        splitOption('EQUAL', 'Down the middle',
          'One total divided evenly. The items stay on one list — nobody wants a third of a lamb shank printed.',
          () => { mode = 'EQUAL'; }),
        splitOption('SEAT', `By seat${seatCount ? ` · ${seatCount} seats in use` : ''}`,
          seatCount
            ? 'Each guest pays for what they ordered, taken from the seat numbers the captain recorded.'
            : 'No seat numbers were recorded on this order, so everything would land on one share.',
          () => { mode = 'SEAT'; }, !seatCount),
        splitOption('ITEM', 'By item',
          'Start with everything on one share and move lines across by hand.',
          () => { mode = 'ITEM'; }),
      ]),
      h('div.field', {}, [
        h('label.field__label', { text: 'Number of shares (even and by-item splits)' }),
        waysInput,
      ]),
    ]),
    actions: [
      order.split ? {
        label: 'Back to one bill',
        onclick: (close) => { setSplit(order.id, null); close(); renderBillView(host, { order: order.id }); },
      } : { label: 'Cancel', onclick: (close) => close() },
      {
        label: 'Split', tone: 'primary',
        onclick: (close) => {
          setSplit(order.id, buildSplit(order, mode, { ways }));
          close();
          renderBillView(host, { order: order.id });
          toast('Bill split', 'good');
        },
      },
    ],
  });

  function splitOption(id, title, body, onpick, disabled) {
    return h('button.who__btn', {
      type: 'button',
      disabled,
      'aria-pressed': String(mode === id),
      onclick: (event) => {
        onpick();
        for (const sibling of event.currentTarget.parentElement.children) {
          sibling.setAttribute('aria-pressed', String(sibling === event.currentTarget));
        }
      },
    }, [
      h('span.u-grow', {}, [
        h('span.who__name', { text: title }),
        h('span.who__role', { text: body, style: { whiteSpace: 'normal', lineHeight: '1.45' } }),
      ]),
    ]);
  }
}

function renderSplit(host, order, split) {
  const shares = costSplit(order, split);
  const again = () => renderBillView(host, { order: order.id });

  return h('div.grid', { style: { gap: '9px', marginTop: '12px' } }, [
    caps(`Split ${split.shares.length} ways · ${splitWord(split.mode)}`),
    ...shares.map(({ share, totals }) => {
      const paid = totals.balance <= 0;
      return h(`div.split-share${paid ? '.split-share--paid' : ''}`, {}, [
        h('div.split-share__head', {}, [
          paid ? icon('check', { size: 15 }) : null,
          h('span.split-share__name', { text: share.label }),
          h('span.split-share__total', { text: money(totals.total) }),
        ]),
        h('div.split-share__body', {}, [
          ...(totals.lines || []).map((line) => h('div.split-line', {}, [
            h('span', { text: `${line.qty} × ${line.name}` }),
            split.mode === 'ITEM'
              ? h('button.split-line__move', {
                type: 'button', text: 'Move',
                onclick: () => moveLine(host, order, split, share.id, line.id),
              })
              : null,
          ])),
          paid
            ? null
            : h('button.btn.btn--outline.btn--sm.btn--block', {
              type: 'button',
              text: `Take ${money(totals.balance)} · ${paymentLabel(ui.method)}`,
              onclick: () => {
                addPayment(order.id, {
                  method: ui.method, paise: totals.balance, shareId: share.id,
                  ref: share.label,
                });
                toast(`${share.label} paid`, 'good');
                again();
              },
            }),
        ]),
      ]);
    }),
  ]);
}

const splitWord = (mode) =>
  ({ EQUAL: 'evenly', SEAT: 'by seat', ITEM: 'by item' }[mode] || mode);

function moveLine(host, order, split, fromShareId, lineId) {
  const targets = split.shares.filter((s) => s.id !== fromShareId);
  dialog({
    title: 'Move this line',
    size: 'slim',
    body: h('div.grid', { style: { gap: '8px' } }, targets.map((target) =>
      h('button.btn.btn--outline.btn--block', {
        type: 'button', text: `Move to ${target.label}`,
        onclick: () => {
          const next = structuredClone(split);
          for (const share of next.shares) {
            share.lineIds = share.lineIds.filter((id) => id !== lineId);
          }
          next.shares.find((s) => s.id === target.id).lineIds.push(lineId);
          setSplit(order.id, next);
          document.querySelector('.scrim')?.remove();
          renderBillView(host, { order: order.id });
        },
      }))),
  });
}

/* ---------------------------------------------------------- discount --- */

async function openDiscount(host, order) {
  const totals = costOrder(order);
  let mode = 'PCT';
  let value = 10;

  const input = h('input.input', {
    type: 'number', min: '0', step: '1', value: '10',
    oninput: (event) => { value = Number(event.target.value) || 0; },
  });
  const preview = h('p.setting__hint');

  const paint = () => {
    const amount = mode === 'PCT'
      ? pct(totals.netItems, Math.round(value * 100))
      : Math.min(toPaise(value), totals.netItems);
    preview.textContent = `Takes ${money(amount)} off ${money(totals.netItems)} of food and drink.`
      + (mode === 'PCT' && value > CHARGES.discountApprovalPercent
        ? ` Above ${CHARGES.discountApprovalPercent}% a manager must approve.`
        : '');
  };
  input.addEventListener('input', paint);
  paint();

  dialog({
    title: 'Discount this bill',
    subtitle: 'Applied to food and drink only, before service charge and tax.',
    size: 'slim',
    body: h('div.grid', { style: { gap: '14px' } }, [
      segmented(
        [{ id: 'PCT', label: 'Percentage' }, { id: 'FLAT', label: 'Flat amount' }],
        mode,
        (id) => {
          mode = id;
          input.value = id === 'PCT' ? '10' : '500';
          value = Number(input.value);
          paint();
        }
      ),
      h('div.field', {}, [
        h('label.field__label', { text: mode === 'PCT' ? 'Percent off' : 'Rupees off' }),
        input,
      ]),
      preview,
      h('div.u-row.u-wrap', { style: { gap: '7px' } }, [5, 10, 15, 20, 25].map((percent) =>
        h('button.btn.btn--outline.btn--sm', {
          type: 'button', text: `${percent}%`,
          onclick: () => { mode = 'PCT'; value = percent; input.value = String(percent); paint(); },
        }))),
    ]),
    actions: [
      totals.discount ? {
        label: 'Remove discount',
        onclick: (close) => {
          setDiscount(order.id, { mode: 'NONE', value: 0, reason: '', approvedBy: '' });
          close();
          renderBillView(host, { order: order.id });
        },
      } : { label: 'Cancel', onclick: (close) => close() },
      {
        label: 'Apply', tone: 'primary',
        onclick: async (close) => {
          let approver = session();
          if (mode === 'PCT' && value > CHARGES.discountApprovalPercent) {
            const manager = await authorise({
              title: `${value}% is above the ${CHARGES.discountApprovalPercent}% limit`,
              users: users(),
            });
            if (!manager) return;
            approver = manager;
          }
          const reason = await askReason({
            title: 'Why is this bill discounted?',
            reasons: ['Loyalty / regular guest', 'Set menu pricing', 'Service recovery',
              'Staff or family', 'Promotional offer', 'Manager’s discretion'],
            confirmLabel: 'Apply discount',
            tone: 'primary',
          });
          if (!reason) return;
          setDiscount(order.id, { mode, value, reason, approvedBy: approver.name });
          close();
          renderBillView(host, { order: order.id });
          toast('Discount applied and logged', 'good');
        },
      },
    ],
  });
}

function openTip(host, order, totals) {
  const base = totals.taxable;
  const input = h('input.input', {
    type: 'number', step: '0.01', min: '0',
    value: (totals.tip / 100).toFixed(2),
  });

  dialog({
    title: 'Gratuity',
    subtitle: 'Added after tax — a tip is never taxed.',
    size: 'slim',
    body: h('div.grid', { style: { gap: '14px' } }, [
      h('div.u-row.u-wrap', { style: { gap: '7px' } }, TIP_PRESETS.map((percent) =>
        h('button.btn.btn--outline.btn--sm', {
          type: 'button',
          text: percent ? `${percent}% · ${money(pct(base, percent * 100))}` : 'None',
          onclick: () => { input.value = (pct(base, percent * 100) / 100).toFixed(2); },
        }))),
      h('div.field', {}, [h('label.field__label', { text: 'Amount' }), input]),
    ]),
    actions: [
      { label: 'Cancel', onclick: (close) => close() },
      {
        label: 'Save', tone: 'primary',
        onclick: (close) => {
          setTip(order.id, toPaise(input.value));
          close();
          renderBillView(host, { order: order.id });
        },
      },
    ],
  });
}

/* -------------------------------------------------------------- close --- */

async function closeTable(host, order) {
  if (!order.invoice) {
    const ok = await confirm({
      title: 'No bill has been printed',
      message: 'Close the table anyway? An invoice number will be raised now.',
      confirmLabel: 'Raise and close',
    });
    if (!ok) return;
    raiseInvoice(order.id);
  }
  const closed = settleOrder(order.id);
  toast(`Table ${closed.tableLabel} closed · ${closed.invoice.code}`, 'good');
  navigate('/floor');
}

function renderSettled(host, order, totals) {
  return [
    h('div.due.due--clear', {}, [
      h('span.due__label', { text: 'Settled' }),
      h('span.due__value', { text: money(totals.total) }),
      h('span.due__hint', {
        text: `${clockTime(order.closedAt)} · ${order.payments.map((p) => paymentLabel(p.method)).join(' + ')}`,
      }),
    ]),
    h('div.divider'),
    h('div.grid', { style: { gap: '8px' } }, [
      h('button.btn.btn--outline.btn--block', {
        type: 'button',
        onclick: () => printDocs([renderBill(order, totals, { format: ui.format, copy: 'Duplicate' })]),
      }, [icon('print', { size: 16 }), 'Reprint duplicate']),

      can('reopen') ? h('button.btn.btn--quiet-danger.btn--block', {
        type: 'button',
        onclick: async () => {
          const approver = await authorise({
            title: `Reopen ${order.invoice?.code}?`,
            subtitle: 'The table goes back on the floor and the bill can be changed.',
            users: users(),
          });
          if (!approver) return;
          reopenOrder(order.id, approver.name);
          toast('Bill reopened and logged', 'warn');
          navigate('/bill', { order: order.id });
        },
      }, [icon('refresh', { size: 16 }), 'Reopen this bill']) : null,
    ]),
    h('div.divider'),
    notice(
      `Invoice ${order.invoice?.code} raised by ${order.invoice?.by} at ${clockTime(order.invoice?.at)}. `
      + 'Reprints are marked as duplicates and every reopen is written to the audit log.',
      'info'
    ),
  ];
}
