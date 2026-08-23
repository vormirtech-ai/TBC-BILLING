/**
 * Who is signed in, right now.
 *
 * Kept deliberately dependency-free so both the auth service and the storage
 * repositories can import it. The session lives in sessionStorage: closing the
 * tab signs the user out, which is the behaviour you want on a shared counter
 * machine.
 */

import { AppError } from './utils.js';

const SESSION_KEY = 'tbc.session';

let current = null;
const listeners = new Set();

function read() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function restoreSession() {
  current = read();
  return current;
}

export function getSession() {
  if (current === null) current = read();
  return current;
}

export function setSession(session) {
  current = session;
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* sessionStorage can be blocked; the in-memory copy still works */
  }
  listeners.forEach((fn) => fn(session));
}

export function onSessionChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isSignedIn() {
  return Boolean(getSession());
}

export function isAdmin() {
  return getSession()?.role === 'admin';
}

export function currentUsername() {
  return getSession()?.username || 'unknown';
}

/**
 * Hard gate used by the storage layer. The UI also hides admin controls, but
 * hiding a button is decoration — this is the rule that actually holds, because
 * every write path runs through it.
 */
export function requireAdmin(action = 'this action') {
  const session = getSession();
  if (!session) {
    throw new AppError('Your session ended. Sign in again to continue.', 'NO_SESSION');
  }
  if (session.role !== 'admin') {
    throw new AppError(`Only an admin can perform ${action}.`, 'FORBIDDEN');
  }
  return session;
}

export function requireSignedIn() {
  const session = getSession();
  if (!session) throw new AppError('Your session ended. Sign in again to continue.', 'NO_SESSION');
  return session;
}
