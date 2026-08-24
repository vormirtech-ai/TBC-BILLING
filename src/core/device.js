/**
 * This browser's own identity.
 *
 * Kept dependency-free so both the storage layer and the ordering services can
 * use it. The id is generated once and then never changes for this browser: it
 * is how a customer's phone follows the order it placed, and how a till that
 * billed while offline marks the bill numbers it had to invent for itself.
 */

const DEVICE_KEY = 'tbc.device';
const TAG_KEY = 'tbc.device.tag';

function random(length, alphabet) {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

export function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = `dev_${random(16, 'abcdefghijklmnopqrstuvwxyz0123456789')}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    // Storage blocked. The app still works; this device just cannot be told
    // apart from another one in the same state.
    return 'dev_unknown';
  }
}

/**
 * A two-character tag, short enough to sit inside a bill number without making
 * it unreadable. Ambiguous characters are left out so it survives being read
 * off a printed receipt.
 */
export function deviceTag() {
  try {
    let tag = localStorage.getItem(TAG_KEY);
    if (!tag) {
      tag = random(2, 'ACDEFHJKLMNPRTUVWXY3479');
      localStorage.setItem(TAG_KEY, tag);
    }
    return tag;
  } catch {
    return 'XX';
  }
}
