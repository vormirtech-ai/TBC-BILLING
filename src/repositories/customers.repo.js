/**
 * The customer book.
 *
 * A cafe's regulars are the whole point of this store: who comes in, how often,
 * and when their birthday is. Everything the loyalty rules need is here as
 * plain data — the rules themselves live in loyalty.service.js, so they can be
 * read and tested without a database.
 *
 * IDENTITY IS THE PHONE NUMBER. The record's id is derived from it, so two
 * tills that both take "9876543210" while the network is down write the same
 * record rather than two half-complete ones. That is also why the phone index
 * is not unique: a duplicate would be a bug worth merging, never a reason to
 * refuse to store somebody.
 *
 * VISITS ARE DAYS, NOT BILLS. Three coffees on one afternoon is one visit. The
 * days are kept as a list of business dates, which is what makes a streak
 * something that can be worked out rather than a running total that drifts.
 */

import {
  STORES,
  getAll,
  getByKey,
  getAllByIndex,
  put,
  remove,
  putMany,
  clearStore,
  applyRemoteBatch,
  enqueueManyForSync,
} from '../db/database.js';
import { requireAdmin, requireSignedIn } from '../core/session.js';
import { AppError, matchesQuery, pad } from '../core/utils.js';

/** Days kept per customer. Two years of a daily regular, and then the oldest go. */
const MAX_VISIT_DAYS = 800;

let cache = null;
const listeners = new Set();

export function onCustomersChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function announce() {
  listeners.forEach((fn) => {
    try {
      fn(cache);
    } catch (error) {
      console.error('[TBC POS] a customer listener failed', error);
    }
  });
}

/* ---------------------------------------------------------------- phone --- */

/**
 * Reduce whatever was typed to the digits that identify the person.
 *
 * Indian numbers get written every way there is — +91 98765 43210, 098765
 * 43210, 98765-43210 — and all of them are the same customer, so the country
 * code and the trunk zero come off.
 */
export function normalisePhone(value) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length > 10 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return digits;
}

/** "9876543210" → "98765 43210". Ten-digit numbers only; anything else is left be. */
export function formatPhone(value) {
  const digits = normalisePhone(value);
  return digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
}

export function isValidPhone(value) {
  const digits = normalisePhone(value);
  return digits.length >= 7 && digits.length <= 12;
}

/** The record id for a phone number. Deterministic, so two tills agree. */
export function customerId(phone) {
  return `cus_${normalisePhone(phone)}`;
}

/* ------------------------------------------------------------- birthday --- */

/**
 * Accept a birthday the way a person would give one and store it as MM-DD.
 *
 * The year is kept separately when it is offered and ignored when it is not:
 * a free coffee depends on the day, not on anybody's age.
 *
 * @returns {{birthday:string, birthYear:number|null}}
 */
export function parseBirthday(value) {
  const text = String(value ?? '').trim();
  if (!text) return { birthday: '', birthYear: null };

  let year = null;
  let month = null;
  let day = null;

  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const dmy = text.match(/^(\d{1,2})[/\-. ](\d{1,2})(?:[/\-. ](\d{2,4}))?$/);

  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (dmy) {
    // Day first: this is how a date is written in India, and it is what the
    // date field on the customer form hands over when the year is left out.
    day = Number(dmy[1]);
    month = Number(dmy[2]);
    if (dmy[3]) {
      year = Number(dmy[3]);
      if (year < 100) year += year > 30 ? 1900 : 2000;
    }
  } else {
    throw new AppError('Write the birthday as 14/03, or 14/03/1994.', 'VALIDATION');
  }

  if (!(month >= 1 && month <= 12)) throw new AppError('That month does not exist.', 'VALIDATION');
  if (!(day >= 1 && day <= 31)) throw new AppError('That day does not exist.', 'VALIDATION');
  // 31 February is a typo, not a birthday.
  const probe = new Date(2020, month - 1, day); // a leap year, so 29 Feb survives
  if (probe.getMonth() !== month - 1 || probe.getDate() !== day) {
    throw new AppError('That date is not on the calendar.', 'VALIDATION');
  }
  if (year !== null && (year < 1900 || year > new Date().getFullYear())) {
    throw new AppError('Check the year of birth.', 'VALIDATION');
  }

  return { birthday: `${pad(month)}-${pad(day)}`, birthYear: year };
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "03-14" → "14 March". */
export function formatBirthday(birthday) {
  const parts = String(birthday || '').split('-');
  if (parts.length !== 2) return '';
  const month = Number(parts[0]);
  const day = Number(parts[1]);
  if (!(month >= 1 && month <= 12)) return '';
  return `${day} ${MONTHS[month - 1]}`;
}

/* ---------------------------------------------------------------- reads --- */

function sortCustomers(rows) {
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  return rows.sort(
    (a, b) =>
      String(b.lastVisit || '').localeCompare(String(a.lastVisit || '')) ||
      collator.compare(a.name || '', b.name || '')
  );
}

export async function loadCustomers() {
  cache = sortCustomers(await getAll(STORES.CUSTOMERS));
  announce();
  return cache;
}

export function getCustomers() {
  return cache || [];
}

/** The cached record, or null. Views paint from this. */
export function getCustomer(id) {
  return getCustomers().find((row) => row.id === id) || null;
}

/** Straight from storage, for anything about to write. */
export function readCustomer(id) {
  return getByKey(STORES.CUSTOMERS, id);
}

export async function findByPhone(phone) {
  const digits = normalisePhone(phone);
  if (!digits) return null;

  const cached = getCustomers().find((row) => row.phone === digits);
  if (cached) return cached;

  // Straight to the index: a till that has just started may not have loaded
  // the book yet, and a customer standing at the counter cannot wait for it.
  const rows = await getAllByIndex(STORES.CUSTOMERS, 'phone', digits);
  return rows[0] || (await getByKey(STORES.CUSTOMERS, customerId(digits))) || null;
}

export function searchCustomers({ query = '', limit = 0 } = {}) {
  const text = String(query || '').trim();
  const digits = normalisePhone(text);

  const rows = getCustomers().filter((row) => {
    if (!text) return true;
    if (digits && row.phone.includes(digits)) return true;
    return matchesQuery(row.name, text);
  });
  return limit > 0 ? rows.slice(0, limit) : rows;
}

/** Everyone whose birthday falls on this MM-DD. */
export function customersWithBirthday(monthDay) {
  return getCustomers().filter((row) => row.birthday === monthDay);
}

/* --------------------------------------------------------------- writes --- */

function blankCustomer(phone) {
  const now = new Date().toISOString();
  return {
    id: customerId(phone),
    phone: normalisePhone(phone),
    name: '',
    birthday: '',
    birthYear: null,
    email: '',
    notes: '',

    /** Business dates this customer came in on, oldest first. */
    visitDays: [],
    visitCount: 0,
    firstVisit: '',
    lastVisit: '',
    billCount: 0,
    totalSpend: 0,

    /** What has already been given away, so nothing is given twice. */
    rewards: { streakClaimedOn: '', birthdayClaimedYear: 0, given: 0 },

    active: true,
    createdAt: now,
    updatedAt: now,
  };
}

function cleanDraft(draft) {
  const phone = normalisePhone(draft.phone);
  if (!isValidPhone(phone)) {
    throw new AppError('Enter the customer’s phone number — it is how they are looked up.', 'VALIDATION');
  }

  const name = String(draft.name || '').trim().slice(0, 60);
  const { birthday, birthYear } = parseBirthday(draft.birthday);

  return {
    phone,
    name,
    birthday,
    birthYear,
    email: String(draft.email || '').trim().slice(0, 80),
    notes: String(draft.notes || '').trim().slice(0, 200),
  };
}

function store(record) {
  cache = sortCustomers([...getCustomers().filter((row) => row.id !== record.id), record]);
  announce();
  return record;
}

/**
 * Add somebody to the book, or fill in the blanks on a record that is already
 * there. Two cashiers adding the same regular is not an error — it is the same
 * person, and the second one is simply telling us more about them.
 */
export async function saveCustomer(draft) {
  requireSignedIn();
  const clean = cleanDraft(draft);
  const existing = await getByKey(STORES.CUSTOMERS, customerId(clean.phone));
  const now = new Date().toISOString();

  const record = {
    ...(existing || blankCustomer(clean.phone)),
    ...clean,
    id: customerId(clean.phone),
    updatedAt: now,
  };
  // Never let an edit blank out something already known unless it was meant.
  if (existing && !clean.name) record.name = existing.name;

  await put(STORES.CUSTOMERS, record);
  return store(record);
}

/**
 * Edit a customer. Changing the phone number changes who they are, so the
 * record moves to the new id with its history intact and the old id is retired.
 */
export async function updateCustomer(id, patch) {
  requireSignedIn();
  const existing = await getByKey(STORES.CUSTOMERS, id);
  if (!existing) throw new AppError('That customer is no longer in the book.', 'NOT_FOUND');

  const clean = cleanDraft({ ...existing, ...patch });
  const nextId = customerId(clean.phone);

  if (nextId !== id) {
    const clash = await getByKey(STORES.CUSTOMERS, nextId);
    if (clash) {
      throw new AppError(
        `${formatPhone(clean.phone)} already belongs to another customer.`,
        'DUPLICATE'
      );
    }
  }

  const record = { ...existing, ...clean, id: nextId, updatedAt: new Date().toISOString() };
  await put(STORES.CUSTOMERS, record);
  if (nextId !== id) await remove(STORES.CUSTOMERS, id);

  cache = sortCustomers([...getCustomers().filter((row) => row.id !== id && row.id !== nextId), record]);
  announce();
  return record;
}

export async function deleteCustomer(id) {
  requireAdmin('removing a customer');
  await remove(STORES.CUSTOMERS, id);
  cache = getCustomers().filter((row) => row.id !== id);
  announce();
  return true;
}

/**
 * Record that this customer came in.
 *
 * Called once a bill is safely saved. Re-reads the record from storage rather
 * than the cache, because the cache may be a few seconds behind another till.
 *
 * @param {{id:string, businessDate:string, amount?:number, billId?:string}} visit
 */
export async function recordVisit({ id, businessDate, amount = 0, billId = '' }) {
  if (!id || !businessDate) return null;

  const existing = await getByKey(STORES.CUSTOMERS, id);
  if (!existing) return null;

  const days = Array.isArray(existing.visitDays) ? existing.visitDays : [];
  const seen = days.includes(businessDate);
  const visitDays = (seen ? days : [...days, businessDate]).sort().slice(-MAX_VISIT_DAYS);

  const record = {
    ...existing,
    visitDays,
    visitCount: visitDays.length,
    firstVisit: visitDays[0] || businessDate,
    lastVisit: visitDays[visitDays.length - 1] || businessDate,
    billCount: (Number(existing.billCount) || 0) + 1,
    totalSpend: (Number(existing.totalSpend) || 0) + Math.max(0, Math.round(Number(amount) || 0)),
    lastBillId: billId || existing.lastBillId || '',
    updatedAt: new Date().toISOString(),
  };

  await put(STORES.CUSTOMERS, record);
  return store(record);
}

/**
 * Write down that a treat has been given, so it cannot be given twice.
 *
 * @param {string} id
 * @param {{kind:'STREAK'|'BIRTHDAY', businessDate:string}} claim
 */
export async function markRewardClaimed(id, { kind, businessDate }) {
  const existing = await getByKey(STORES.CUSTOMERS, id);
  if (!existing) return null;

  const rewards = { ...(existing.rewards || {}) };
  if (kind === 'BIRTHDAY') {
    rewards.birthdayClaimedYear = Number(String(businessDate).slice(0, 4)) || 0;
    rewards.birthdayClaimedOn = businessDate;
  } else {
    rewards.streakClaimedOn = businessDate;
  }
  rewards.given = (Number(rewards.given) || 0) + 1;

  const record = { ...existing, rewards, updatedAt: new Date().toISOString() };
  await put(STORES.CUSTOMERS, record);
  return store(record);
}

/* ----------------------------------------------------------------- sync --- */

/**
 * Fold customers arriving from the shared database into what this device has.
 *
 * Everything else in the app is last-write-wins, which is right for a menu
 * price and wrong for a visit history: two tills serving the same regular on
 * the same day would each hold a day the other does not, and whoever wrote
 * last would erase it. Visits are therefore merged rather than replaced —
 * union of the days, the higher of the counters, the earlier of the first
 * visits. The customer's own details still follow the newer record.
 */
export async function mergeRemoteCustomers(rows) {
  if (!rows?.length) return 0;

  const local = new Map((await getAll(STORES.CUSTOMERS)).map((row) => [row.id, row]));
  const merged = [];
  // Records where the merge knows more than the copy that arrived, and which
  // therefore have to go back up.
  const enriched = [];

  for (const incoming of rows) {
    if (!incoming?.id) continue;
    const mine = local.get(incoming.id);
    if (!mine) {
      merged.push(incoming);
      continue;
    }

    const days = [...new Set([...(mine.visitDays || []), ...(incoming.visitDays || [])])]
      .sort()
      .slice(-MAX_VISIT_DAYS);
    const newer = String(incoming.updatedAt || '') >= String(mine.updatedAt || '') ? incoming : mine;
    const rewards = {
      ...(mine.rewards || {}),
      ...(incoming.rewards || {}),
      // A treat given anywhere has been given. Take the later of the two.
      streakClaimedOn: [mine.rewards?.streakClaimedOn || '', incoming.rewards?.streakClaimedOn || '']
        .sort()
        .pop(),
      birthdayClaimedYear: Math.max(
        Number(mine.rewards?.birthdayClaimedYear) || 0,
        Number(incoming.rewards?.birthdayClaimedYear) || 0
      ),
    };

    const record = {
      ...newer,
      visitDays: days,
      visitCount: days.length,
      firstVisit: [mine.firstVisit, incoming.firstVisit].filter(Boolean).sort()[0] || '',
      lastVisit: days[days.length - 1] || '',
      billCount: Math.max(Number(mine.billCount) || 0, Number(incoming.billCount) || 0),
      totalSpend: Math.max(Number(mine.totalSpend) || 0, Number(incoming.totalSpend) || 0),
      rewards,
    };
    merged.push(record);

    // Send the fuller picture back, or the shared database would keep only
    // whichever till happened to write last — and a third device joining later
    // would inherit half a history. Nothing is queued when the merge changed
    // nothing, so two devices cannot volley the same record forever.
    if (days.length > (incoming.visitDays || []).length) {
      enriched.push({ store: STORES.CUSTOMERS, id: record.id });
    }
  }

  await applyRemoteBatch(STORES.CUSTOMERS, merged);
  if (enriched.length) await enqueueManyForSync(enriched);
  return merged.length;
}

/* ------------------------------------------------------- backup support --- */

export async function replaceAll(customers) {
  await clearStore(STORES.CUSTOMERS);
  if (customers?.length) await putMany(STORES.CUSTOMERS, customers);
  await loadCustomers();
}
