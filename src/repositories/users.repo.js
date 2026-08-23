/**
 * Local user accounts.
 *
 * Passwords are stored as salted SHA-256 hashes so they are not sitting in the
 * database in plain sight. This is a sensible-hygiene measure for a shared
 * counter machine, not server-grade authentication — see the security note in
 * app.config.js and the README.
 */

import { STORES, getAll, getByKey, put, remove, clearStore, putMany } from '../db/database.js';
import { DEFAULT_USERS } from '../config/app.config.js';
import { requireAdmin, getSession } from '../core/session.js';
import { AppError } from '../core/utils.js';

const encoder = new TextEncoder();

function randomSalt() {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * SHA-256 via Web Crypto, which needs a secure context (https:// or
 * localhost). Opening the files straight off disk has no Web Crypto, so we fall
 * back to a plain non-cryptographic hash purely so the app still runs while you
 * are poking at it locally. Deploy over https for the real thing.
 */
async function hash(password, salt) {
  const input = `tbc:${salt}:${password}`;
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
    return `sha256$${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(
      ''
    )}`;
  }
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    h1 = Math.imul(h1 ^ input.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + input.charCodeAt(i) * (i + 1), 0x85ebca6b) >>> 0;
  }
  return `weak$${h1.toString(16)}${h2.toString(16)}`;
}

export async function buildUser({ username, displayName, role, password }) {
  const salt = randomSalt();
  return {
    username: String(username).trim().toLowerCase(),
    displayName: String(displayName || username).trim(),
    role: role === 'admin' ? 'admin' : 'cashier',
    salt,
    passwordHash: await hash(password, salt),
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function seedUsersIfEmpty() {
  const existing = await getAll(STORES.USERS);
  if (existing.length) return { seeded: false, count: existing.length };
  const users = [];
  for (const user of DEFAULT_USERS) users.push(await buildUser(user));
  await putMany(STORES.USERS, users);
  return { seeded: true, count: users.length };
}

export function listUsers() {
  return getAll(STORES.USERS).then((users) =>
    users
      .map(({ passwordHash, salt, ...safe }) => safe)
      .sort((a, b) => a.role.localeCompare(b.role) || a.username.localeCompare(b.username))
  );
}

export async function verifyCredentials(username, password) {
  const key = String(username || '').trim().toLowerCase();
  const user = await getByKey(STORES.USERS, key);
  if (!user || user.active === false) return null;
  const attempt = await hash(password, user.salt);
  if (attempt !== user.passwordHash) return null;
  return { username: user.username, displayName: user.displayName, role: user.role };
}

export async function createUser(draft) {
  requireAdmin('adding users');
  const username = String(draft.username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,24}$/.test(username)) {
    throw new AppError('Usernames use 3–24 letters, numbers, dot, dash or underscore.', 'VALIDATION');
  }
  if (String(draft.password || '').length < 6) {
    throw new AppError('Passwords need at least 6 characters.', 'VALIDATION');
  }
  if (await getByKey(STORES.USERS, username)) {
    throw new AppError(`The username "${username}" is taken.`, 'DUPLICATE');
  }
  const user = await buildUser({ ...draft, username });
  await put(STORES.USERS, user);
  return { username: user.username, displayName: user.displayName, role: user.role };
}

export async function changePassword(username, password) {
  requireAdmin('changing passwords');
  if (String(password || '').length < 6) {
    throw new AppError('Passwords need at least 6 characters.', 'VALIDATION');
  }
  const user = await getByKey(STORES.USERS, username);
  if (!user) throw new AppError('That user no longer exists.', 'NOT_FOUND');
  const salt = randomSalt();
  await put(STORES.USERS, {
    ...user,
    salt,
    passwordHash: await hash(password, salt),
    updatedAt: new Date().toISOString(),
  });
  return true;
}

export async function setUserActive(username, active) {
  requireAdmin('enabling or disabling users');
  const user = await getByKey(STORES.USERS, username);
  if (!user) throw new AppError('That user no longer exists.', 'NOT_FOUND');
  if (user.username === getSession()?.username && !active) {
    throw new AppError('You cannot disable the account you are signed in with.', 'SELF_LOCKOUT');
  }
  if (user.role === 'admin' && !active) {
    const admins = (await getAll(STORES.USERS)).filter(
      (row) => row.role === 'admin' && row.active !== false
    );
    if (admins.length <= 1) {
      throw new AppError('Keep at least one active admin account.', 'LAST_ADMIN');
    }
  }
  await put(STORES.USERS, { ...user, active: Boolean(active), updatedAt: new Date().toISOString() });
  return true;
}

export async function deleteUser(username) {
  requireAdmin('deleting users');
  if (username === getSession()?.username) {
    throw new AppError('You cannot delete the account you are signed in with.', 'SELF_LOCKOUT');
  }
  const users = await getAll(STORES.USERS);
  const target = users.find((row) => row.username === username);
  if (!target) throw new AppError('That user no longer exists.', 'NOT_FOUND');
  if (target.role === 'admin' && users.filter((row) => row.role === 'admin').length <= 1) {
    throw new AppError('Keep at least one admin account.', 'LAST_ADMIN');
  }
  await remove(STORES.USERS, username);
  return true;
}

export async function replaceAll(users) {
  await clearStore(STORES.USERS);
  if (users.length) await putMany(STORES.USERS, users);
  else await seedUsersIfEmpty();
}

export function exportUsers() {
  return getAll(STORES.USERS);
}
