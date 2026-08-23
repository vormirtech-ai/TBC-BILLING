/** The counter screen. Fast add, live totals, payment in three keystrokes. */

import { el, clear, debounce, formatTime, AppError } from '../core/utils.js';
import { formatMoney, parseRupeesToPaise, formatRate } from '../core/money.js';
import { getSettings } from '../repositories/settings.repo.js';
import { searchMenu, getCategories, getItem, onMenuChange } from '../repositories/menu.repo.js';
import * as cart from '../services/cart.service.js';
import { completeSale } from '../services/order.service.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toast, reportError } from '../ui/toast.js';
import { printReceipt, renderReceipt } from '../ui/receipt.js';
import { refreshDayChip } from '../ui/shell.js';
import { PAYMENT_METHODS, TABLE_STATUS } from '../config/app.config.js';
import { isAdmin } from '../core/session.js';
import * as tablesRepo from '../repositories/tables.repo.js';
import { checkAvailability } from '../repositories/inventory.repo.js';
import { formatQuantityWithUnit } from '../core/quantity.js';
import { navigate } from '../core/router.js';

export function renderPos({ outlet }) {
  const settings = getSettings();
  const symbol = settings.currencySymbol || '₹';

  const state = { query: '', category: 'All', availableOnly: true };

  /* ------------------------------------------------------------ menu --- */

  const search = el('input.input.search__input', {
    type: 'search',
    placeholder: 'Search the menu…  (press / )',
    'aria-label': 'Search the menu',
    autocomplete: 'off',
  });

  const chips = el('div.chips', { role: 'tablist', 'aria-label': 'Categories' });
  const grid = el('div.grid', { role: 'list' });
  const resultNote = el('p.grid__note');

  function paintChips() {
    clear(chips);
    const categories = ['All', ...getCategories()];
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
            paintGrid();
          },
        })
      );
    }
  }

  function paintGrid() {
    const items = searchMenu(state);
    clear(grid);

    if (!items.length) {
      grid.appendChild(
        el('div.empty', {}, [
          el('p', {
            text: state.query
              ? `Nothing on the menu matches “${state.query}”.`
              : 'No items in this category yet.',
          }),
          isAdmin()
            ? el('a.btn.btn--ghost.btn--sm', { href: '#/menu', text: 'Open menu management' })
            : null,
        ])
      );
      resultNote.textContent = '';
      return;
    }

    for (const item of items) {
      const inCart = cart.quantityOf(item.id);
      grid.appendChild(
        el(
          'button.card',
          {
            type: 'button',
            role: 'listitem',
            disabled: !item.available,
            'data-id': item.id,
            title: item.description || item.name,
            onclick: () => add(item.id),
          },
          [
            inCart ? el('span.card__badge', { text: `×${inCart}` }) : null,
            el('span.card__cat', { text: item.category }),
            el('span.card__name', { text: item.name }),
            el('span.card__price', { text: formatMoney(item.price, symbol) }),
            !item.available ? el('span.card__flag', { text: 'Unavailable' }) : null,
          ]
        )
      );
    }
    resultNote.textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;
  }

  function add(itemId) {
    try {
      const item = getItem(itemId);
      cart.addItem(item);
    } catch (error) {
      reportError(error);
    }
  }

  search.addEventListener(
    'input',
    debounce(() => {
      state.query = search.value.trim();
      paintGrid();
    }, 120)
  );

  search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      search.value = '';
      state.query = '';
      paintGrid();
    }
    if (event.key === 'Enter') {
      const first = searchMenu(state).find((item) => item.available);
      if (first) {
        add(first.id);
        search.select();
      }
    }
  });

  /* ------------------------------------------------------------ cart --- */

  const cartList = el('div.cart__list');
  const cartTotals = el('div.cart__totals');
  const cartCount = el('span.cart__count');
  const payButton = el('button.btn.btn--pay', {
    type: 'button',
    onclick: openPayment,
  });

  const tableButton = el('button.btn.btn--ghost.btn--sm.btn--block', {
    type: 'button',
    onclick: openTablePicker,
  });

  /**
   * Seat this order at a table. Useful on its own for table service, and it is
   * what an order arriving from a QR code sets automatically.
   */
  function openTablePicker() {
    const tables = tablesRepo.getTables({ activeOnly: true });
    const current = cart.getCart().tableId;

    if (!tables.length) {
      toast.info('No tables set up yet. Add them on the Tables screen.');
      return;
    }

    const modal = openModal({
      title: 'Which table?',
      size: 'sm',
      body: el('div.tablepicker', {}, [
        el('button.tablepicker__option', {
          type: 'button',
          class: current ? '' : 'is-active',
          text: 'No table · counter order',
          onclick: () => {
            cart.setTable(null);
            modal.close();
          },
        }),
        ...tables.map((table) =>
          el('button.tablepicker__option', {
            type: 'button',
            class: table.id === current ? 'is-active' : '',
            onclick: async () => {
              cart.setTable(table);
              // Marking it seated keeps the floor view honest while the order
              // is being rung up.
              if ((table.status || TABLE_STATUS.FREE) === TABLE_STATUS.FREE) {
                await tablesRepo.setStatus(table.id, TABLE_STATUS.SEATED).catch(() => {});
              }
              modal.close();
            },
          }, [
            el('span.tablepicker__name', { text: table.name }),
            el('span.tablepicker__meta', { text: `${table.zone || 'Main'} · ${table.seats || 0} seats` }),
          ])
        ),
      ]),
    });
  }

  const customerInput = el('input.input.input--sm', {
    type: 'text',
    placeholder: 'Customer name (optional)',
    'aria-label': 'Customer name',
    maxlength: 60,
    oninput: (event) => cart.setCustomerName(event.target.value),
  });

  function qtyButton(label, ariaLabel, handler) {
    return el('button.qty__btn', { type: 'button', text: label, 'aria-label': ariaLabel, onclick: handler });
  }

  function paintCart(snapshot) {
    const lines = snapshot.lines;
    clear(cartList);

    if (!lines.length) {
      cartList.appendChild(
        el('div.cart__empty', {}, [
          el('p.cart__emptytitle', { text: 'No items yet' }),
          el('p.cart__emptytext', { text: 'Tap a drink to start the order.' }),
        ])
      );
    } else {
      for (const line of lines) {
        cartList.appendChild(
          el('div.cart__row', {}, [
            el('div.cart__rowmain', {}, [
              el('span.cart__name', { text: line.name }),
              el('span.cart__unit', {
                text: `${formatMoney(line.unitPrice, symbol)} each`,
              }),
            ]),
            el('div.qty', {}, [
              qtyButton('−', `Reduce ${line.name}`, () => guard(() => cart.increment(line.lineId, -1))),
              el('input.qty__input', {
                type: 'text',
                inputmode: 'numeric',
                value: String(line.quantity),
                'aria-label': `Quantity of ${line.name}`,
                onchange: (event) =>
                  guard(() => cart.setQuantity(line.lineId, Number(event.target.value))),
              }),
              qtyButton('+', `Add another ${line.name}`, () => guard(() => cart.increment(line.lineId, 1))),
            ]),
            el('span.cart__amount', { text: formatMoney(line.total, symbol) }),
            el('button.cart__remove', {
              type: 'button',
              text: '×',
              'aria-label': `Remove ${line.name}`,
              onclick: () => guard(() => cart.removeLine(line.lineId)),
            }),
          ])
        );
      }
    }

    // ---- totals ----
    clear(cartTotals);
    const rows = [['Subtotal', formatMoney(snapshot.subtotal, symbol)]];
    if (snapshot.discountAmount) {
      rows.push([
        `Discount${snapshot.discountType === 'PERCENT' ? ` ${formatRate(snapshot.discountValue)}` : ''}`,
        `−${formatMoney(snapshot.discountAmount, symbol)}`,
      ]);
    }
    if (snapshot.taxAmount) {
      rows.push([
        `${snapshot.taxLabel}${snapshot.taxInclusive ? ' (incl.)' : ''}`,
        formatMoney(snapshot.taxAmount, symbol),
      ]);
    }
    if (snapshot.roundOff) rows.push(['Round off', formatMoney(snapshot.roundOff, symbol)]);

    for (const [label, value] of rows) {
      cartTotals.appendChild(
        el('div.totals__row', {}, [el('span', { text: label }), el('span', { text: value })])
      );
    }
    cartTotals.appendChild(
      el('div.totals__row.totals__row--grand', {}, [
        el('span', { text: 'Total' }),
        el('span.totals__grand', { text: formatMoney(snapshot.grandTotal, symbol) }),
      ])
    );

    cartCount.textContent = snapshot.itemCount
      ? `${snapshot.itemCount} item${snapshot.itemCount === 1 ? '' : 's'}`
      : '';
    payButton.textContent = snapshot.lines.length
      ? `Take payment · ${formatMoney(snapshot.grandTotal, symbol)}`
      : 'Take payment';
    payButton.disabled = !snapshot.lines.length;

    if (customerInput.value !== snapshot.customerName) customerInput.value = snapshot.customerName;

    tableButton.textContent = snapshot.tableName
      ? `Table: ${snapshot.tableName}`
      : 'Assign a table';
    tableButton.classList.toggle('is-active', Boolean(snapshot.tableId));

    paintGrid();
  }

  function guard(action) {
    try {
      action();
    } catch (error) {
      reportError(error);
    }
  }

  const canDiscount = isAdmin() || settings.cashierCanApplyDiscount;

  const cartPanel = el('aside.cart', { 'aria-label': 'Current order' }, [
    el('header.cart__head', {}, [
      el('div', {}, [el('h2.cart__title', { text: 'Current order' }), cartCount]),
      el('button.btn.btn--ghost.btn--sm', {
        type: 'button',
        text: 'Clear',
        onclick: async () => {
          if (cart.isEmpty()) return;
          const ok = await confirmDialog({
            title: 'Clear this order?',
            message: 'Every item at the counter will be removed. Nothing is saved to the day’s sales.',
            confirmLabel: 'Clear order',
            tone: 'danger',
          });
          if (ok) cart.clearCart();
        },
      }),
    ]),
    cartList,
    el('div.cart__foot', {}, [
      tableButton,
      customerInput,
      canDiscount
        ? el('button.btn.btn--ghost.btn--sm.btn--block', {
            type: 'button',
            text: 'Apply discount',
            onclick: openDiscount,
            disabled: !settings.discountEnabled,
          })
        : null,
      cartTotals,
      payButton,
    ]),
  ]);

  /* -------------------------------------------------------- discount --- */

  function openDiscount() {
    if (!settings.discountEnabled) {
      toast.info('Discounts are switched off in Settings.');
      return;
    }
    const snapshot = cart.getCart();
    if (!snapshot.lines.length) {
      toast.info('Add items before applying a discount.');
      return;
    }

    const type = el('select.input', {}, [
      el('option', { value: 'PERCENT', text: 'Percentage' }),
      el('option', { value: 'FLAT', text: `Flat amount (${symbol})` }),
    ]);
    type.value = snapshot.discountType;

    const value = el('input.input', {
      type: 'text',
      inputmode: 'decimal',
      placeholder: '0',
      value:
        snapshot.discountValue === 0
          ? ''
          : snapshot.discountType === 'PERCENT'
          ? String(snapshot.discountValue / 100)
          : String(snapshot.discountValue / 100),
    });

    const modal = openModal({
      title: 'Apply a discount',
      subtitle: `Order subtotal ${formatMoney(snapshot.subtotal, symbol)}`,
      size: 'sm',
      body: el('div.stack', {}, [
        el('label.field', {}, [el('span.field__label', { text: 'Type' }), type]),
        el('label.field', {}, [el('span.field__label', { text: 'Value' }), value]),
        el('p.hint', { text: `Maximum ${settings.maxDiscountPercent}% of the subtotal.` }),
      ]),
      actions: [
        el('button.btn.btn--ghost', {
          type: 'button',
          text: 'Remove discount',
          onclick: () => {
            cart.clearDiscount();
            modal.close();
          },
        }),
        el('button.btn.btn--primary', {
          type: 'button',
          text: 'Apply',
          onclick: () => {
            try {
              if (type.value === 'FLAT') {
                const paise = parseRupeesToPaise(value.value);
                if (paise === null) throw new Error('bad');
                cart.setDiscount('FLAT', paise);
              } else {
                const percent = Number(value.value);
                if (!Number.isFinite(percent) || percent < 0) throw new Error('bad');
                cart.setDiscount('PERCENT', Math.round(percent * 100));
              }
              modal.close();
            } catch (error) {
              if (error?.name === 'AppError') reportError(error);
              else toast.error('Enter a valid discount, for example 10 or 10.5.');
            }
          },
        }),
      ],
    });
  }

  /* --------------------------------------------------------- payment --- */

  function openPayment() {
    const snapshot = cart.getCart();
    if (!snapshot.lines.length) {
      toast.warn('Add at least one item before taking payment.');
      return;
    }

    let method = 'CASH';
    const methodButtons = el('div.methods', { role: 'radiogroup', 'aria-label': 'Payment method' });
    const tendered = el('input.input.input--lg', {
      type: 'text',
      inputmode: 'decimal',
      placeholder: formatMoney(snapshot.grandTotal, symbol).replace(symbol, ''),
      'aria-label': 'Cash received',
    });
    const changeNote = el('p.pay__change');
    const cashBlock = el('div.pay__cash', {}, [
      el('label.field', {}, [el('span.field__label', { text: 'Cash received' }), tendered]),
      el('div.quickcash'),
      changeNote,
    ]);

    function paintQuickCash() {
      const holder = cashBlock.querySelector('.quickcash');
      clear(holder);
      const total = snapshot.grandTotal;
      const options = new Set([total, Math.ceil(total / 10000) * 10000, Math.ceil(total / 50000) * 50000]);
      options.add(Math.ceil(total / 100000) * 100000);
      for (const amount of [...options].filter((a) => a >= total).slice(0, 4)) {
        holder.appendChild(
          el('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            text: formatMoney(amount, symbol),
            onclick: () => {
              tendered.value = String(amount / 100);
              paintChange();
            },
          })
        );
      }
    }

    function paintChange() {
      const paise = parseRupeesToPaise(tendered.value);
      if (paise === null) {
        changeNote.textContent = '';
        changeNote.className = 'pay__change';
        return;
      }
      const change = paise - snapshot.grandTotal;
      if (change < 0) {
        changeNote.textContent = `Short by ${formatMoney(-change, symbol)}`;
        changeNote.className = 'pay__change is-short';
      } else {
        changeNote.textContent = `Change ${formatMoney(change, symbol)}`;
        changeNote.className = 'pay__change is-ok';
      }
    }

    tendered.addEventListener('input', paintChange);

    function paintMethods() {
      clear(methodButtons);
      for (const entry of PAYMENT_METHODS) {
        methodButtons.appendChild(
          el('button.method', {
            type: 'button',
            role: 'radio',
            'aria-checked': method === entry.id ? 'true' : 'false',
            class: method === entry.id ? 'is-active' : '',
            text: entry.label,
            onclick: () => {
              method = entry.id;
              paintMethods();
              cashBlock.hidden = method !== 'CASH';
              if (method === 'CASH') requestAnimationFrame(() => tendered.focus());
            },
          })
        );
      }
    }
    paintMethods();
    paintQuickCash();
    cashBlock.hidden = false;

    const summary = el('div.pay__summary', {}, [
      ...snapshot.lines.map((line) =>
        el('div.pay__line', {}, [
          el('span', { text: `${line.quantity} × ${line.name}` }),
          el('span', { text: formatMoney(line.total, symbol) }),
        ])
      ),
      el('div.pay__rule'),
      el('div.pay__line', {}, [
        el('span', { text: 'Subtotal' }),
        el('span', { text: formatMoney(snapshot.subtotal, symbol) }),
      ]),
      snapshot.discountAmount
        ? el('div.pay__line', {}, [
            el('span', { text: 'Discount' }),
            el('span', { text: `−${formatMoney(snapshot.discountAmount, symbol)}` }),
          ])
        : null,
      snapshot.taxAmount
        ? el('div.pay__line', {}, [
            el('span', { text: snapshot.taxLabel }),
            el('span', { text: formatMoney(snapshot.taxAmount, symbol) }),
          ])
        : null,
      snapshot.roundOff
        ? el('div.pay__line', {}, [
            el('span', { text: 'Round off' }),
            el('span', { text: formatMoney(snapshot.roundOff, symbol) }),
          ])
        : null,
      el('div.pay__line.pay__line--total', {}, [
        el('span', { text: 'Amount due' }),
        el('span', { text: formatMoney(snapshot.grandTotal, symbol) }),
      ]),
    ]);

    const confirm = el('button.btn.btn--primary', { type: 'button', text: 'Confirm payment' });

    const modal = openModal({
      title: 'Confirm payment',
      subtitle: `${snapshot.itemCount} item${snapshot.itemCount === 1 ? '' : 's'} · ${
        snapshot.lines.length
      } line${snapshot.lines.length === 1 ? '' : 's'}${
        snapshot.tableName ? ` · ${snapshot.tableName}` : ''
      }`,
      body: el('div.pay', {}, [
        summary,
        el('div.field', {}, [el('span.field__label', { text: 'Payment method' }), methodButtons]),
        cashBlock,
      ]),
      actions: [
        el('button.btn.btn--ghost', { type: 'button', text: 'Back', onclick: () => modal.close() }),
        confirm,
      ],
    });

    confirm.addEventListener('click', async () => {
      confirm.disabled = true;
      confirm.textContent = 'Saving…';
      try {
        // Warn about a shelf that will not cover this order. A customer is
        // standing at the counter, so this informs rather than blocks unless
        // the cafe has explicitly asked for it to block.
        if (settings.stockTrackingEnabled) {
          const shortages = await checkAvailability(snapshot.lines);
          if (shortages.length) {
            const detail = shortages
              .map((row) => `${row.name}: ${formatQuantityWithUnit(row.have, row.unit)} left`)
              .join(', ');

            if (settings.blockSalesWhenOutOfStock) {
              throw new AppError(`Not enough stock — ${detail}.`, 'OUT_OF_STOCK');
            }
            toast.warn(`Running short — ${detail}. The sale went through.`);
          }
        }

        const paise = parseRupeesToPaise(tendered.value);
        const saved = await completeSale({
          paymentMethod: method,
          amountTendered: method === 'CASH' ? paise : null,
        });
        modal.close();
        refreshDayChip(document);

        for (const shortage of saved.stockShortages || []) {
          toast.warn(`${shortage.name} has run out — the shelf is now showing zero.`);
        }
        showSuccess(saved);
      } catch (error) {
        reportError(error, 'The bill was not saved. Nothing has been charged.');
        confirm.disabled = false;
        confirm.textContent = 'Confirm payment';
      }
    });
  }

  /* --------------------------------------------------------- success --- */

  function showSuccess(txn) {
    const modal = openModal({
      title: 'Payment recorded',
      subtitle: `${txn.orderNo} · ${formatTime(txn.createdAt)}`,
      size: 'sm',
      body: el('div.success', {}, [
        el('div.success__amount', { text: formatMoney(txn.grandTotal, txn.currency) }),
        txn.changeDue
          ? el('div.success__change', { text: `Return ${formatMoney(txn.changeDue, txn.currency)}` })
          : null,
        el('p.success__note', {
          text: 'Saved to today’s sales on this device.',
        }),
        el('details.success__preview', {}, [
          el('summary', { text: 'View bill' }),
          renderReceipt({ ...txn, receiptFooter: settings.receiptFooter }),
        ]),
      ]),
      actions: [
        el('button.btn.btn--ghost', {
          type: 'button',
          text: 'Print bill',
          onclick: () => printReceipt(txn, settings),
        }),
        el('button.btn.btn--primary', {
          type: 'button',
          text: 'New order',
          onclick: () => modal.close(),
        }),
      ],
    });
  }

  /* --------------------------------------------------------- assembly --- */

  const layout = el('div.pos', {}, [
    el('section.pos__menu', {}, [
      el('div.pos__toolbar', {}, [
        el('div.search', {}, [search]),
        settings.qrOrderingEnabled
          ? el('button.btn.btn--ghost.btn--sm', {
              type: 'button',
              text: 'QR orders',
              title: 'Orders sent in from table QR codes',
              onclick: () => navigate('/orders'),
            })
          : null,
        el('label.toggle', {}, [
          el('input', {
            type: 'checkbox',
            checked: state.availableOnly,
            onchange: (event) => {
              state.availableOnly = event.target.checked;
              paintGrid();
            },
          }),
          el('span', { text: 'Available only' }),
        ]),
      ]),
      chips,
      resultNote,
      grid,
    ]),
    cartPanel,
  ]);

  clear(outlet).appendChild(layout);

  paintChips();
  paintCart(cart.getCart());

  const unsubscribeCart = cart.onCartChange(paintCart);
  const unsubscribeMenu = onMenuChange(() => {
    paintChips();
    paintGrid();
  });

  function onKeyDown(event) {
    if (event.target.matches('input, textarea, select')) return;
    if (event.key === '/') {
      event.preventDefault();
      search.focus();
      search.select();
    }
    if (event.key === 'F2' && !cart.isEmpty()) {
      event.preventDefault();
      openPayment();
    }
  }
  document.addEventListener('keydown', onKeyDown);

  return () => {
    unsubscribeCart();
    unsubscribeMenu();
    document.removeEventListener('keydown', onKeyDown);
  };
}
