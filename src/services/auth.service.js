/** Sign in, sign out, and the small amount of rate limiting a till needs. */

import { verifyCredentials } from '../repositories/users.repo.js';
import { setSession, getSession } from '../core/session.js';
import { AppError } from '../core/utils.js';

const LOCKOUT_KEY = 'tbc.login.attempts';
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000;

function readAttempts() {
  try {
    return JSON.parse(localStorage.getItem(LOCKOUT_KEY) || '{"count":0,"until":0}');
  } catch {
    return { count: 0, until: 0 };
  }
}

function writeAttempts(value) {
  try {
    localStorage.setItem(LOCKOUT_KEY, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function lockoutRemainingMs() {
  const { until } = readAttempts();
  return Math.max(0, until - Date.now());
}

export async function signIn(username, password) {
  const remaining = lockoutRemainingMs();
  if (remaining > 0) {
    throw new AppError(
      `Too many failed attempts. Try again in ${Math.ceil(remaining / 1000)} seconds.`,
      'LOCKED'
    );
  }
  if (!String(username || '').trim() || !String(password || '')) {
    throw new AppError('Enter both a username and a password.', 'VALIDATION');
  }

  const user = await verifyCredentials(username, password);
  if (!user) {
    const attempts = readAttempts();
    const count = attempts.count + 1;
    writeAttempts({
      count: count >= MAX_ATTEMPTS ? 0 : count,
      until: count >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : 0,
    });
    throw new AppError('That username and password do not match.', 'BAD_CREDENTIALS');
  }

  writeAttempts({ count: 0, until: 0 });
  const session = {
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    signedInAt: new Date().toISOString(),
  };
  setSession(session);
  return session;
}

export function signOut() {
  setSession(null);
}

export function currentUser() {
  return getSession();
}
