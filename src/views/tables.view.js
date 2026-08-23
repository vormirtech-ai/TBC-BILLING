/**
 * The floor: every table, its QR code, and what it is doing.
 *
 * A table's QR code is generated here from its token and drawn as an SVG, so
 * the printed card is vector art rather than a blurry screenshot. Printing is
 * built around what a cafe actually does with these: a sheet of cards, cut up
 * and stood on the tables.
 */

import { el, clear, downloadBlob } from '../core/utils.js';
import { renderQrSvg, qrSvgMarkup, qrPngDataUrl, ECC } from '../lib/qrcode.js';
import { getSettings } from '../repositories/settings.repo.js';
import * as tablesRepo from '../repositories/tables.repo.js';
import { TABLE_STATUS } from '../config/app.config.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toast, reportError } from '../ui/toast.js';
import { isAdmin } from '../core/session.js';
import { navigate } from '../core/router.js';
import * as cart from '../services/cart.service.js';

const STATUS_LABELS = {
  [TABLE_STATUS.FREE]: 'Free',
  [TABLE_STATUS.SEATED]: 'Seated',
  [TABLE_STATUS.ORDERED]: 'Ordered',
};

function statusPill(status) {
  const value = status || TABLE_STATUS.FREE;
  return el(`span.pill.pill--${value.toLowerCase()}`, { text: STATUS_LABELS[value] || value });
}

export async function renderTables({ outlet }) {
  const settings = getSettings();
  const admin = isAdmin();
  const state = { query: '', zone: 'All', status: 'All' };

  await tablesRepo.loadTables();

  const grid = el('div.tables__grid');
  const filters = el('div.filters.filters--inline');
  const summary = el('p.page__sub');

  /* -------------------------------------------------------------- QR --- */

  /**
   * A table card, at the size it is printed: the code big enough to scan from
   * across the table, and the table name large enough to read while holding a
   * phone over it.
   */
  function qrCard(table, { size = 220 } = {}) {
    const url = tablesRepo.tableOrderUrl(table);
    return el('article.qrcard', {}, [
      el('div.qrcard__head', {}, [
        el('span.qrcard__cafe', { text: settings.cafeName }),
        el('span.qrcard__table', { text: table.name }),
      ]),
      el('div.qrcard__code', {}, [
        // Medium correction: a card on a cafe table gets ring-marked and
        // scuffed, and medium still scans with a quarter of it damaged.
        renderQrSvg(url, { size, ecc: ECC.MEDIUM, title: `Order at ${table.name}` }),
      ]),
      el('p.qrcard__call', { text: 'Scan to see the menu and order' }),
      el('p.qrcard__zone', { text: table.zone && table.zone !== 'Main' ? table.zone : '' }),
    ]);
  }

  function showQr(table) {
    const url = tablesRepo.tableOrderUrl(table);

    const linkBox = el('input.input.input--mono', {
      type: 'text',
      value: url,
      readonly: true,
      'aria-label': `Ordering link for ${table.name}`,
      onclick: (event) => event.target.select(),
    });

    const modal = openModal({
      title: `${table.name} · QR code`,
      subtitle: `${table.zone || 'Main'} · ${table.seats || 0} seats · code ${table.token}`,
      body: el('div.stack', {}, [
        el('div.qrpreview', {}, [qrCard(table, { size: 240 })]),
        el('label.field', {}, [
          el('span.field__label', { text: 'The link this code opens' }),
          linkBox,
          el('span.hint', {
            text: 'Anyone who opens this link sees the menu for this table. Give out the printed card, not the link.',
          }),
        ]),
        el('div.actionrow', {}, [
          el('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            text: 'Copy link',
            onclick: async () => {
              try {
                await navigator.clipboard.writeText(url);
                toast.success('Link copied.');
              } catch {
                // Clipboard access is refused in plenty of ordinary situations.
                linkBox.select();
                toast.info('Press Ctrl+C to copy the selected link.');
              }
            },
          }),
          el('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            text: 'Download PNG',
            onclick: () => {
              const dataUrl = qrPngDataUrl(url, { scale: 12, ecc: ECC.MEDIUM });
              const link = document.createElement('a');
              link.href = dataUrl;
              link.download = `QR_${table.name.replace(/\s+/g, '_')}.png`;
              link.click();
              toast.success('QR image downloaded.');
            },
          }),
          el('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            text: 'Download SVG',
            onclick: () => {
              const markup = qrSvgMarkup(url, { size: 512, ecc: ECC.MEDIUM });
              downloadBlob(
                new Blob([markup], { type: 'image/svg+xml' }),
                `QR_${table.name.replace(/\s+/g, '_')}.svg`
              );
              toast.success('QR vector downloaded.');
            },
          }),
        ]),
      ]),
      actions: [
        el('button.btn.btn--ghost', { type: 'button', text: 'Close', onclick: () => modal.close() }),
        el('button.btn.btn--primary', {
          type: 'button',
          text: 'Print this card',
          onclick: () => printCards([table]),
        }),
      ],
    });
  }

  /**
   * Print a sheet of cards. The receipt printer path is reused: the sheet goes
   * into the hidden print area and the stylesheet hides everything else.
   */
  function printCards(tables) {
    const host = document.getElementById('printArea');
    if (!host) return;

    host.replaceChildren(
      el(
        'div.qrsheet',
        {},
        tables.map((table) => qrCard(table, { size: 200 }))
      )
    );
    document.body.classList.add('is-printing');

    const cleanup = () => {
      document.body.classList.remove('is-printing');
      host.replaceChildren();
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);

    requestAnimationFrame(() => {
      window.print();
      setTimeout(cleanup, 1500); // Safari does not always fire afterprint
    });
  }

  /* ----------------------------------------------------------- editing --- */

  function tableForm(table = null) {
    const name = el('input.input', { type: 'text', value: table?.name || '', maxlength: 40 });
    const zone = el('input.input', {
      type: 'text',
      value: table?.zone || 'Main',
      placeholder: 'Main, Rooftop, Garden…',
    });
    const seats = el('input.input', {
      type: 'text',
      inputmode: 'numeric',
      value: String(table?.seats ?? 4),
    });
    const notes = el('input.input', { type: 'text', value: table?.notes || '', maxlength: 120 });

    const modal = openModal({
      title: table ? `Edit ${table.name}` : 'Add a table',
      size: 'sm',
      body: el('div.stack', {}, [
        el('label.field', {}, [el('span.field__label', { text: 'Name or number' }), name]),
        el('label.field', {}, [el('span.field__label', { text: 'Area' }), zone]),
        el('label.field', {}, [el('span.field__label', { text: 'Seats' }), seats]),
        el('label.field', {}, [el('span.field__label', { text: 'Note (optional)' }), notes]),
      ]),
      actions: [
        el('button.btn.btn--ghost', { type: 'button', text: 'Cancel', onclick: () => modal.close() }),
        el('button.btn.btn--primary', {
          type: 'button',
          text: table ? 'Save table' : 'Add table',
          onclick: async (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            try {
              const draft = {
                name: name.value,
                zone: zone.value,
                seats: Number(seats.value),
                notes: notes.value,
              };
              if (table) await tablesRepo.updateTable(table.id, draft);
              else await tablesRepo.createTable(draft);

              toast.success(table ? 'Table saved.' : 'Table added with its own QR code.');
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

  function bulkForm() {
    const count = el('input.input', { type: 'text', inputmode: 'numeric', value: '8' });
    const prefix = el('input.input', { type: 'text', value: 'Table ' });
    const startAt = el('input.input', { type: 'text', inputmode: 'numeric', value: '1' });
    const seats = el('input.input', { type: 'text', inputmode: 'numeric', value: '4' });
    const zone = el('input.input', { type: 'text', value: 'Main' });

    const modal = openModal({
      title: 'Add several tables',
      subtitle: 'Each one gets its own QR code straight away.',
      size: 'sm',
      body: el('div.stack', {}, [
        el('label.field', {}, [el('span.field__label', { text: 'How many' }), count]),
        el('label.field', {}, [el('span.field__label', { text: 'Name starts with' }), prefix]),
        el('label.field', {}, [el('span.field__label', { text: 'First number' }), startAt]),
        el('label.field', {}, [el('span.field__label', { text: 'Seats each' }), seats]),
        el('label.field', {}, [el('span.field__label', { text: 'Area' }), zone]),
        el('p.hint', { text: 'Names already in use are skipped, so this is safe to run twice.' }),
      ]),
      actions: [
        el('button.btn.btn--ghost', { type: 'button', text: 'Cancel', onclick: () => modal.close() }),
        el('button.btn.btn--primary', {
          type: 'button',
          text: 'Add tables',
          onclick: async (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            try {
              const created = await tablesRepo.createTables({
                count: Number(count.value),
                prefix: prefix.value,
                startAt: Number(startAt.value),
                seats: Number(seats.value),
                zone: zone.value,
              });
              toast.success(`${created.length} table${created.length === 1 ? '' : 's'} added.`);
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

  /* ------------------------------------------------------------ actions --- */

  async function cycleStatus(table) {
    const next =
      table.status === TABLE_STATUS.FREE
        ? TABLE_STATUS.SEATED
        : table.status === TABLE_STATUS.SEATED
        ? TABLE_STATUS.ORDERED
        : TABLE_STATUS.FREE;
    try {
      await tablesRepo.setStatus(table.id, next);
      paint();
    } catch (error) {
      reportError(error);
    }
  }

  /** Start a counter order already seated at this table. */
  function billTable(table) {
    cart.setTable(table);
    toast.info(`The counter is now taking an order for ${table.name}.`);
    navigate('/pos');
  }

  async function newCode(table) {
    const ok = await confirmDialog({
      title: `New QR code for ${table.name}?`,
      message:
        'The card currently on this table stops working straight away. Print and replace it before customers try to scan it.',
      confirmLabel: 'Generate new code',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const updated = await tablesRepo.regenerateToken(table.id);
      toast.success(`${table.name} has a new code. Print the replacement card.`);
      paint();
      showQr(updated);
    } catch (error) {
      reportError(error);
    }
  }

  async function removeTable(table) {
    const ok = await confirmDialog({
      title: `Delete ${table.name}?`,
      message: 'Past bills keep the table they were served at. The QR card stops working.',
      confirmLabel: 'Delete table',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await tablesRepo.deleteTable(table.id);
      toast.success('Table deleted.');
      paint();
    } catch (error) {
      reportError(error);
    }
  }

  /* ------------------------------------------------------------- paint --- */

  function paintFilters() {
    clear(filters);
    const zones = ['All', ...tablesRepo.getZones()];

    const zoneSelect = el(
      'select.input.input--sm',
      { onchange: (event) => ((state.zone = event.target.value), paintGrid()) },
      zones.map((zone) => el('option', { value: zone, text: zone === 'All' ? 'All areas' : zone }))
    );
    zoneSelect.value = state.zone;

    const statusSelect = el(
      'select.input.input--sm',
      { onchange: (event) => ((state.status = event.target.value), paintGrid()) },
      [
        el('option', { value: 'All', text: 'Any status' }),
        ...Object.values(TABLE_STATUS).map((value) =>
          el('option', { value, text: STATUS_LABELS[value] })
        ),
      ]
    );
    statusSelect.value = state.status;

    const search = el('input.input.input--sm', {
      type: 'search',
      placeholder: 'Find a table…',
      value: state.query,
      oninput: (event) => {
        state.query = event.target.value.trim();
        paintGrid();
      },
    });

    filters.append(search, zoneSelect, statusSelect);
  }

  function paintGrid() {
    const tables = tablesRepo.searchTables(state);
    clear(grid);

    if (!tables.length) {
      grid.appendChild(
        el('div.empty', {}, [
          el('p', {
            text: tablesRepo.getTables().length
              ? 'No tables match those filters.'
              : 'No tables yet. Add them and each one gets a QR code automatically.',
          }),
          admin && !tablesRepo.getTables().length
            ? el('button.btn.btn--primary.btn--sm', {
                type: 'button',
                text: 'Add several tables',
                onclick: bulkForm,
              })
            : null,
        ])
      );
      return;
    }

    for (const table of tables) {
      grid.appendChild(
        el('article.tablecard', { class: `is-${(table.status || 'FREE').toLowerCase()}` }, [
          el('header.tablecard__head', {}, [
            el('div', {}, [
              el('h3.tablecard__name', { text: table.name }),
              el('span.tablecard__meta', {
                text: `${table.zone || 'Main'} · ${table.seats || 0} seats`,
              }),
            ]),
            statusPill(table.status),
          ]),

          el('button.tablecard__qr', {
            type: 'button',
            title: `Show the QR code for ${table.name}`,
            'aria-label': `Show the QR code for ${table.name}`,
            onclick: () => showQr(table),
            html: qrSvgMarkup(tablesRepo.tableOrderUrl(table), { size: 132, ecc: ECC.MEDIUM }),
          }),

          table.notes ? el('p.tablecard__note', { text: table.notes }) : null,

          el('div.tablecard__actions', {}, [
            el('button.btn.btn--ghost.btn--sm', {
              type: 'button',
              text: STATUS_LABELS[table.status || TABLE_STATUS.FREE],
              title: 'Change what this table is doing',
              onclick: () => cycleStatus(table),
            }),
            el('button.btn.btn--ghost.btn--sm', {
              type: 'button',
              text: 'Take order',
              onclick: () => billTable(table),
            }),
            admin
              ? el('button.btn.btn--ghost.btn--sm', {
                  type: 'button',
                  text: 'Edit',
                  onclick: () => tableForm(table),
                })
              : null,
            admin
              ? el('button.btn.btn--ghost.btn--sm', {
                  type: 'button',
                  text: 'New code',
                  onclick: () => newCode(table),
                })
              : null,
            admin
              ? el('button.icon-btn.icon-btn--danger', {
                  type: 'button',
                  text: '×',
                  'aria-label': `Delete ${table.name}`,
                  onclick: () => removeTable(table),
                })
              : null,
          ]),
        ])
      );
    }
  }

  function paint() {
    const tables = tablesRepo.getTables();
    const busy = tables.filter((table) => (table.status || TABLE_STATUS.FREE) !== TABLE_STATUS.FREE);
    summary.textContent = tables.length
      ? `${tables.length} table${tables.length === 1 ? '' : 's'} · ${busy.length} in use · ${
          tablesRepo.getZones().length
        } area${tablesRepo.getZones().length === 1 ? '' : 's'}`
      : 'Add your tables to start taking orders from QR codes.';
    paintFilters();
    paintGrid();
  }

  /* ---------------------------------------------------------- assembly --- */

  const page = el('div.page', {}, [
    el('div.page__head', {}, [
      el('div', {}, [el('h1.page__title', { text: 'Tables' }), summary]),
      el('div.page__actions', {}, [
        el('button.btn.btn--ghost', {
          type: 'button',
          text: 'Print all QR cards',
          onclick: () => {
            const tables = tablesRepo.searchTables(state);
            if (!tables.length) {
              toast.info('There are no tables to print.');
              return;
            }
            printCards(tables);
          },
        }),
        admin
          ? el('button.btn.btn--ghost', {
              type: 'button',
              text: 'Add several',
              onclick: bulkForm,
            })
          : null,
        admin
          ? el('button.btn.btn--primary', {
              type: 'button',
              text: 'Add a table',
              onclick: () => tableForm(),
            })
          : null,
      ]),
    ]),

    settings.qrOrderingEnabled
      ? null
      : el('p.callout.callout--warn', {
          text:
            'QR ordering is switched off in Settings, so scanning a table code shows the menu but will not send an order.',
        }),

    filters,
    grid,
  ]);

  clear(outlet).appendChild(page);
  paint();

  const unsubscribe = tablesRepo.onTablesChange(paint);
  return () => unsubscribe();
}
