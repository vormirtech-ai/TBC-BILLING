/**
 * ---------------------------------------------------------------------------
 * SINGLE SOURCE OF CONFIGURATION
 * ---------------------------------------------------------------------------
 * Everything an operator normally needs to change before deploying lives here.
 *
 * SECURITY NOTE (read this):
 * This app is 100% client-side. The accounts below are seeded into the local
 * browser database on first run and passwords are stored as salted SHA-256
 * hashes. That stops casual shoulder-surfing and stops a cashier from wandering
 * into admin screens. It is NOT protection against a technically skilled person
 * with access to the device — anyone who can open DevTools can read local data.
 * Do not reuse a password here that you use anywhere else, and change the
 * defaults from Settings → Users after the first login.
 */

export const APP = {
  name: 'The Baruch Cafe POS',
  shortName: 'TBC POS',
  version: '1.0.0',
  /** Bump this only if the local database schema changes. */
  dbName: 'tbc-pos',
  dbVersion: 1,
};

/** Accounts created the first time the app runs on a device. */
export const DEFAULT_USERS = [
  {
    username: 'admin',
    displayName: 'Manager',
    role: 'admin',
    password: 'baruch@2026',
  },
  {
    username: 'cashier',
    displayName: 'Counter 1',
    role: 'cashier',
    password: 'cafe@1234',
  },
];

/** Defaults for the settings record. Admin can edit all of these in the UI. */
export const DEFAULT_SETTINGS = {
  cafeName: 'The Baruch Cafe',
  tagline: 'Coffee • Eats • Community',
  address: 'Add your cafe address in Settings',
  phone: '',
  gstin: '',
  currencySymbol: '₹',

  taxEnabled: false,
  taxLabel: 'GST',
  defaultTaxRate: 500, // basis points: 500 = 5.00%
  priceIncludesTax: false,

  discountEnabled: true,
  maxDiscountPercent: 100,
  roundOffEnabled: false,

  receiptFooter: 'Thank you for visiting. See you again soon.',
  orderPrefix: 'ORD-',
  orderNumberPadding: 6,

  businessDayStartNumber: 1,
  /**
   * Hour (0-23) at which one business day rolls into the next. Set to 4 if the
   * cafe trades past midnight and a 1 a.m. sale should belong to the day before.
   */
  dayRolloverHour: 0,

  cashierCanViewHistory: true,
  cashierCanApplyDiscount: false,
};

export const PAYMENT_METHODS = [
  { id: 'CASH', label: 'Cash' },
  { id: 'UPI', label: 'UPI' },
  { id: 'CARD', label: 'Card' },
];

export const ROLES = { ADMIN: 'admin', CASHIER: 'cashier' };

/** "CASH" -> "Cash". Screens show the label; records store the id. */
export function paymentLabel(id) {
  return PAYMENT_METHODS.find((method) => method.id === id)?.label || id;
}
