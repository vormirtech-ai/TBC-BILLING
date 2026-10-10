/**
 * Who is at this terminal, and what they are allowed to do.
 *
 * PINs are four digits because a captain enters one twenty times a service
 * with one hand. Four digits is ten thousand possibilities, which is nothing
 * — so the protection is not the PIN's length, it is:
 *
 *   • scrypt with a per-user salt, so the stored form is useless if the
 *     database file walks out of the building;
 *   • a hard lockout after a short run of wrong guesses, per account and per
 *     address, which turns ten thousand guesses into weeks of them;
 *   • a constant-time comparison, so a stopwatch learns nothing.
 *
 * This is the right trade for a device bolted to a till in a staff-only area.
 * It is not the right trade for anything reachable from the internet, and
 * DEPLOYMENT.md says so in as many words.
 */

import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from 'node:crypto';

import { one, all, run, tx } from './db/index.js';
import { config } from './config.js';
import { log } from './log.js';
import { HttpError, forbidden, unauthorized } from './http/kit.js';
import {
  ROLE_ABILITIES, ROLE_LABELS, ROLE_ORDER,
  PIN_ATTEMPT_LIMIT, PIN_LOCKOUT_SECONDS,
} from '../app/src/shared/config.js';

/** Deliberately slow. ~100ms per check is invisible to a human, brutal to a script. */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export const COOKIE = 'saba_session';

/* ------------------------------------------------------------- hashing --- */

export function hashPin(pin, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(String(pin), salt, SCRYPT.keylen, SCRYPT).toString('hex');
  return { hash, salt };
}

function pinMatches(pin, storedHash, salt) {
  const candidate = scryptSync(String(pin), salt, SCRYPT.keylen, SCRYPT);
  const stored = Buffer.from(storedHash, 'hex');
  if (stored.length !== candidate.length) return false;
  return timingSafeEqual(stored, candidate);
}

export function validatePin(pin) {
  const value = String(pin ?? '');
  if (!/^\d{4,8}$/.test(value)) {
    throw new HttpError(400, 'A PIN must be between four and eight digits');
  }
  if (/^(\d)\1+$/.test(value)) {
    throw new HttpError(400, 'That PIN is too easy to guess — do not repeat one digit');
  }
  if ('012345678901234567890'.includes(value) || '098765432109876543210'.includes(value)) {
    throw new HttpError(400, 'That PIN is too easy to guess — do not use a run of digits');
  }
  return value;
}

/* --------------------------------------------------------------- users --- */

const publicUser = (row) => row && ({
  id: row.id,
  name: row.name,
  initials: row.initials,
  role: row.role,
  roleLabel: ROLE_LABELS[row.role] || row.role,
  active: !!row.active,
});

export const listUsers = () =>
  all('SELECT * FROM users WHERE active = 1 ORDER BY role, name').map(publicUser);

export const listAllUsers = () =>
  all('SELECT * FROM users ORDER BY active DESC, role, name').map(publicUser);

export const getUser = (id) => publicUser(one('SELECT * FROM users WHERE id = ?', id));

export const countManagers = () =>
  one("SELECT count(*) AS n FROM users WHERE active = 1 AND role = 'manager'").n;

export function initials(name) {
  return String(name || '').trim().split(/\s+/).slice(0, 2)
    .map((w) => w[0] || '').join('').toUpperCase() || '??';
}

export function createUser({ name, role, pin }) {
  if (!String(name || '').trim()) throw new HttpError(400, 'A member of staff needs a name');
  if (!ROLE_ORDER.includes(role)) throw new HttpError(400, `Unknown role ${role}`);
  validatePin(pin);

  return tx(() => {
    // Staff pick their name before typing, so two people *could* share a PIN
    // without ambiguity — but approvals are taken on the PIN alone, so among
    // anybody who can approve something it still has to be unique. Enforcing
    // it for everyone is simpler to explain and costs nothing.
    for (const row of all('SELECT pin_hash, pin_salt FROM users WHERE active = 1')) {
      if (pinMatches(pin, row.pin_hash, row.pin_salt)) {
        throw new HttpError(409, 'Another member of staff already uses that PIN');
      }
    }
    const { hash, salt } = hashPin(pin);
    const id = `u_${randomUUID().slice(0, 12)}`;
    const now = Date.now();
    run(
      'INSERT INTO users (id, name, initials, role, pin_hash, pin_salt, active, created_at, updated_at)'
      + ' VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
      id, String(name).trim(), initials(name), role, hash, salt, now, now
    );
    return getUser(id);
  });
}

export function updateUser(id, { name, role, pin, active }) {
  return tx(() => {
    const row = one('SELECT * FROM users WHERE id = ?', id);
    if (!row) throw new HttpError(404, 'No such member of staff');

    // Never let the last manager be demoted or switched off: that locks
    // everybody out of Setup with no way back in.
    const losingManager = row.role === 'manager' && row.active
      && ((role && role !== 'manager') || active === false);
    if (losingManager && countManagers() <= 1) {
      throw new HttpError(409, 'This is the only manager — promote someone else first');
    }

    if (pin !== undefined && pin !== null && pin !== '') {
      validatePin(pin);
      for (const other of all('SELECT id, pin_hash, pin_salt FROM users WHERE active = 1 AND id != ?', id)) {
        if (pinMatches(pin, other.pin_hash, other.pin_salt)) {
          throw new HttpError(409, 'Another member of staff already uses that PIN');
        }
      }
      const { hash, salt } = hashPin(pin);
      run('UPDATE users SET pin_hash = ?, pin_salt = ? WHERE id = ?', hash, salt, id);
      // Changing a PIN signs that person out everywhere, which is the point.
      run('DELETE FROM sessions WHERE user_id = ?', id);
    }

    if (name !== undefined) {
      run('UPDATE users SET name = ?, initials = ? WHERE id = ?',
        String(name).trim(), initials(name), id);
    }
    if (role !== undefined) {
      if (!ROLE_ORDER.includes(role)) throw new HttpError(400, `Unknown role ${role}`);
      run('UPDATE users SET role = ? WHERE id = ?', role, id);
    }
    if (active !== undefined) {
      run('UPDATE users SET active = ? WHERE id = ?', active ? 1 : 0, id);
      if (!active) run('DELETE FROM sessions WHERE user_id = ?', id);
    }

    run('UPDATE users SET updated_at = ? WHERE id = ?', Date.now(), id);
    return getUser(id);
  });
}

/* ----------------------------------------------------------- lockout --- */

function recentFailures(userId, address) {
  const since = Date.now() - PIN_LOCKOUT_SECONDS * 1000;
  return one(
    'SELECT count(*) AS n FROM pin_attempts WHERE at > ? AND (address = ? OR (user_id IS NOT NULL AND user_id = ?))',
    since, address, userId ?? '-'
  ).n;
}

function noteFailure(userId, address) {
  run('INSERT INTO pin_attempts (user_id, address, at) VALUES (?, ?, ?)',
    userId ?? null, address, Date.now());
  // Keep the table from growing without bound on a long-running till.
  run('DELETE FROM pin_attempts WHERE at < ?', Date.now() - 24 * 3600 * 1000);
}

/* ---------------------------------------------------------- sign in --- */

/**
 * Sign in.
 *
 * The terminal says who is signing in and what they typed, and exactly one
 * scrypt check is done.
 *
 * It used to try the PIN against every active account so that staff could
 * sign in without first saying who they were. That is a nicer two seconds
 * into a shift and a worse two seconds every time after it: each account
 * costs a full scrypt, so a restaurant with twenty staff made every captain
 * wait two seconds at the terminal, and forty staff four. Tapping your own
 * name first is one press on a large target — which is how every POS on a
 * restaurant floor already works — and it keeps sign-in instant however many
 * people are on the payroll.
 */
export function signIn({ userId, pin, address, terminal }) {
  const blocked = recentFailures(userId, address);
  if (blocked >= PIN_ATTEMPT_LIMIT) {
    throw new HttpError(429,
      `Too many wrong PINs. Try again in ${PIN_LOCKOUT_SECONDS} seconds.`);
  }

  const row = userId
    ? one('SELECT * FROM users WHERE id = ? AND active = 1', userId)
    : null;

  // A missing account still pays the cost of a hash, so the time taken does
  // not tell an attacker which staff ids exist.
  const ok = row
    ? pinMatches(pin, row.pin_hash, row.pin_salt)
    : (scryptSync(String(pin), 'decoy-salt', SCRYPT.keylen, SCRYPT) && false);

  if (!ok) {
    noteFailure(userId, address);
    const left = Math.max(0, PIN_ATTEMPT_LIMIT - blocked - 1);
    throw new HttpError(401, left
      ? `That PIN was not recognised. ${left} ${left === 1 ? 'try' : 'tries'} left.`
      : 'That PIN was not recognised. This terminal is locked for a minute.');
  }

  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  const expires = now + config.sessionHours * 3600 * 1000;
  run(
    'INSERT INTO sessions (token, user_id, terminal, created_at, last_seen, expires_at)'
    + ' VALUES (?, ?, ?, ?, ?, ?)',
    token, row.id, terminal || null, now, now, expires
  );
  run('DELETE FROM sessions WHERE expires_at < ?', now);
  run('DELETE FROM pin_attempts WHERE address = ? AND (user_id IS NULL OR user_id = ?)',
    address, row.id);

  log.info('signed in', { user: row.name, role: row.role, address });
  return { token, user: publicUser(row), expiresAt: expires };
}

export function signOut(token) {
  if (token) run('DELETE FROM sessions WHERE token = ?', token);
}

/** The signed-in user for a request token, or null. Refreshes last_seen. */
export function sessionUser(token) {
  if (!token) return null;
  const row = one(
    'SELECT s.token, s.expires_at, u.* FROM sessions s'
    + ' JOIN users u ON u.id = s.user_id'
    + ' WHERE s.token = ? AND u.active = 1',
    token
  );
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    run('DELETE FROM sessions WHERE token = ?', token);
    return null;
  }
  run('UPDATE sessions SET last_seen = ? WHERE token = ?', Date.now(), token);
  return publicUser(row);
}

/**
 * Confirm a manager standing at the terminal approves this.
 *
 * Used for voids, heavy discounts, comps and reopening a bill. It is a
 * separate act from being signed in: the captain keeps their session, the
 * manager types their PIN, and the manager's name is what lands in the audit
 * log next to the money that moved.
 */
export function authoriseByPin({ pin, ability, address }) {
  const blocked = recentFailures(null, address);
  if (blocked >= PIN_ATTEMPT_LIMIT) {
    throw new HttpError(429, 'Too many wrong PINs. Wait a moment and try again.');
  }

  // Only people who could actually approve this are candidates, so a manager
  // walking over and typing four digits stays one or two hashes, not twenty.
  // Every candidate is checked even once one matches, so the time taken does
  // not reveal where in the list the match sat.
  const candidates = all('SELECT * FROM users WHERE active = 1').filter(
    (row) => !ability || (ROLE_ABILITIES[row.role] || []).includes(ability)
  );

  let matched = null;
  for (const row of candidates) {
    if (pinMatches(pin, row.pin_hash, row.pin_salt)) matched = matched || row;
  }

  if (!matched) {
    noteFailure(null, address);
    throw new HttpError(401, ability
      ? 'That PIN was not recognised, or that person cannot approve this'
      : 'That PIN was not recognised');
  }
  return publicUser(matched);
}

/* -------------------------------------------------------------- guards --- */

export function requireUser(user) {
  if (!user) throw unauthorized();
  return user;
}

/** Plain English for each ability, so a refusal reads like a sentence. */
const ABILITY_PHRASES = {
  void: 'void an item',
  discount: 'discount a bill',
  comp: 'put something on the house',
  reopen: 'reopen a settled bill',
  settings: 'change the setup',
  eightySix: 'take a dish off the menu',
  reprint: 'reprint a docket',
  users: 'manage staff accounts',
  shift: 'open or close the till',
  export: 'export sales data',
  backup: 'take a backup',
};

export function requireAbility(user, ability) {
  requireUser(user);
  if (!(ROLE_ABILITIES[user.role] || []).includes(ability)) {
    const what = ABILITY_PHRASES[ability] || ability;
    throw forbidden(`A ${ROLE_LABELS[user.role] || user.role} cannot ${what}`);
  }
  return user;
}

export function requireRole(user, role) {
  requireUser(user);
  if (user.role !== role) throw forbidden(`Only a ${role} can do that`);
  return user;
}
