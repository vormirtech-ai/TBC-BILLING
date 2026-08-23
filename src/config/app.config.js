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
  version: '2.0.0',
  /** Bump this only if the local database schema changes. */
  dbName: 'tbc-pos',
  /**
   * 2 added the stock, staff, table and QR-ordering stores. The upgrade only
   * creates stores that are missing, so a till already holding sales keeps
   * every bill it has when it moves up from version 1.
   */
  dbVersion: 2,
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

  /* ------------------------------------------------------------- stock --- */

  /** Sold items draw down their recipe ingredients as part of the sale. */
  stockTrackingEnabled: true,
  /** Warn, but never block a sale: a customer standing at the counter wins. */
  blockSalesWhenOutOfStock: false,

  /* --------------------------------------------------------- QR ordering --- */

  qrOrderingEnabled: true,
  /** Customers may send an order from their phone; otherwise the QR is menu-only. */
  qrOrderingAcceptsOrders: true,
  qrOrderNote: 'A member of staff will bring your order over and take payment at the table.',
  /**
   * Public site address used when building table QR codes. Blank means "work it
   * out from the browser", which is right for every normal deployment; set it
   * only when the codes are generated somewhere other than where they are used.
   */
  publicSiteUrl: '',

  /**
   * Optional shared backend so orders from a customer's phone reach the counter
   * on a different device. Empty means the app runs entirely on-device and
   * hands orders over with a code instead. See README, "Live QR ordering".
   */
  cloudSyncEnabled: false,
  cloudSyncUrl: '',
  cloudSyncKey: '',
  cloudSyncTable: 'tbc_sync',
  /** Seconds between checks for new orders when cloud sync is on. */
  cloudSyncPollSeconds: 10,

  /* ------------------------------------------------------------- staff --- */

  /** Shift length used when a new shift is added to the roster. */
  defaultShiftStart: '09:00',
  defaultShiftEnd: '17:00',
  /** Unpaid break subtracted from a shift when hours are totalled. */
  defaultBreakMinutes: 30,
};

export const PAYMENT_METHODS = [
  { id: 'CASH', label: 'Cash' },
  { id: 'UPI', label: 'UPI' },
  { id: 'CARD', label: 'Card' },
];

export const ROLES = { ADMIN: 'admin', CASHIER: 'cashier' };

/** Units a stock item can be counted in. */
export const STOCK_UNITS = [
  { id: 'g', label: 'grams', step: 1 },
  { id: 'kg', label: 'kilograms', step: 0.1 },
  { id: 'ml', label: 'millilitres', step: 1 },
  { id: 'l', label: 'litres', step: 0.1 },
  { id: 'pc', label: 'pieces', step: 1 },
  { id: 'pkt', label: 'packets', step: 1 },
];

export function stockUnitLabel(id) {
  return STOCK_UNITS.find((unit) => unit.id === id)?.label || id;
}

/** Why a stock level changed. Every movement carries one of these. */
export const STOCK_MOVEMENT_KINDS = {
  RECEIVED: 'RECEIVED',
  SALE: 'SALE',
  WASTAGE: 'WASTAGE',
  CORRECTION: 'CORRECTION',
  OPENING: 'OPENING',
  SALE_REVERSAL: 'SALE_REVERSAL',
};

/** Where an order came from. Counter orders are rung up by staff as before. */
export const ORDER_SOURCES = { COUNTER: 'COUNTER', QR: 'QR' };

/**
 * Life of an order that arrives from a table QR code.
 * NEW → ACCEPTED → BILLED, or NEW → REJECTED.
 */
export const ONLINE_ORDER_STATUS = {
  NEW: 'NEW',
  ACCEPTED: 'ACCEPTED',
  BILLED: 'BILLED',
  REJECTED: 'REJECTED',
};

/** What a table is doing right now. Derived from open orders and bills. */
export const TABLE_STATUS = {
  FREE: 'FREE',
  SEATED: 'SEATED',
  ORDERED: 'ORDERED',
};

/** Attendance states an admin can set on the roster. */
export const ATTENDANCE_STATUS = {
  PRESENT: 'PRESENT',
  ABSENT: 'ABSENT',
  LEAVE: 'LEAVE',
  WEEKLY_OFF: 'WEEKLY_OFF',
};

export const ATTENDANCE_LABELS = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LEAVE: 'On leave',
  WEEKLY_OFF: 'Weekly off',
};

/** "CASH" -> "Cash". Screens show the label; records store the id. */
export function paymentLabel(id) {
  return PAYMENT_METHODS.find((method) => method.id === id)?.label || id;
}
