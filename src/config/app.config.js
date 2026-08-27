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
  version: '3.0.0',
  /** Bump this only if the local database schema changes. */
  dbName: 'tbc-pos',
  /**
   * 2 added the stock, staff, table and QR-ordering stores. 3 added the sync
   * outbox and relaxed the bill-number index. 4 added the customer book. The
   * upgrade only creates stores that are missing, so a till already holding
   * sales keeps every bill it has however far back it is coming from.
   */
  dbVersion: 4,
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

  /* ---------------------------------------------------------- regulars --- */

  /** Bills can be attached to a customer, so the cafe knows who its regulars are. */
  customerTrackingEnabled: true,
  /** Ask for a phone number at the counter rather than leaving it to be remembered. */
  askForCustomerAtCounter: true,

  /** Streak and birthday treats. Switch off and the customer book still works. */
  loyaltyEnabled: true,
  /**
   * Days in a row a customer has to come in to earn a free drink. Days the
   * cafe was shut do not break a streak — see loyalty.service.js.
   */
  loyaltyStreakDays: 5,
  loyaltyBirthdayEnabled: true,
  /** Days either side of a birthday the treat still stands. 0 = on the day. */
  loyaltyBirthdayWindowDays: 0,
  loyaltyRewardLabel: 'Free coffee',
  /** Menu categories a free drink may be taken from. */
  loyaltyRewardCategories: ['Hot', 'Iced', 'Cold Brews', "Frappe's"],
  /** Most a free drink may be worth, in paise. 0 = whatever the drink costs. */
  loyaltyRewardCap: 0,

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
 * Life of an order, whether it was taken at the counter or sent in from a
 * table's QR code.
 *
 *   NEW       a customer has asked for it; staff have not agreed to it yet.
 *             Only QR orders start here — an order taken at the counter was
 *             agreed to by the person taking it.
 *   ACCEPTED  being made.
 *   READY     made, waiting to go out.
 *   SERVED    on the table, not yet paid for.
 *   BILLED    paid for; the bill is now the record.
 *   REJECTED  turned down or cancelled.
 */
export const ONLINE_ORDER_STATUS = {
  NEW: 'NEW',
  ACCEPTED: 'ACCEPTED',
  READY: 'READY',
  SERVED: 'SERVED',
  BILLED: 'BILLED',
  REJECTED: 'REJECTED',
};

/** The same thing, under the name the rest of the app now uses. */
export const ORDER_STATUS = ONLINE_ORDER_STATUS;

/** Wording for each state, in the words a cafe would use out loud. */
export const ORDER_STATUS_LABELS = {
  NEW: 'Waiting',
  ACCEPTED: 'Being made',
  READY: 'Ready',
  SERVED: 'Served',
  BILLED: 'Billed',
  REJECTED: 'Cancelled',
};

/** Orders still on the floor — everything a board should show as live. */
export const OPEN_ORDER_STATUSES = [
  ONLINE_ORDER_STATUS.NEW,
  ONLINE_ORDER_STATUS.ACCEPTED,
  ONLINE_ORDER_STATUS.READY,
  ONLINE_ORDER_STATUS.SERVED,
];

/** What each state can move to next. Anything not listed here is not offered. */
export const ORDER_STATUS_FLOW = {
  NEW: [ONLINE_ORDER_STATUS.ACCEPTED, ONLINE_ORDER_STATUS.REJECTED],
  ACCEPTED: [ONLINE_ORDER_STATUS.READY, ONLINE_ORDER_STATUS.REJECTED],
  READY: [ONLINE_ORDER_STATUS.SERVED, ONLINE_ORDER_STATUS.ACCEPTED],
  SERVED: [ONLINE_ORDER_STATUS.READY],
  BILLED: [],
  REJECTED: [],
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
