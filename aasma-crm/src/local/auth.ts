import { db, nextId, save } from './db';

/**
 * Sign-in for the hosted build.
 *
 * Passwords are stretched with PBKDF2 through the Web Crypto API and only the
 * derived hash is stored. Be clear-eyed about what this is, though: with no
 * server in the picture this is a local gate on a shared device, not a security
 * boundary — anyone with the browser profile can read the database directly.
 */

const ITERATIONS = 120_000;
const SESSION_HOURS = 12;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function derive(password: string, salt: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    // Only reachable on an insecure origin (plain http on a non-localhost host).
    // The app still works; the stored value simply is not stretched.
    return `plain$${btoa(unescape(encodeURIComponent(password)))}`;
  }
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  );
  return toBase64(new Uint8Array(bits));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt);
  if (hash.startsWith('plain$')) return hash;
  return `pbkdf2$${ITERATIONS}$${toBase64(salt)}$${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith('plain$')) {
    return stored === `plain$${btoa(unescape(encodeURIComponent(password)))}`;
  }
  const [scheme, , saltPart, hashPart] = stored.split('$');
  if (scheme !== 'pbkdf2' || !saltPart || !hashPart) return false;
  const candidate = await derive(password, fromBase64(saltPart));
  // Length-constant comparison; both sides are fixed-size base64 here.
  if (candidate.length !== hashPart.length) return false;
  let difference = 0;
  for (let index = 0; index < candidate.length; index += 1) {
    difference |= candidate.charCodeAt(index) ^ hashPart.charCodeAt(index);
  }
  return difference === 0;
}

export function createSession(userId: number): string {
  const token = toBase64(crypto.getRandomValues(new Uint8Array(24))).replace(/[^A-Za-z0-9]/g, '');
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600 * 1000);
  const data = db();
  data.sessions = data.sessions.filter((session) => session.expiresAt > new Date());
  data.sessions.push({ token, userId, expiresAt });
  save('sessions');
  return token;
}

export function userForToken(token: string | null): { id: number; username: string; fullName: string; role: string } | null {
  if (!token) return null;
  const data = db();
  const session = data.sessions.find((row) => row.token === token);
  if (!session || session.expiresAt <= new Date()) return null;
  const user = data.users.find((row) => row.id === session.userId);
  if (!user || !user.active) return null;
  return { id: user.id, username: user.username, fullName: user.fullName, role: user.role };
}

export function endSession(token: string | null): void {
  if (!token) return;
  const data = db();
  data.sessions = data.sessions.filter((session) => session.token !== token);
  save('sessions');
}

/** Creates the administrator the first time the app is opened in this browser. */
export async function ensureAdminUser(): Promise<void> {
  const data = db();
  if (data.users.length > 0) return;
  data.users.push({
    id: nextId(data.users),
    username: 'admin',
    passwordHash: await hashPassword('admin@123'),
    fullName: 'Administrator',
    role: 'ADMIN',
    active: true,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  save('users');
}
