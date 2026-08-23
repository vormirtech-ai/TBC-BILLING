/** Admin settings: cafe details, billing rules, users, backup, maintenance. */

import { el, clear, formatDateTime } from '../core/utils.js';
import { parsePercentToBasisPoints, formatRate } from '../core/money.js';
import { getSettings, saveSettings } from '../repositories/settings.repo.js';
import * as usersRepo from '../repositories/users.repo.js';
import * as menuRepo from '../repositories/menu.repo.js';
import * as transactionsRepo from '../repositories/transactions.repo.js';
import * as daysRepo from '../repositories/businessDays.repo.js';
import { storageEstimate, requestPersistentStorage } from '../db/database.js';
import { exportBackup, inspectBackup, restoreBackup } from '../services/backup.service.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toast, reportError } from '../ui/toast.js';
import { APP } from '../config/app.config.js';
import { testConnection } from '../services/cloudSync.service.js';
import * as tablesRepo from '../repositories/tables.repo.js';

function section(title, description, body) {
  return el('section.panel.panel--wide', {}, [
    el('h2.panel__title', { text: title }),
    description ? el('p.panel__line', { text: description }) : null,
    body,
  ]);
}

function textField(label, value, options = {}) {
  const input = el('input.input', {
    type: options.type || 'text',
    value: value ?? '',
    placeholder: options.placeholder || '',
    inputmode: options.inputmode || null,
    min: options.min ?? null,
    max: options.max ?? null,
  });
  const field = el('label.field', {}, [
    el('span.field__label', { text: label }),
    input,
    options.hint ? el('span.hint', { text: options.hint }) : null,
  ]);
  return { field, input };
}

function checkField(label, checked, hint) {
  const input = el('input', { type: 'checkbox', checked: Boolean(checked) });
  const field = el('label.field.field--check', {}, [
    input,
    el('span', {}, [el('span', { text: label }), hint ? el('span.hint', { text: hint }) : null]),
  ]);
  return { field, input };
}

export async function renderSettings({ outlet }) {
  const settings = getSettings();

  clear(outlet).appendChild(el('div.loading', { text: 'Loading settings…' }));

  const [users, estimate, transactionCount] = await Promise.all([
    usersRepo.listUsers(),
    storageEstimate(),
    transactionsRepo.countAll(),
  ]);

  /* ------------------------------------------------------ cafe details --- */

  const cafeName = textField('Cafe name', settings.cafeName);
  const tagline = textField('Tagline', settings.tagline);
  const address = textField('Address', settings.address);
  const phone = textField('Phone', settings.phone);
  const gstin = textField('GSTIN', settings.gstin, { placeholder: 'Optional' });
  const receiptFooter = textField('Receipt footer', settings.receiptFooter);
  const currencySymbol = textField('Currency symbol', settings.currencySymbol, { placeholder: '₹' });

  const detailsForm = el('div.formgrid', {}, [
    cafeName.field,
    tagline.field,
    address.field,
    phone.field,
    gstin.field,
    currencySymbol.field,
    receiptFooter.field,
    el('div.form__actions', {}, [
      el('button.btn.btn--primary', {
        type: 'button',
        text: 'Save cafe details',
        onclick: async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          try {
            await saveSettings({
              cafeName: cafeName.input.value.trim() || 'The Baruch Cafe',
              tagline: tagline.input.value.trim(),
              address: address.input.value.trim(),
              phone: phone.input.value.trim(),
              gstin: gstin.input.value.trim(),
              currencySymbol: currencySymbol.input.value.trim() || '₹',
              receiptFooter: receiptFooter.input.value.trim(),
            });
            toast.success('Cafe details saved.');
          } catch (error) {
            reportError(error);
          } finally {
            button.disabled = false;
          }
        },
      }),
    ]),
  ]);

  /* ----------------------------------------------------- billing rules --- */

  const taxEnabled = checkField('Charge tax on bills', settings.taxEnabled);
  const taxLabel = textField('Tax label', settings.taxLabel, { placeholder: 'GST' });
  const taxRate = textField('Default tax rate %', settings.defaultTaxRate / 100, {
    inputmode: 'decimal',
    hint: 'Items can override this individually in Menu.',
  });
  const priceIncludesTax = checkField(
    'Menu prices already include tax',
    settings.priceIncludesTax,
    'Tax is then shown as a breakdown rather than added on top.'
  );
  const discountEnabled = checkField('Allow discounts', settings.discountEnabled);
  const maxDiscount = textField('Maximum discount %', settings.maxDiscountPercent, {
    inputmode: 'decimal',
  });
  const cashierDiscount = checkField(
    'Cashiers may apply discounts',
    settings.cashierCanApplyDiscount
  );
  const cashierHistory = checkField('Cashiers may view bill history', settings.cashierCanViewHistory);
  const roundOff = checkField(
    'Round bill totals to the nearest rupee',
    settings.roundOffEnabled,
    'The adjustment is printed and exported as a separate round-off line.'
  );

  const billingForm = el('div.formgrid', {}, [
    taxEnabled.field,
    taxLabel.field,
    taxRate.field,
    priceIncludesTax.field,
    discountEnabled.field,
    maxDiscount.field,
    cashierDiscount.field,
    cashierHistory.field,
    roundOff.field,
    el('div.form__actions', {}, [
      el('button.btn.btn--primary', {
        type: 'button',
        text: 'Save billing rules',
        onclick: async (event) => {
          const rate = parsePercentToBasisPoints(taxRate.input.value || '0');
          if (rate === null) {
            toast.error('Enter a tax rate between 0 and 100.');
            return;
          }
          const max = Number(maxDiscount.input.value);
          if (!Number.isFinite(max) || max < 0 || max > 100) {
            toast.error('The maximum discount must be between 0 and 100.');
            return;
          }
          const button = event.currentTarget;
          button.disabled = true;
          try {
            await saveSettings({
              taxEnabled: taxEnabled.input.checked,
              taxLabel: taxLabel.input.value.trim() || 'GST',
              defaultTaxRate: rate,
              priceIncludesTax: priceIncludesTax.input.checked,
              discountEnabled: discountEnabled.input.checked,
              maxDiscountPercent: max,
              cashierCanApplyDiscount: cashierDiscount.input.checked,
              cashierCanViewHistory: cashierHistory.input.checked,
              roundOffEnabled: roundOff.input.checked,
            });
            toast.success('Billing rules saved. New bills use them immediately.');
          } catch (error) {
            reportError(error);
          } finally {
            button.disabled = false;
          }
        },
      }),
    ]),
  ]);

  /* ------------------------------------------------------ business day --- */

  const startNumber = textField('First business day number', settings.businessDayStartNumber, {
    inputmode: 'numeric',
    hint: 'Used when the first sale of a new trading day is recorded.',
  });
  const rollover = textField('Day rollover hour (0–23)', settings.dayRolloverHour, {
    inputmode: 'numeric',
    hint: 'Set to 4 if a 1 a.m. sale should count towards the previous day.',
  });
  const orderPrefix = textField('Bill number prefix', settings.orderPrefix, { placeholder: 'ORD-' });
  const orderPadding = textField('Bill number digits', settings.orderNumberPadding, {
    inputmode: 'numeric',
  });

  const days = await daysRepo.listDays();
  const dayList = days.length
    ? el('div.table', {}, [
        el('div.table__head.table__head--days', {}, [
          el('span', { text: 'Day' }),
          el('span', { text: 'Date' }),
          el('span', { text: 'Bills' }),
          el('span', { text: 'Items' }),
          el('span', { text: 'Exported' }),
        ]),
        ...days.slice(0, 10).map((day) =>
          el('div.table__row.table__row--days', {}, [
            el('span.mono', { text: daysRepo.dayLabel(day.dayNumber) }),
            el('span', { text: day.date }),
            el('span', { text: String(day.transactionCount) }),
            el('span', { text: String(day.itemCount) }),
            el('span', { text: day.lastExportedAt ? formatDateTime(day.lastExportedAt) : 'Not yet' }),
          ])
        ),
      ])
    : el('p.empty', { text: 'Day 1 opens automatically with the first sale.' });

  const dayForm = el('div.stack', {}, [
    el('div.formgrid', {}, [
      startNumber.field,
      rollover.field,
      orderPrefix.field,
      orderPadding.field,
      el('div.form__actions', {}, [
        el('button.btn.btn--primary', {
          type: 'button',
          text: 'Save day settings',
          onclick: async (event) => {
            const start = Number(startNumber.input.value);
            const hour = Number(rollover.input.value);
            const padding = Number(orderPadding.input.value);
            if (!Number.isInteger(start) || start < 1) {
              toast.error('The first business day number must be 1 or more.');
              return;
            }
            if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
              toast.error('The rollover hour must be between 0 and 23.');
              return;
            }
            if (!Number.isInteger(padding) || padding < 3 || padding > 10) {
              toast.error('Bill numbers can have between 3 and 10 digits.');
              return;
            }
            const button = event.currentTarget;
            button.disabled = true;
            try {
              await saveSettings({
                businessDayStartNumber: start,
                dayRolloverHour: hour,
                orderPrefix: orderPrefix.input.value.trim() || 'ORD-',
                orderNumberPadding: padding,
              });
              toast.success('Day settings saved.');
            } catch (error) {
              reportError(error);
            } finally {
              button.disabled = false;
            }
          },
        }),
      ]),
    ]),
    dayList,
  ]);

  /* ------------------------------------------------------------- users --- */

  const usersTable = el('div.stack');

  function paintUsers(rows) {
    clear(usersTable).appendChild(
      el('div.table', {}, [
        el('div.table__head.table__head--users', {}, [
          el('span', { text: 'User' }),
          el('span', { text: 'Role' }),
          el('span', { text: 'Status' }),
          el('span', { text: '' }),
        ]),
        ...rows.map((user) =>
          el('div.table__row.table__row--users', {}, [
            el('span', {}, [
              el('strong', { text: user.displayName || user.username }),
              el('span.hint', { text: user.username }),
            ]),
            el('span', { text: user.role === 'admin' ? 'Admin' : 'Cashier' }),
            el('span', { text: user.active === false ? 'Disabled' : 'Active' }),
            el('span.table__actions', {}, [
              el('button.btn.btn--ghost.btn--sm', {
                type: 'button',
                text: 'Password',
                onclick: () => changePassword(user),
              }),
              el('button.btn.btn--ghost.btn--sm', {
                type: 'button',
                text: user.active === false ? 'Enable' : 'Disable',
                onclick: async () => {
                  try {
                    await usersRepo.setUserActive(user.username, user.active === false);
                    paintUsers(await usersRepo.listUsers());
                    toast.success(`${user.username} updated.`);
                  } catch (error) {
                    reportError(error);
                  }
                },
              }),
              el('button.icon-btn.icon-btn--danger', {
                type: 'button',
                text: '×',
                'aria-label': `Delete ${user.username}`,
                onclick: async () => {
                  const ok = await confirmDialog({
                    title: `Delete ${user.username}?`,
                    message: 'Past bills keep the cashier name that rang them up.',
                    confirmLabel: 'Delete user',
                    tone: 'danger',
                  });
                  if (!ok) return;
                  try {
                    await usersRepo.deleteUser(user.username);
                    paintUsers(await usersRepo.listUsers());
                    toast.success('User deleted.');
                  } catch (error) {
                    reportError(error);
                  }
                },
              }),
            ]),
          ])
        ),
      ])
    );
  }
  paintUsers(users);

  function changePassword(user) {
    const password = el('input.input', { type: 'password', autocomplete: 'new-password' });
    const repeat = el('input.input', { type: 'password', autocomplete: 'new-password' });
    const modal = openModal({
      title: `New password for ${user.username}`,
      size: 'sm',
      body: el('div.stack', {}, [
        el('label.field', {}, [el('span.field__label', { text: 'Password' }), password]),
        el('label.field', {}, [el('span.field__label', { text: 'Repeat password' }), repeat]),
        el('p.hint', { text: 'At least 6 characters.' }),
      ]),
      actions: [
        el('button.btn.btn--ghost', { type: 'button', text: 'Cancel', onclick: () => modal.close() }),
        el('button.btn.btn--primary', {
          type: 'button',
          text: 'Set password',
          onclick: async () => {
            if (password.value !== repeat.value) {
              toast.error('The two passwords do not match.');
              return;
            }
            try {
              await usersRepo.changePassword(user.username, password.value);
              toast.success(`Password updated for ${user.username}.`);
              modal.close();
            } catch (error) {
              reportError(error);
            }
          },
        }),
      ],
    });
  }

  function addUser() {
    const username = el('input.input', { type: 'text', autocapitalize: 'none', spellcheck: false });
    const displayName = el('input.input', { type: 'text' });
    const role = el('select.input', {}, [
      el('option', { value: 'cashier', text: 'Cashier' }),
      el('option', { value: 'admin', text: 'Admin' }),
    ]);
    const password = el('input.input', { type: 'password', autocomplete: 'new-password' });

    const modal = openModal({
      title: 'Add a user',
      size: 'sm',
      body: el('div.stack', {}, [
        el('label.field', {}, [el('span.field__label', { text: 'Username' }), username]),
        el('label.field', {}, [el('span.field__label', { text: 'Display name' }), displayName]),
        el('label.field', {}, [el('span.field__label', { text: 'Role' }), role]),
        el('label.field', {}, [el('span.field__label', { text: 'Password' }), password]),
      ]),
      actions: [
        el('button.btn.btn--ghost', { type: 'button', text: 'Cancel', onclick: () => modal.close() }),
        el('button.btn.btn--primary', {
          type: 'button',
          text: 'Add user',
          onclick: async () => {
            try {
              await usersRepo.createUser({
                username: username.value,
                displayName: displayName.value || username.value,
                role: role.value,
                password: password.value,
              });
              paintUsers(await usersRepo.listUsers());
              toast.success('User added.');
              modal.close();
            } catch (error) {
              reportError(error);
            }
          },
        }),
      ],
    });
  }

  /* ------------------------------------------------------------- stock --- */

  const stockTracking = checkField(
    'Take ingredients off the shelf when something sells',
    settings.stockTrackingEnabled,
    'Only affects menu items that have a recipe. Everything else sells exactly as before.'
  );
  const blockOutOfStock = checkField(
    'Refuse a sale when an ingredient has run out',
    settings.blockSalesWhenOutOfStock,
    'Off by default. A customer is standing at the counter, so the usual answer is to warn and let the sale through.'
  );

  const stockForm = el('div.formgrid', {}, [
    stockTracking.field,
    blockOutOfStock.field,
    el('div.form__actions', {}, [
      el('button.btn.btn--primary', {
        type: 'button',
        text: 'Save stock settings',
        onclick: async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          try {
            await saveSettings({
              stockTrackingEnabled: stockTracking.input.checked,
              blockSalesWhenOutOfStock: blockOutOfStock.input.checked,
            });
            toast.success('Stock settings saved.');
          } catch (error) {
            reportError(error);
          } finally {
            button.disabled = false;
          }
        },
      }),
    ]),
  ]);

  /* -------------------------------------------------------- QR ordering --- */

  const qrEnabled = checkField(
    'Use table QR codes',
    settings.qrOrderingEnabled,
    'Switches on the Orders screen and makes table codes work.'
  );
  const qrAcceptsOrders = checkField(
    'Let customers send an order from their phone',
    settings.qrOrderingAcceptsOrders,
    'Turn this off to use the codes as a menu only.'
  );
  const qrNote = textField('Message shown after ordering', settings.qrOrderNote, {
    placeholder: 'A member of staff will bring your order over.',
  });
  const siteUrl = textField('Public web address', settings.publicSiteUrl, {
    placeholder: tablesRepo.siteBaseUrl(),
    hint: 'Leave blank and the QR codes use whatever address this page is open at, which is almost always right.',
  });

  const qrForm = el('div.formgrid', {}, [
    qrEnabled.field,
    qrAcceptsOrders.field,
    qrNote.field,
    siteUrl.field,
    el('div.form__actions', {}, [
      el('button.btn.btn--primary', {
        type: 'button',
        text: 'Save QR settings',
        onclick: async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          try {
            const url = siteUrl.input.value.trim();
            if (url && !/^https?:\/\//i.test(url)) {
              toast.error('The web address must start with http:// or https://');
              return;
            }
            await saveSettings({
              qrOrderingEnabled: qrEnabled.input.checked,
              qrOrderingAcceptsOrders: qrAcceptsOrders.input.checked,
              qrOrderNote: qrNote.input.value.trim(),
              publicSiteUrl: url,
            });
            toast.success('QR settings saved. Reprint table cards if the address changed.');
          } catch (error) {
            reportError(error);
          } finally {
            button.disabled = false;
          }
        },
      }),
    ]),
  ]);

  /* ------------------------------------------------------ live ordering --- */

  const cloudEnabled = checkField(
    'Send orders straight to this counter',
    settings.cloudSyncEnabled,
    'Without this, an order from a customer’s phone is handed over as a code the counter scans.'
  );
  const cloudUrl = textField('Project URL', settings.cloudSyncUrl, {
    placeholder: 'https://xxxxxxxx.supabase.co',
  });
  const cloudKey = textField('Public API key', settings.cloudSyncKey, {
    placeholder: 'The anon public key',
    hint: 'Use the anon public key, never the service role key.',
  });
  const cloudTable = textField('Table name', settings.cloudSyncTable, { placeholder: 'tbc_sync' });
  const cloudPoll = textField('Check for orders every (seconds)', settings.cloudSyncPollSeconds, {
    inputmode: 'numeric',
  });
  const cloudResult = el('p.hint');

  const cloudForm = el('div.formgrid', {}, [
    cloudEnabled.field,
    cloudUrl.field,
    cloudKey.field,
    cloudTable.field,
    cloudPoll.field,
    cloudResult,
    el('div.form__actions', {}, [
      el('button.btn.btn--ghost', {
        type: 'button',
        text: 'Test connection',
        onclick: async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          cloudResult.textContent = 'Checking…';
          cloudResult.className = 'hint';
          try {
            const result = await testConnection({
              url: cloudUrl.input.value.trim().replace(/\/+$/, ''),
              key: cloudKey.input.value.trim(),
              table: cloudTable.input.value.trim() || 'tbc_sync',
            });
            cloudResult.textContent = result.message;
            cloudResult.className = result.ok ? 'hint is-positive' : 'hint is-negative';
          } finally {
            button.disabled = false;
          }
        },
      }),
      el('button.btn.btn--primary', {
        type: 'button',
        text: 'Save live ordering',
        onclick: async (event) => {
          const seconds = Number(cloudPoll.input.value);
          if (!Number.isInteger(seconds) || seconds < 5 || seconds > 600) {
            toast.error('Check for orders every 5 to 600 seconds.');
            return;
          }
          const button = event.currentTarget;
          button.disabled = true;
          try {
            await saveSettings({
              cloudSyncEnabled: cloudEnabled.input.checked,
              cloudSyncUrl: cloudUrl.input.value.trim().replace(/\/+$/, ''),
              cloudSyncKey: cloudKey.input.value.trim(),
              cloudSyncTable: cloudTable.input.value.trim() || 'tbc_sync',
              cloudSyncPollSeconds: seconds,
            });
            toast.success('Live ordering saved. Reload the page to start collecting orders.');
          } catch (error) {
            reportError(error);
          } finally {
            button.disabled = false;
          }
        },
      }),
    ]),
  ]);

  /* ------------------------------------------------------------- shifts --- */

  const shiftStart = textField('Default shift start', settings.defaultShiftStart, {
    placeholder: '09:00',
  });
  const shiftEnd = textField('Default shift finish', settings.defaultShiftEnd, {
    placeholder: '17:00',
  });
  const breakMinutes = textField('Default unpaid break (minutes)', settings.defaultBreakMinutes, {
    inputmode: 'numeric',
  });

  const shiftForm = el('div.formgrid', {}, [
    shiftStart.field,
    shiftEnd.field,
    breakMinutes.field,
    el('div.form__actions', {}, [
      el('button.btn.btn--primary', {
        type: 'button',
        text: 'Save shift defaults',
        onclick: async (event) => {
          const isTime = (value) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(value).trim());
          if (!isTime(shiftStart.input.value) || !isTime(shiftEnd.input.value)) {
            toast.error('Enter shift times as HH:MM, for example 09:00.');
            return;
          }
          const minutes = Number(breakMinutes.input.value);
          if (!Number.isInteger(minutes) || minutes < 0 || minutes > 480) {
            toast.error('The default break must be between 0 and 480 minutes.');
            return;
          }
          const button = event.currentTarget;
          button.disabled = true;
          try {
            await saveSettings({
              defaultShiftStart: shiftStart.input.value.trim(),
              defaultShiftEnd: shiftEnd.input.value.trim(),
              defaultBreakMinutes: minutes,
            });
            toast.success('Shift defaults saved.');
          } catch (error) {
            reportError(error);
          } finally {
            button.disabled = false;
          }
        },
      }),
    ]),
  ]);

  /* ------------------------------------------------------------ backup --- */

  const restoreInput = el('input', {
    type: 'file',
    accept: 'application/json,.json',
    hidden: true,
    onchange: async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      try {
        const inspected = await inspectBackup(file);
        const ok = await confirmDialog({
          title: 'Restore this backup?',
          message:
            'Everything currently on this device is replaced. A safety copy of the current data downloads first.',
          detail: `Backup from ${formatDateTime(inspected.exportedAt)} · ${
            inspected.counts.transactions
          } bills · ${inspected.counts.menu} menu items${
            inspected.range ? ` · ${inspected.range.from} to ${inspected.range.to}` : ''
          }`,
          confirmLabel: 'Replace and restore',
          tone: 'danger',
        });
        if (!ok) return;
        const result = await restoreBackup(inspected);
        toast.success(`Restored ${result.counts.transactions} bills. Safety copy: ${result.safetyName}`);
        setTimeout(() => window.location.reload(), 1200);
      } catch (error) {
        reportError(error);
      }
    },
  });

  const backupBody = el('div.stack', {}, [
    el('div.actionrow', {}, [
      el('button.btn.btn--primary', {
        type: 'button',
        text: 'Export backup',
        onclick: async () => {
          try {
            const result = await exportBackup();
            toast.success(`${result.filename} downloaded.`);
          } catch (error) {
            reportError(error);
          }
        },
      }),
      el('button.btn.btn--ghost', {
        type: 'button',
        text: 'Restore from backup',
        onclick: () => restoreInput.click(),
      }),
      restoreInput,
    ]),
    el('p.callout', {
      text:
        'This deployment uses local browser storage. Data created on one device will not automatically appear on another device. Move data with a backup file, and take a backup at the end of each trading day.',
    }),
  ]);

  /* ------------------------------------------------------- maintenance --- */

  const storageLine = estimate
    ? `${(estimate.usage / 1048576).toFixed(1)} MB used of roughly ${(
        estimate.quota / 1048576
      ).toFixed(0)} MB available`
    : 'Storage usage is not reported by this browser.';

  const maintenance = el('div.stack', {}, [
    el('div.metrics', {}, [
      el('div.metric', {}, [
        el('span.metric__label', { text: 'Bills stored' }),
        el('span.metric__value', { text: String(transactionCount) }),
      ]),
      el('div.metric', {}, [
        el('span.metric__label', { text: 'Menu items' }),
        el('span.metric__value', { text: String(menuRepo.getMenu().length) }),
      ]),
      el('div.metric', {}, [
        el('span.metric__label', { text: 'Trading days' }),
        el('span.metric__value', { text: String(days.length) }),
      ]),
      el('div.metric', {}, [
        el('span.metric__label', { text: 'App version' }),
        el('span.metric__value', { text: APP.version }),
      ]),
    ]),
    el('p.panel__line', { text: storageLine }),
    el('div.actionrow', {}, [
      el('button.btn.btn--ghost', {
        type: 'button',
        text: 'Keep data on this device',
        onclick: async () => {
          const granted = await requestPersistentStorage();
          if (granted) toast.success('This browser will keep the cafe data even when storage is tight.');
          else toast.info('The browser did not grant persistent storage. Keep taking daily backups.');
        },
      }),
      el('button.btn.btn--ghost', {
        type: 'button',
        text: 'Rebuild day totals',
        onclick: async () => {
          const ok = await confirmDialog({
            title: 'Rebuild day totals?',
            message:
              'Each trading day’s bill count and sales total is recalculated from the bills themselves. Bills are not changed.',
            confirmLabel: 'Rebuild',
          });
          if (!ok) return;
          try {
            const all = await transactionsRepo.listAll();
            const count = await daysRepo.recalculateDays(all, settings.businessDayStartNumber);
            toast.success(`${count} trading day${count === 1 ? '' : 's'} recalculated.`);
          } catch (error) {
            reportError(error);
          }
        },
      }),
      el('button.btn.btn--danger', {
        type: 'button',
        text: 'Reset menu to the menu file',
        onclick: async () => {
          const ok = await confirmDialog({
            title: 'Reset the menu?',
            message:
              'The working menu is replaced with the printed menu shipped in the app. Every price edit and item you added is lost. Past bills are untouched.',
            confirmLabel: 'Reset menu',
            tone: 'danger',
          });
          if (!ok) return;
          try {
            const count = await menuRepo.resetMenuToSeed();
            toast.success(`${count} menu items restored.`);
          } catch (error) {
            reportError(error);
          }
        },
      }),
    ]),
  ]);

  /* --------------------------------------------------------- assembly --- */

  const page = el('div.page', {}, [
    el('div.page__head', {}, [
      el('div', {}, [
        el('h1.page__title', { text: 'Settings' }),
        el('p.page__sub', {
          text: `Tax ${settings.taxEnabled ? `on at ${formatRate(settings.defaultTaxRate)}` : 'off'} · ${
            settings.discountEnabled ? 'discounts allowed' : 'discounts off'
          }`,
        }),
      ]),
    ]),
    el('div.panels', {}, [
      section('Cafe details', 'Printed on every bill and shown on the sign-in screen.', detailsForm),
      section('Billing rules', 'Applied to new bills only. Past bills keep the rules they were rung up under.', billingForm),
      section('Business days and bill numbers', 'Day numbering follows trading days, not calendar days.', dayForm),
      section(
        'Users',
        'Cashiers can take orders and payments. Admins can also change the menu, settings and exports.',
        el('div.stack', {}, [
          el('div.actionrow', {}, [
            el('button.btn.btn--primary', { type: 'button', text: 'Add user', onclick: addUser }),
          ]),
          usersTable,
        ])
      ),
      section(
        'Stock',
        'Recipes are set up on the Stock screen. These switches decide what a sale does with them.',
        stockForm
      ),
      section(
        'QR ordering',
        'Table codes are generated on the Tables screen. Publish the menu from the Menu screen after changing prices.',
        qrForm
      ),
      section(
        'Live ordering',
        'Optional. Without it the app runs entirely on this device and orders are handed over as a code. With it, an order sent from any phone lands on this counter by itself. Setup takes about five minutes — the steps are in the README.',
        cloudForm
      ),
      section('Shift defaults', 'Used when a new shift or attendance record is created.', shiftForm),
      section('Backup and restore', null, backupBody),
      section('Storage and maintenance', null, maintenance),
    ]),
  ]);

  clear(outlet).appendChild(page);
}
