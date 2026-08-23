/**
 * Stock: what is on the shelf, what it is worth, and what is running out.
 *
 * The screen is arranged around the three questions a cafe manager actually
 * asks — what do I need to order, where did it go, and what does a drink cost
 * me to make. Recipes answer the third: linking a menu item to its ingredients
 * is what lets a sale draw stock down by itself.
 */

import { el, clear, formatDateTime } from '../core/utils.js';
import { formatMoney, parseRupeesToPaise, formatAmount } from '../core/money.js';
import { formatQuantity, formatQuantityWithUnit, parseQuantity } from '../core/quantity.js';
import { STOCK_UNITS, STOCK_MOVEMENT_KINDS } from '../config/app.config.js';
import { getSettings } from '../repositories/settings.repo.js';
import * as inventoryRepo from '../repositories/inventory.repo.js';
import { getMenu } from '../repositories/menu.repo.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toast, reportError } from '../ui/toast.js';

const MOVEMENT_LABELS = {
  [STOCK_MOVEMENT_KINDS.OPENING]: 'Opening count',
  [STOCK_MOVEMENT_KINDS.RECEIVED]: 'Delivery',
  [STOCK_MOVEMENT_KINDS.SALE]: 'Sold',
  [STOCK_MOVEMENT_KINDS.SALE_REVERSAL]: 'Bill voided',
  [STOCK_MOVEMENT_KINDS.WASTAGE]: 'Wastage',
  [STOCK_MOVEMENT_KINDS.CORRECTION]: 'Recount',
};

export async function renderInventory({ outlet }) {
  const settings = getSettings();
  const symbol = settings.currencySymbol || '₹';
  const state = { query: '', category: 'All', lowOnly: false };

  await inventoryRepo.loadInventory();

  const stats = el('section.stats');
  const filters = el('div.filters.filters--inline');
  const table = el('div.stack');
  const recipePanel = el('div.stack');

  /* --------------------------------------------------------- item form --- */

  function itemForm(item = null) {
    const name = el('input.input', { type: 'text', value: item?.name || '', maxlength: 80 });
    const category = el('input.input', {
      type: 'text',
      value: item?.category || 'General',
      placeholder: 'Coffee, Dairy, Packaging…',
    });

    const unit = el(
      'select.input',
      {},
      STOCK_UNITS.map((entry) => el('option', { value: entry.id, text: `${entry.label} (${entry.id})` }))
    );
    unit.value = item?.unit || 'g';
    // Changing the unit of stock that already has a level would silently
    // reinterpret the number on the shelf.
    if (item) unit.disabled = true;

    const quantity = el('input.input', {
      type: 'text',
      inputmode: 'decimal',
      value: item ? formatQuantity(item.quantity) : '0',
    });
    if (item) quantity.disabled = true;

    const lowStockLevel = el('input.input', {
      type: 'text',
      inputmode: 'decimal',
      value: item ? formatQuantity(item.lowStockLevel) : '0',
    });
    const costPerUnit = el('input.input', {
      type: 'text',
      inputmode: 'decimal',
      value: item ? formatAmount(item.costPerUnit) : '',
      placeholder: '0.00',
    });
    const supplier = el('input.input', { type: 'text', value: item?.supplier || '' });

    const modal = openModal({
      title: item ? `Edit ${item.name}` : 'Add a stock item',
      body: el('div.formgrid', {}, [
        el('label.field', {}, [el('span.field__label', { text: 'Name' }), name]),
        el('label.field', {}, [el('span.field__label', { text: 'Category' }), category]),
        el('label.field', {}, [
          el('span.field__label', { text: 'Unit' }),
          unit,
          item ? el('span.hint', { text: 'The unit cannot change once stock has been counted.' }) : null,
        ]),
        el('label.field', {}, [
          el('span.field__label', { text: item ? 'On the shelf' : 'Opening count' }),
          quantity,
          item ? el('span.hint', { text: 'Use Receive, Wastage or Recount to move this.' }) : null,
        ]),
        el('label.field', {}, [
          el('span.field__label', { text: 'Tell me when it drops to' }),
          lowStockLevel,
          el('span.hint', { text: 'Zero switches the reminder off.' }),
        ]),
        el('label.field', {}, [
          el('span.field__label', { text: `Cost per unit (${symbol})` }),
          costPerUnit,
        ]),
        el('label.field', {}, [el('span.field__label', { text: 'Supplier' }), supplier]),
      ]),
      actions: [
        el('button.btn.btn--ghost', { type: 'button', text: 'Cancel', onclick: () => modal.close() }),
        el('button.btn.btn--primary', {
          type: 'button',
          text: item ? 'Save item' : 'Add item',
          onclick: async (event) => {
            const button = event.currentTarget;
            const opening = parseQuantity(quantity.value || '0');
            const low = parseQuantity(lowStockLevel.value || '0');
            const cost = parseRupeesToPaise(costPerUnit.value || '0');

            if (opening === null || low === null) {
              toast.error('Enter quantities as numbers, for example 250 or 1.5.');
              return;
            }
            if (cost === null) {
              toast.error('Enter a cost like 450 or 450.50, or leave it blank.');
              return;
            }

            button.disabled = true;
            try {
              const draft = {
                name: name.value,
                category: category.value,
                unit: unit.value,
                quantity: opening,
                lowStockLevel: low,
                costPerUnit: cost,
                supplier: supplier.value,
              };
              if (item) await inventoryRepo.updateStockItem(item.id, draft);
              else await inventoryRepo.createStockItem(draft);

              toast.success(item ? 'Stock item saved.' : 'Stock item added.');
              modal.close();
              paint();
            } catch (error) {
              reportError(error);
              button.disabled = false;
            }
          },
        }),
      ],
    });
  }

  /* ------------------------------------------------------ stock movement --- */

  function movementForm(item, kind) {
    const isRecount = kind === STOCK_MOVEMENT_KINDS.CORRECTION;
    const titles = {
      [STOCK_MOVEMENT_KINDS.RECEIVED]: `Delivery of ${item.name}`,
      [STOCK_MOVEMENT_KINDS.WASTAGE]: `Write off ${item.name}`,
      [STOCK_MOVEMENT_KINDS.CORRECTION]: `Recount ${item.name}`,
    };

    const amount = el('input.input.input--lg', { type: 'text', inputmode: 'decimal', placeholder: '0' });
    const note = el('input.input', {
      type: 'text',
      maxlength: 160,
      placeholder: isRecount ? 'Weekly stocktake' : 'Optional note',
    });

    const modal = openModal({
      title: titles[kind] || `Adjust ${item.name}`,
      subtitle: `On the shelf now: ${formatQuantityWithUnit(item.quantity, item.unit)}`,
      size: 'sm',
      body: el('div.stack', {}, [
        el('label.field', {}, [
          el('span.field__label', {
            text: isRecount ? `Counted (${item.unit})` : `Amount (${item.unit})`,
          }),
          amount,
        ]),
        el('label.field', {}, [el('span.field__label', { text: 'Note' }), note]),
      ]),
      actions: [
        el('button.btn.btn--ghost', { type: 'button', text: 'Cancel', onclick: () => modal.close() }),
        el('button.btn.btn--primary', {
          type: 'button',
          text: isRecount ? 'Set the level' : 'Record it',
          onclick: async (event) => {
            const value = parseQuantity(amount.value);
            if (value === null || (!isRecount && value === 0)) {
              toast.error('Enter an amount, for example 250 or 1.5.');
              return;
            }
            const button = event.currentTarget;
            button.disabled = true;
            try {
              if (isRecount) {
                await inventoryRepo.recountStock(item.id, value, note.value || 'Recount');
              } else {
                const change = kind === STOCK_MOVEMENT_KINDS.WASTAGE ? -value : value;
                await inventoryRepo.adjustStock(item.id, change, { kind, note: note.value });
              }
              toast.success(`${item.name} updated.`);
              modal.close();
              paint();
            } catch (error) {
              reportError(error);
              button.disabled = false;
            }
          },
        }),
      ],
    });
    requestAnimationFrame(() => amount.focus());
  }

  async function showHistory(item) {
    const movements = await inventoryRepo.movementsFor(item.id, 60);

    openModal({
      title: `${item.name} · movements`,
      subtitle: `On the shelf now: ${formatQuantityWithUnit(item.quantity, item.unit)}`,
      body: movements.length
        ? el('div.table', {}, [
            el('div.table__head.table__head--movements', {}, [
              el('span', { text: 'When' }),
              el('span', { text: 'What' }),
              el('span.table__num', { text: 'Change' }),
              el('span.table__num', { text: 'Left' }),
              el('span', { text: 'Note' }),
            ]),
            ...movements.map((row) =>
              el('div.table__row.table__row--movements', {}, [
                el('span', { text: formatDateTime(row.at) }),
                el('span', { text: MOVEMENT_LABELS[row.kind] || row.kind }),
                el('span.table__num', {
                  text: `${row.change > 0 ? '+' : ''}${formatQuantity(row.change)}`,
                  class: row.change < 0 ? 'is-negative' : 'is-positive',
                }),
                el('span.table__num', { text: formatQuantity(row.balanceAfter) }),
                el('span.hint', { text: row.note || row.reference || '' }),
              ])
            ),
          ])
        : el('p.empty', { text: 'Nothing has moved yet.' }),
    });
  }

  /* ------------------------------------------------------------ recipes --- */

  function recipeForm(menuItem, recipe) {
    const rows = el('div.stack');
    const draft = recipe ? recipe.items.map((line) => ({ ...line })) : [];

    function paintRows() {
      clear(rows);
      if (!draft.length) {
        rows.appendChild(
          el('p.hint', { text: 'No ingredients yet. Selling this item will not move any stock.' })
        );
      }

      draft.forEach((line, index) => {
        const stockItem = inventoryRepo.getStockItem(line.stockId);
        const select = el(
          'select.input',
          {
            onchange: (event) => {
              draft[index].stockId = event.target.value;
              paintRows();
            },
          },
          inventoryRepo
            .getInventory()
            .map((entry) => el('option', { value: entry.id, text: `${entry.name} (${entry.unit})` }))
        );
        select.value = line.stockId;

        const quantity = el('input.input.input--sm', {
          type: 'text',
          inputmode: 'decimal',
          value: formatQuantity(line.quantity),
          'aria-label': 'Amount used per portion',
          onchange: (event) => {
            const value = parseQuantity(event.target.value);
            if (value === null) {
              toast.error('Enter an amount like 18 or 0.15.');
              event.target.value = formatQuantity(draft[index].quantity);
              return;
            }
            draft[index].quantity = value;
          },
        });

        rows.appendChild(
          el('div.recipe__row', {}, [
            select,
            quantity,
            el('span.recipe__unit', { text: stockItem?.unit || '' }),
            el('button.icon-btn.icon-btn--danger', {
              type: 'button',
              text: '×',
              'aria-label': 'Remove this ingredient',
              onclick: () => {
                draft.splice(index, 1);
                paintRows();
              },
            }),
          ])
        );
      });
    }
    paintRows();

    const modal = openModal({
      title: `Recipe for ${menuItem.name}`,
      subtitle: 'What one portion uses. Selling it takes this off the shelf automatically.',
      body: el('div.stack', {}, [
        rows,
        el('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          text: 'Add an ingredient',
          disabled: !inventoryRepo.getInventory().length,
          onclick: () => {
            const first = inventoryRepo.getInventory()[0];
            if (!first) return;
            draft.push({ stockId: first.id, quantity: 0 });
            paintRows();
          },
        }),
        inventoryRepo.getInventory().length
          ? null
          : el('p.hint', { text: 'Add some stock items first and they will appear here.' }),
      ]),
      actions: [
        el('button.btn.btn--ghost', { type: 'button', text: 'Cancel', onclick: () => modal.close() }),
        el('button.btn.btn--primary', {
          type: 'button',
          text: 'Save recipe',
          onclick: async (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            try {
              await inventoryRepo.saveRecipe(menuItem.id, draft);
              toast.success(`Recipe saved for ${menuItem.name}.`);
              modal.close();
              paintRecipes();
            } catch (error) {
              reportError(error);
              button.disabled = false;
            }
          },
        }),
      ],
    });
  }

  async function paintRecipes() {
    const recipes = await inventoryRepo.listRecipes();
    const byItem = new Map(recipes.map((recipe) => [recipe.menuItemId, recipe]));
    const menu = getMenu();

    clear(recipePanel).append(
      el('div.table', {}, [
        el('div.table__head.table__head--recipes', {}, [
          el('span', { text: 'Menu item' }),
          el('span', { text: 'Ingredients' }),
          el('span.table__num', { text: 'Cost' }),
          el('span.table__num', { text: 'Price' }),
          el('span.table__num', { text: 'Margin' }),
          el('span', { text: '' }),
        ]),
        ...menu.map((menuItem) => {
          const recipe = byItem.get(menuItem.id);
          const cost = inventoryRepo.recipeCost(recipe);
          const margin = menuItem.price - cost;
          const marginPercent = menuItem.price ? Math.round((margin / menuItem.price) * 100) : 0;

          return el('div.table__row.table__row--recipes', {}, [
            el('span', {}, [
              el('strong', { text: menuItem.name }),
              el('span.hint', { text: menuItem.category }),
            ]),
            el('span.hint', {
              text: recipe
                ? recipe.items
                    .map((line) => {
                      const stockItem = inventoryRepo.getStockItem(line.stockId);
                      return stockItem
                        ? `${formatQuantity(line.quantity)}${stockItem.unit} ${stockItem.name}`
                        : 'missing item';
                    })
                    .join(', ')
                : 'No recipe — sales move no stock',
            }),
            el('span.table__num', { text: cost ? formatMoney(cost, symbol) : '—' }),
            el('span.table__num', { text: formatMoney(menuItem.price, symbol) }),
            el('span.table__num', {
              text: cost ? `${marginPercent}%` : '—',
              class: cost && marginPercent < 0 ? 'is-negative' : '',
            }),
            el('span.table__actions', {}, [
              el('button.btn.btn--ghost.btn--sm', {
                type: 'button',
                text: recipe ? 'Edit' : 'Add',
                onclick: () => recipeForm(menuItem, recipe),
              }),
            ]),
          ]);
        }),
      ])
    );
  }

  /* -------------------------------------------------------------- paint --- */

  function paintStats() {
    const items = inventoryRepo.getInventory();
    const low = inventoryRepo.lowStockItems();

    clear(stats).append(
      el('div.stat', {}, [
        el('span.stat__label', { text: 'Stock items' }),
        el('span.stat__value', { text: String(items.length) }),
        el('span.stat__sub', { text: `${inventoryRepo.getStockCategories().length} categories` }),
      ]),
      el('div.stat', { class: low.length ? 'is-alert' : '' }, [
        el('span.stat__label', { text: 'Need ordering' }),
        el('span.stat__value', { text: String(low.length) }),
        el('span.stat__sub', {
          text: low.length ? low.slice(0, 3).map((item) => item.name).join(', ') : 'Nothing running low',
        }),
      ]),
      el('div.stat', {}, [
        el('span.stat__label', { text: 'Value on the shelf' }),
        el('span.stat__value', { text: formatMoney(inventoryRepo.stockValue(), symbol) }),
        el('span.stat__sub', { text: 'At cost price' }),
      ]),
      el('div.stat', {}, [
        el('span.stat__label', { text: 'Deducting from sales' }),
        el('span.stat__value', { text: settings.stockTrackingEnabled ? 'On' : 'Off' }),
        el('span.stat__sub', { text: 'Set in Settings → Stock' }),
      ])
    );
  }

  function paintFilters() {
    clear(filters);
    const categories = ['All', ...inventoryRepo.getStockCategories()];

    const search = el('input.input.input--sm', {
      type: 'search',
      placeholder: 'Find stock…',
      value: state.query,
      oninput: (event) => {
        state.query = event.target.value.trim();
        paintTable();
      },
    });

    const categorySelect = el(
      'select.input.input--sm',
      { onchange: (event) => ((state.category = event.target.value), paintTable()) },
      categories.map((category) =>
        el('option', { value: category, text: category === 'All' ? 'All categories' : category })
      )
    );
    categorySelect.value = state.category;

    const lowToggle = el('label.toggle', {}, [
      el('input', {
        type: 'checkbox',
        checked: state.lowOnly,
        onchange: (event) => {
          state.lowOnly = event.target.checked;
          paintTable();
        },
      }),
      el('span', { text: 'Only what needs ordering' }),
    ]);

    filters.append(search, categorySelect, lowToggle);
  }

  function paintTable() {
    const items = inventoryRepo.searchInventory(state);
    clear(table);

    if (!items.length) {
      table.appendChild(
        el('div.empty', {}, [
          el('p', {
            text: inventoryRepo.getInventory().length
              ? 'Nothing matches those filters.'
              : 'No stock items yet. Add what you buy in — beans, milk, cups — and link them to menu items with a recipe.',
          }),
        ])
      );
      return;
    }

    table.appendChild(
      el('div.table', {}, [
        el('div.table__head.table__head--stock', {}, [
          el('span', { text: 'Item' }),
          el('span.table__num', { text: 'On the shelf' }),
          el('span.table__num', { text: 'Reorder at' }),
          el('span.table__num', { text: 'Value' }),
          el('span', { text: '' }),
        ]),
        ...items.map((item) => {
          const low = inventoryRepo.isLow(item);
          return el('div.table__row.table__row--stock', { class: low ? 'is-low' : '' }, [
            el('span', {}, [
              el('strong', { text: item.name }),
              el('span.hint', {
                text: `${item.category}${item.supplier ? ` · ${item.supplier}` : ''}`,
              }),
            ]),
            el('span.table__num', {}, [
              el('strong', { text: formatQuantityWithUnit(item.quantity, item.unit) }),
              low ? el('span.pill.pill--low', { text: 'Low' }) : null,
            ]),
            el('span.table__num', {
              text: item.lowStockLevel ? formatQuantityWithUnit(item.lowStockLevel, item.unit) : '—',
            }),
            el('span.table__num', {
              text: formatMoney(Math.round((item.quantity * (item.costPerUnit || 0)) / 1000), symbol),
            }),
            el('span.table__actions', {}, [
              el('button.btn.btn--ghost.btn--sm', {
                type: 'button',
                text: 'Receive',
                onclick: () => movementForm(item, STOCK_MOVEMENT_KINDS.RECEIVED),
              }),
              el('button.btn.btn--ghost.btn--sm', {
                type: 'button',
                text: 'Waste',
                onclick: () => movementForm(item, STOCK_MOVEMENT_KINDS.WASTAGE),
              }),
              el('button.btn.btn--ghost.btn--sm', {
                type: 'button',
                text: 'Recount',
                onclick: () => movementForm(item, STOCK_MOVEMENT_KINDS.CORRECTION),
              }),
              el('button.btn.btn--ghost.btn--sm', {
                type: 'button',
                text: 'History',
                onclick: () => showHistory(item),
              }),
              el('button.btn.btn--ghost.btn--sm', {
                type: 'button',
                text: 'Edit',
                onclick: () => itemForm(item),
              }),
              el('button.icon-btn.icon-btn--danger', {
                type: 'button',
                text: '×',
                'aria-label': `Delete ${item.name}`,
                onclick: async () => {
                  const ok = await confirmDialog({
                    title: `Delete ${item.name}?`,
                    message:
                      'It is removed from every recipe that uses it. Past movements stay in the record.',
                    confirmLabel: 'Delete item',
                    tone: 'danger',
                  });
                  if (!ok) return;
                  try {
                    await inventoryRepo.deleteStockItem(item.id);
                    toast.success('Stock item deleted.');
                    paint();
                    paintRecipes();
                  } catch (error) {
                    reportError(error);
                  }
                },
              }),
            ]),
          ]);
        }),
      ])
    );
  }

  function paint() {
    paintStats();
    paintFilters();
    paintTable();
  }

  /* ---------------------------------------------------------- assembly --- */

  const page = el('div.page', {}, [
    el('div.page__head', {}, [
      el('div', {}, [
        el('h1.page__title', { text: 'Stock' }),
        el('p.page__sub', { text: 'What is on the shelf, and what each drink costs to make.' }),
      ]),
      el('div.page__actions', {}, [
        el('button.btn.btn--primary', {
          type: 'button',
          text: 'Add a stock item',
          onclick: () => itemForm(),
        }),
      ]),
    ]),

    stats,
    filters,
    table,

    el('section.panel.panel--wide', {}, [
      el('h2.panel__title', { text: 'Recipes' }),
      el('p.panel__line', {
        text:
          'Link a menu item to what it uses and every sale takes it off the shelf by itself. Items with no recipe still sell — they just do not move stock.',
      }),
      recipePanel,
    ]),
  ]);

  clear(outlet).appendChild(page);
  paint();
  await paintRecipes();

  const unsubscribe = inventoryRepo.onInventoryChange(paint);
  return () => unsubscribe();
}
