/**
 * ---------------------------------------------------------------------------
 * SABA — shared configuration and vocabulary
 * ---------------------------------------------------------------------------
 * This module is loaded by BOTH the server and the browser. It therefore
 * contains no DOM, no Node APIs and no secrets — only the vocabulary the two
 * sides have to agree on: roles, stations, courses, order and docket states,
 * payment methods, and the default charge rules.
 *
 * Anything an operator can change at run time (the restaurant's name, its tax
 * rates, its station targets) lives in the `settings` table in the database
 * and is read through the server. The values here are the defaults a fresh
 * install starts from.
 */

export const APP = {
  name: 'Saba',
  suite: 'Saba Restaurant Suite',
  descriptor: 'Fine Dining · Billing & KOT',
  version: '2.0.0',
};

/**
 * Where the artwork lives. Everything that draws the mark reads it from here,
 * so a restaurant swapping in its own logo changes one line — and `tools/
 * make-assets.py` regenerates all three files from a single master image.
 */
export const ASSETS = {
  logo: 'assets/saba-logo.png',
  watermark: 'assets/saba-watermark.png',
  icon: 'assets/saba-icon.png',
};

/** Defaults for a fresh install. Editable from Setup once running. */
export const RESTAURANT = {
  name: 'Saba',
  legalName: 'Saba Fine Dine',
  tagline: 'Fine Dine · Since 1975',
  addressLines: ['12 Rose Court, Kala Ghoda', 'Fort, Mumbai 400 001'],
  phone: '+91 22 4000 7722',
  email: 'reserve@saba.restaurant',
  gstin: '27AABCS1429P1ZQ',
  fssai: '11522998000234',
  currency: '₹',
  /** Used only for number grouping (1,20,000 rather than 120,000). */
  locale: 'en-IN',
};

/* ------------------------------------------------------------------ tax --- */

/**
 * Rates are basis points (250 = 2.50%) so every figure stays an integer until
 * the moment it is shown. See shared/money.js for why that matters.
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
  /** The bill total is rounded to the nearest rupee and the delta is shown. */
  roundOffEnabled: true,
  maxDiscountPercent: 100,
  /** Discounts above this need a manager's PIN. */
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

export const ROLE_ORDER = ['manager', 'captain', 'cashier', 'kitchen'];

/**
 * What each role may reach. The browser only draws what the signed-in role can
 * open — and, far more importantly, the server refuses anything not listed
 * here. The client-side check is a courtesy; the server-side one is the rule.
 */
export const ROLE_ROUTES = {
  manager: ['/floor', '/order', '/kds', '/bill', '/reservations', '/reports', '/menu', '/settings'],
  captain: ['/floor', '/order', '/kds', '/bill', '/reservations'],
  cashier: ['/floor', '/order', '/bill', '/reports'],
  kitchen: ['/kds'],
};

/** Abilities finer-grained than a whole screen. Enforced on the server. */
export const ROLE_ABILITIES = {
  manager: ['void', 'discount', 'comp', 'reopen', 'settings', 'eightySix',
    'reprint', 'users', 'shift', 'export', 'backup'],
  captain: ['eightySix', 'reprint'],
  cashier: ['discount', 'reprint', 'shift', 'export'],
  kitchen: [],
};

export const can = (role, ability) =>
  (ROLE_ABILITIES[role] || []).includes(ability);

export const mayOpen = (role, path) =>
  (ROLE_ROUTES[role] || []).includes(path);

/** The first screen a role should land on after signing in. */
export const homeFor = (role) => (ROLE_ROUTES[role] || ['/floor'])[0];

/* ------------------------------------------------------------- kitchen --- */

/**
 * Every menu item is routed to exactly one station. A KOT that spans stations
 * is split into one printed docket per station, which is how a real pass
 * works: the tandoor never sees the dessert line.
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
  HELD: 'Held', FIRED: 'In kitchen', READY: 'Ready on pass',
  SERVED: 'Served', VOID: 'Voided',
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

export const COMP_REASONS = [
  'Anniversary / celebration',
  'Long wait',
  'Quality issue',
  'Regular guest',
  'Manager’s discretion',
];

export const DISCOUNT_REASONS = [
  'Loyalty / regular guest',
  'Set menu pricing',
  'Service recovery',
  'Staff or family',
  'Promotional offer',
  'Manager’s discretion',
];

/* --------------------------------------------------------------- floor --- */

export const TABLE_STATUS = {
  VACANT: 'VACANT',
  RESERVED: 'RESERVED',
  SEATED: 'SEATED',       // guests down, nothing in the kitchen
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
  { id: 'CASH', label: 'Cash', icon: 'cash', countsToDrawer: true },
  { id: 'CARD', label: 'Card', icon: 'card', countsToDrawer: false },
  { id: 'UPI', label: 'UPI', icon: 'upi', countsToDrawer: false },
  { id: 'ROOM', label: 'Room Charge', icon: 'room', countsToDrawer: false },
  { id: 'VOUCHER', label: 'Voucher', icon: 'voucher', countsToDrawer: false },
];

export const paymentLabel = (id) =>
  PAYMENT_METHODS.find((m) => m.id === id)?.label || id;

export const paymentById = (id) => PAYMENT_METHODS.find((m) => m.id === id);

/** Preset tip percentages offered on the settle screen. */
export const TIP_PRESETS = [0, 5, 10, 15];

/* ------------------------------------------------------------- dietary --- */

export const DIET_TAGS = {
  VEG: { id: 'VEG', label: 'Vegetarian', mark: 'veg' },
  NONVEG: { id: 'NONVEG', label: 'Non-vegetarian', mark: 'nonveg' },
  VEGAN: { id: 'VEGAN', label: 'Vegan', mark: 'vegan' },
};

export const ALLERGENS = {
  N: 'Nuts', D: 'Dairy', G: 'Gluten', S: 'Shellfish',
  E: 'Egg', SE: 'Sesame', SO: 'Soy',
};

/** Order numbering. SAB-0148 style, continuing across business days. */
export const NUMBERING = {
  orderPrefix: 'SAB',
  invoicePrefix: 'INV',
  kotPrefix: 'K',
  padding: 4,
};

/* ------------------------------------------------------------ business --- */

/**
 * The hour a business day rolls over. A restaurant trading past midnight wants
 * a 1 a.m. sale on the night it belongs to, not on the next morning's report.
 */
export const DAY_ROLLOVER_HOUR = 5;

/** How long a terminal may sit signed in with no activity. */
export const SESSION_HOURS = 14;

/** Wrong PINs in a row before that account is locked for a minute. */
export const PIN_ATTEMPT_LIMIT = 5;
export const PIN_LOCKOUT_SECONDS = 60;
