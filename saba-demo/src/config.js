/**
 * ---------------------------------------------------------------------------
 * SABA — single source of configuration
 * ---------------------------------------------------------------------------
 * Everything an operator would change before a real install lives here, so the
 * rest of the app never hard-codes a tax rate, a station name or a job title.
 *
 * DEMO BUILD NOTE
 * This package is a presentation build. It runs entirely on the device with no
 * server and no network calls of any kind, and the four sign-in PINs below are
 * printed on the lock screen on purpose so anyone can walk through the system.
 * A production install replaces them with per-person credentials.
 */

export const APP = {
  name: 'Saba',
  suite: 'Saba Restaurant Suite',
  descriptor: 'Fine Dining · Billing & KOT',
  version: '1.0.0-demo',
  /** Namespace for everything this build writes to local storage. */
  storageKey: 'saba.demo.v1',
  demoMode: true,
};

/**
 * Where the artwork lives. Everything that draws the logo reads it from here,
 * so a restaurant swapping in its own mark changes one line — and so the
 * single-file build has exactly one string to inline.
 */
export const ASSETS = {
  logo: 'assets/saba-logo.svg',
  watermark: 'assets/saba-watermark.svg',
};

/** Printed on every bill. Editable from Settings inside the demo. */
export const RESTAURANT = {
  name: 'Saba',
  tagline: 'Fine Dining · Levantine & Persian Kitchen',
  addressLines: ['12 Rose Court, Kala Ghoda', 'Fort, Mumbai 400 001'],
  phone: '+91 22 4000 7722',
  email: 'reserve@saba.restaurant',
  gstin: '27AABCS1429P1ZQ',
  fssai: '11522998000234',
  currency: '₹',
  /** ISO code, used only for number grouping (1,20,000 vs 120,000). */
  locale: 'en-IN',
};

/* ------------------------------------------------------------------ tax --- */

/**
 * Rates are basis points (250 = 2.50%) so every figure stays an integer until
 * the moment it is shown. See core/money.js for why that matters.
 */
export const CHARGES = {
  serviceChargeBps: 1000, // 10.00%, applied before tax, removable per bill
  serviceChargeLabel: 'Service Charge',
  serviceChargeOptional: true,
  taxComponents: [
    { id: 'CGST', label: 'CGST', bps: 250 },
    { id: 'SGST', label: 'SGST', bps: 250 },
  ],
  /** Menu prices are exclusive of tax; tax is added at settlement. */
  pricesIncludeTax: false,
  /** Bill total is rounded to the nearest rupee and the delta is shown. */
  roundOffEnabled: true,
  maxDiscountPercent: 100,
  /** Discounts above this need a manager PIN. */
  discountApprovalPercent: 15,
};

/* ---------------------------------------------------------------- roles --- */

export const ROLES = {
  MANAGER: 'manager',
  CAPTAIN: 'captain',
  CASHIER: 'cashier',
  KITCHEN: 'kitchen',
};

export const ROLE_LABELS = {
  manager: 'Restaurant Manager',
  captain: 'Captain',
  cashier: 'Cashier',
  kitchen: 'Kitchen',
};

/**
 * What each role may reach. The router refuses anything not listed, and the
 * navigation only draws what the signed-in role can actually open.
 */
export const ROLE_ROUTES = {
  manager: ['/floor', '/order', '/kds', '/bill', '/reservations', '/reports', '/menu', '/settings'],
  captain: ['/floor', '/order', '/kds', '/bill', '/reservations'],
  cashier: ['/floor', '/order', '/bill', '/reports'],
  kitchen: ['/kds'],
};

/** Abilities that are finer-grained than a whole screen. */
export const ROLE_ABILITIES = {
  manager: ['void', 'discount', 'comp', 'reopen', 'settings', 'eightySix', 'reprint'],
  captain: ['eightySix', 'reprint'],
  cashier: ['discount', 'reprint'],
  kitchen: [],
};

export const DEMO_USERS = [
  { id: 'u1', pin: '1111', name: 'Farid Naqvi', initials: 'FN', role: ROLES.MANAGER },
  { id: 'u2', pin: '2222', name: 'Alina Rahman', initials: 'AR', role: ROLES.CAPTAIN },
  { id: 'u3', pin: '3333', name: 'Devesh Kamat', initials: 'DK', role: ROLES.CASHIER },
  { id: 'u4', pin: '4444', name: 'Pass — Hot Range', initials: 'HR', role: ROLES.KITCHEN },
];

/* ------------------------------------------------------------- kitchen --- */

/**
 * Every menu item is routed to exactly one station. A KOT that spans stations
 * is split into one printed docket per station, which is how a real pass works:
 * the tandoor never sees the dessert line.
 */
export const STATIONS = [
  { id: 'HOT', label: 'Hot Range', short: 'HOT', slaMinutes: 18 },
  { id: 'TANDOOR', label: 'Tandoor & Grill', short: 'TAN', slaMinutes: 16 },
  { id: 'COLD', label: 'Cold Larder', short: 'CLD', slaMinutes: 8 },
  { id: 'PASTRY', label: 'Pastry', short: 'PST', slaMinutes: 12 },
  { id: 'BAR', label: 'Bar', short: 'BAR', slaMinutes: 6 },
];

export const stationById = (id) => STATIONS.find((s) => s.id === id) || STATIONS[0];

/**
 * Courses drive the pass. Items are held against a course and only reach the
 * kitchen when that course is fired, so a table's mains are not cooking while
 * they are still on the starters.
 */
export const COURSES = [
  { id: 'AMUSE', label: 'Amuse-Bouche', short: 'Amuse', seq: 1 },
  { id: 'STARTER', label: 'Starters', short: 'Starters', seq: 2 },
  { id: 'MAIN', label: 'Main Course', short: 'Mains', seq: 3 },
  { id: 'DESSERT', label: 'Dessert', short: 'Dessert', seq: 4 },
  { id: 'BEVERAGE', label: 'Beverages', short: 'Drinks', seq: 5 },
];

export const courseById = (id) => COURSES.find((c) => c.id === id) || COURSES[2];

/** Life of a kitchen docket. */
export const KOT_STATUS = {
  HELD: 'HELD',       // written on the order, not yet sent
  FIRED: 'FIRED',     // printed at the station, cooking
  READY: 'READY',     // on the pass, waiting for a runner
  SERVED: 'SERVED',   // on the table
  VOID: 'VOID',       // cancelled, with a reason and an approver
};

export const KOT_STATUS_LABELS = {
  HELD: 'Held', FIRED: 'In kitchen', READY: 'Ready on pass', SERVED: 'Served', VOID: 'Voided',
};

/** Reasons a docket or a line can be killed. Free text is never enough for audit. */
export const VOID_REASONS = [
  'Guest changed order',
  'Ordered in error',
  'Item unavailable (86)',
  'Quality — remade',
  'Excessive wait',
  'Manager compliment',
];

/* --------------------------------------------------------------- floor --- */

export const TABLE_STATUS = {
  VACANT: 'VACANT',
  RESERVED: 'RESERVED',
  SEATED: 'SEATED',       // guests down, nothing ordered
  ORDERED: 'ORDERED',     // food in the kitchen
  SERVED: 'SERVED',       // everything delivered
  BILLED: 'BILLED',       // bill printed, awaiting payment
  CLEANING: 'CLEANING',   // paid, being reset
};

export const TABLE_STATUS_LABELS = {
  VACANT: 'Vacant', RESERVED: 'Reserved', SEATED: 'Seated', ORDERED: 'In kitchen',
  SERVED: 'Served', BILLED: 'Bill printed', CLEANING: 'Clearing',
};

/* ------------------------------------------------------------- payment --- */

export const PAYMENT_METHODS = [
  { id: 'CASH', label: 'Cash', icon: 'cash' },
  { id: 'CARD', label: 'Card', icon: 'card' },
  { id: 'UPI', label: 'UPI', icon: 'upi' },
  { id: 'ROOM', label: 'Room Charge', icon: 'room' },
  { id: 'VOUCHER', label: 'Voucher', icon: 'voucher' },
];

export const paymentLabel = (id) =>
  PAYMENT_METHODS.find((m) => m.id === id)?.label || id;

/** Preset tip percentages offered on the settle screen. */
export const TIP_PRESETS = [0, 5, 10, 15];

/* ------------------------------------------------------------- dietary --- */

export const DIET_TAGS = {
  VEG: { id: 'VEG', label: 'Vegetarian', mark: 'veg' },
  NONVEG: { id: 'NONVEG', label: 'Non-vegetarian', mark: 'nonveg' },
  VEGAN: { id: 'VEGAN', label: 'Vegan', mark: 'vegan' },
};

export const ALLERGENS = {
  N: 'Nuts', D: 'Dairy', G: 'Gluten', S: 'Shellfish', E: 'Egg', SE: 'Sesame', SO: 'Soy',
};

/** Order numbering. SAB-000148 style, reset per business day. */
export const NUMBERING = {
  orderPrefix: 'SAB',
  invoicePrefix: 'INV',
  kotPrefix: 'K',
  padding: 4,
};
