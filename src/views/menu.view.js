/** Admin-only menu management: add, edit, price, availability, images. */

import {
  el,
  clear,
  debounce,
  readFileAsDataUrl,
  matchesQuery,
  formatDateTime,
} from '../core/utils.js';
import { formatMoney, parseRupeesToPaise, parsePercentToBasisPoints, formatRate } from '../core/money.js';
import { getSettings } from '../repositories/settings.repo.js';
import * as menuRepo from '../repositories/menu.repo.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toast, reportError } from '../ui/toast.js';
import { exportMenu } from '../services/export.service.js';
import {
  publishStatus,
  publishMenuToCloud,
  downloadMenuSnapshot,
} from '../services/publicMenu.service.js';

export function renderMenuAdmin({ outlet }) {
  const settings = getSettings();
  const symbol = settings.currencySymbol || '₹';
  const state = { query: '', category: 'All' };

  const list = el('div.menuadmin__list');
  const countNote = el('p.page__sub');

  /* ------------------------------------------------------------ editor --- */

  function openEditor(item = null) {
    const isNew = !item;
    const categories = menuRepo.getCategories();

    const name = el('input.input', { type: 'text', value: item?.name || '', maxlength: 80, required: true });
    const categoryInput = el('input.input', {
      type: 'text',
      value: item?.category || categories[0] || '',
      list: 'categoryOptions',
      required: true,
    });
    const datalist = el(
      'datalist#categoryOptions',
      {},
      categories.map((category) => el('option', { value: category }))
    );
    const price = el('input.input', {
      type: 'text',
      inputmode: 'decimal',
      value: item ? String(item.price / 100) : '',
      required: true,
    });
    const description = el('textarea.input.input--area', {
      rows: 3,
      maxlength: 400,
      text: item?.description || '',
    });
    const available = el('input', { type: 'checkbox', checked: item ? item.available : true });
    const taxRate = el('input.input', {
      type: 'text',
      inputmode: 'decimal',
      placeholder: `Default (${formatRate(settings.defaultTaxRate)})`,
      value:
        item?.taxRate === null || item?.taxRate === undefined ? '' : String(item.taxRate / 100),
    });

    let imageData = item?.image || '';
    const preview = el('div.imagepreview', {}, [
      imageData ? el('img', { src: imageData, alt: '' }) : el('span', { text: 'No image' }),
    ]);
    const imageInput = el('input', {
      type: 'file',
      accept: 'image/*',
      onchange: async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (file.size > 400_000) {
          toast.warn('Use an image under 400 KB so the counter stays quick.');
          event.target.value = '';
          return;
        }
        try {
          imageData = await readFileAsDataUrl(file);
          clear(preview).appendChild(el('img', { src: imageData, alt: '' }));
        } catch (error) {
          reportError(error);
        }
      },
    });

    const save = el('button.btn.btn--primary', { type: 'button', text: isNew ? 'Add item' : 'Save changes' });

    const modal = openModal({
      title: isNew ? 'Add a menu item' : `Edit ${item.name}`,
      subtitle: isNew ? null : 'Price changes apply to new orders only — past bills keep their prices.',
      body: el('div.stack', {}, [
        datalist,
        el('label.field', {}, [el('span.field__label', { text: 'Item name' }), name]),
        el('div.field-row', {}, [
          el('label.field', {}, [el('span.field__label', { text: 'Category' }), categoryInput]),
          el('label.field', {}, [
            el('span.field__label', { text: `Price (${symbol})` }),
            price,
          ]),
        ]),
        el('label.field', {}, [el('span.field__label', { text: 'Description' }), description]),
        el('div.field-row', {}, [
          el('label.field', {}, [
            el('span.field__label', { text: 'Tax rate %' }),
            taxRate,
            el('span.hint', { text: 'Leave blank to use the cafe default.' }),
          ]),
          el('label.field.field--check', {}, [available, el('span', { text: 'Available to sell' })]),
        ]),
        el('div.field', {}, [
          el('span.field__label', { text: 'Photo (optional)' }),
          el('div.imagerow', {}, [
            preview,
            el('div.stack.stack--tight', {}, [
              imageInput,
              imageData
                ? el('button.btn.btn--ghost.btn--sm', {
                    type: 'button',
                    text: 'Remove photo',
                    onclick: () => {
                      imageData = '';
                      clear(preview).appendChild(el('span', { text: 'No image' }));
                    },
                  })
                : null,
            ]),
          ]),
        ]),
      ]),
      actions: [
        el('button.btn.btn--ghost', { type: 'button', text: 'Cancel', onclick: () => modal.close() }),
        save,
      ],
    });

    save.addEventListener('click', async () => {
      const paise = parseRupeesToPaise(price.value);
      if (paise === null) {
        toast.error('Enter a price like 180 or 180.50.');
        price.focus();
        return;
      }
      let rate = null;
      if (taxRate.value.trim() !== '') {
        rate = parsePercentToBasisPoints(taxRate.value);
        if (rate === null) {
          toast.error('Enter a tax rate between 0 and 100.');
          taxRate.focus();
          return;
        }
      }

      const payload = {
        name: name.value,
        category: categoryInput.value,
        price: paise,
        description: description.value,
        image: imageData,
        available: available.checked,
        taxRate: rate,
      };

      save.disabled = true;
      try {
        if (isNew) {
          const created = await menuRepo.createItem(payload);
          toast.success(`${created.name} added to ${created.category}.`);
        } else {
          const updated = await menuRepo.updateItem(item.id, payload);
          toast.success(`${updated.name} updated.`);
        }
        modal.close();
        paint();
      } catch (error) {
        reportError(error);
        save.disabled = false;
      }
    });
  }

  /* -------------------------------------------------------------- rows --- */

  function paint() {
    const items = menuRepo.getMenu().filter((item) => {
      if (state.category !== 'All' && item.category !== state.category) return false;
      if (!state.query) return true;
      return matchesQuery(item.name, state.query) || matchesQuery(item.category, state.query);
    });

    clear(list);
    countNote.textContent = `${menuRepo.getMenu().length} items · ${
      menuRepo.getMenu().filter((i) => !i.available).length
    } unavailable`;

    if (!items.length) {
      list.appendChild(el('p.empty', { text: 'No items match this filter.' }));
      return;
    }

    const grouped = new Map();
    for (const item of items) {
      if (!grouped.has(item.category)) grouped.set(item.category, []);
      grouped.get(item.category).push(item);
    }

    for (const [category, rows] of grouped) {
      list.appendChild(
        el('div.menuadmin__group', {}, [
          el('h3.menuadmin__cat', {}, [
            el('span', { text: category }),
            el('span.menuadmin__catcount', { text: `${rows.length}` }),
          ]),
          ...rows.map((item) =>
            el('div.menuadmin__row', { class: item.available ? '' : 'is-off' }, [
              item.image
                ? el('img.menuadmin__thumb', { src: item.image, alt: '' })
                : el('span.menuadmin__thumb.menuadmin__thumb--empty', {
                    text: item.name.slice(0, 1),
                  }),
              el('div.menuadmin__info', {}, [
                el('span.menuadmin__name', { text: item.name }),
                el('span.menuadmin__desc', { text: item.description || '—' }),
              ]),
              el('span.menuadmin__price', { text: formatMoney(item.price, symbol) }),
              el('label.switch', { title: item.available ? 'Available' : 'Unavailable' }, [
                el('input', {
                  type: 'checkbox',
                  checked: item.available,
                  'aria-label': `${item.name} available`,
                  onchange: async (event) => {
                    try {
                      await menuRepo.setAvailability(item.id, event.target.checked);
                      paint();
                    } catch (error) {
                      reportError(error);
                      event.target.checked = item.available;
                    }
                  },
                }),
                el('span.switch__track', {}, [el('span.switch__thumb')]),
              ]),
              el('button.btn.btn--ghost.btn--sm', {
                type: 'button',
                text: 'Edit',
                onclick: () => openEditor(item),
              }),
              el('button.icon-btn.icon-btn--danger', {
                type: 'button',
                text: '×',
                'aria-label': `Delete ${item.name}`,
                onclick: async () => {
                  const ok = await confirmDialog({
                    title: `Delete ${item.name}?`,
                    message:
                      'Past bills keep their own copy of this item, so history stays intact. If you only want to stop selling it, switch it to unavailable instead.',
                    confirmLabel: 'Delete item',
                    tone: 'danger',
                  });
                  if (!ok) return;
                  try {
                    await menuRepo.deleteItem(item.id);
                    toast.success(`${item.name} deleted.`);
                    paint();
                  } catch (error) {
                    reportError(error);
                  }
                },
              }),
            ])
          ),
        ])
      );
    }
  }

  /* ---------------------------------------------------------- controls --- */

  const search = el('input.input', {
    type: 'search',
    placeholder: 'Find an item…',
    'aria-label': 'Search menu items',
  });
  search.addEventListener(
    'input',
    debounce(() => {
      state.query = search.value.trim();
      paint();
    }, 120)
  );

  const categorySelect = el(
    'select.input',
    {
      'aria-label': 'Filter by category',
      onchange: (event) => {
        state.category = event.target.value;
        paint();
      },
    },
    ['All', ...menuRepo.getCategories()].map((category) =>
      el('option', { value: category, text: category })
    )
  );

  /* ---------------------------------------------------------- publish --- */

  /**
   * The menu customers see is a published snapshot, not this working menu — a
   * phone that has never opened the site has no way to read the counter's
   * database. This explains where the customer menu currently comes from and
   * offers both ways to refresh it.
   */
  async function openPublish() {
    const status = await publishStatus();

    const line = (label, entry) =>
      el('div.totals__row', {}, [
        el('span', { text: label }),
        el('span', {
          text: entry
            ? entry.matches
              ? `Up to date · ${entry.count} items`
              : `Out of date · published ${formatDateTime(entry.publishedAt)}`
            : 'Never published',
          class: entry?.matches ? 'is-positive' : 'is-negative',
        }),
      ]);

    const modal = openModal({
      title: 'Publish the menu for QR ordering',
      subtitle: `${status.itemCount} available item${status.itemCount === 1 ? '' : 's'} on the working menu`,
      body: el('div.stack', {}, [
        el('p.modal__text', {
          text:
            'A customer scanning a table code reads a published copy of the menu. Publish after changing prices so their phone shows what you actually charge.',
        }),
        el('div.cart__totals', {}, [
          line('In the site files', status.file),
          status.cloudEnabled ? line('Live ordering backend', status.cloud) : null,
        ]),
        status.cloudEnabled
          ? null
          : el('p.hint', {
              text:
                'Live ordering is switched off, so the site file is the only published copy. Download it, put it in the data folder of the site, and deploy as usual.',
            }),
      ]),
      actions: [
        el('button.btn.btn--ghost', { type: 'button', text: 'Close', onclick: () => modal.close() }),
        status.cloudEnabled
          ? el('button.btn.btn--ghost', {
              type: 'button',
              text: 'Publish live',
              onclick: async (event) => {
                const button = event.currentTarget;
                button.disabled = true;
                try {
                  const result = await publishMenuToCloud();
                  if (result.sent) toast.success(`${result.count} items published. Phones see them now.`);
                  else toast.error('The menu could not be published. Check the connection in Settings.');
                  modal.close();
                } catch (error) {
                  reportError(error);
                  button.disabled = false;
                }
              },
            })
          : null,
        el('button.btn.btn--primary', {
          type: 'button',
          text: 'Download menu.published.json',
          onclick: () => {
            try {
              const result = downloadMenuSnapshot();
              toast.success(`${result.filename} downloaded — put it in the site's data folder.`);
              modal.close();
            } catch (error) {
              reportError(error);
            }
          },
        }),
      ],
    });
  }

  const page = el('div.page', {}, [
    el('div.page__head', {}, [
      el('div', {}, [el('h1.page__title', { text: 'Menu' }), countNote]),
      el('div.page__actions', {}, [
        el('button.btn.btn--ghost', {
          type: 'button',
          text: 'Publish for QR ordering',
          title: 'Make this menu the one customers see when they scan a table code',
          onclick: openPublish,
        }),
        el('button.btn.btn--ghost', {
          type: 'button',
          text: 'Export menu',
          onclick: async () => {
            try {
              const result = await exportMenu();
              toast.success(`${result.filename} downloaded.`);
            } catch (error) {
              reportError(error);
            }
          },
        }),
        el('button.btn.btn--primary', {
          type: 'button',
          text: 'Add item',
          onclick: () => openEditor(null),
        }),
      ]),
    ]),
    el('section.filters', {}, [
      el('div.filters__row', {}, [
        el('label.filters__field.filters__field--grow', {}, [el('span', { text: 'Search' }), search]),
        el('label.filters__field', {}, [el('span', { text: 'Category' }), categorySelect]),
      ]),
    ]),
    list,
  ]);

  clear(outlet).appendChild(page);
  paint();
}
