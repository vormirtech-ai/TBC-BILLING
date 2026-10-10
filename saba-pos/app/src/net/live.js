/**
 * The live link.
 *
 * One EventSource per terminal. The server sends a revision number whenever
 * anything changes anywhere in the building; this module notices it is behind
 * and asks for a fresh working set.
 *
 * Deliberately not clever. There is no patch stream to apply in order and no
 * local merge to get wrong — a terminal that has been asleep, behind a flaky
 * access point, or only just plugged in all recover by the same single path.
 * On a restaurant's own wifi the refetch is a few milliseconds, and the
 * simplicity is worth far more than the bytes.
 */

const RECONNECT_MIN = 1000;
const RECONNECT_MAX = 15000;

let source = null;
let attempt = 0;
let timer = null;
let stopped = false;

let onRevision = () => {};
let onStatus = () => {};

/**
 * @param {object} handlers
 * @param {(revision: number, reason: string) => void} handlers.revision
 * @param {(status: {connected: boolean, since: number}) => void} handlers.status
 */
export function connect({ revision, status }) {
  onRevision = revision || onRevision;
  onStatus = status || onStatus;
  stopped = false;
  open();
}

function open() {
  if (stopped) return;
  close();

  source = new EventSource('/api/events', { withCredentials: true });

  source.addEventListener('hello', (event) => {
    attempt = 0;
    const data = parse(event);
    onStatus({ connected: true, since: Date.now(), terminals: data?.terminals });
    if (data) onRevision(data.revision, 'hello');
  });

  source.addEventListener('revision', (event) => {
    const data = parse(event);
    if (data) onRevision(data.revision, data.reason || 'change');
  });

  source.addEventListener('bye', () => {
    // The server said it is going down. Do not hammer it on the way.
    attempt = 2;
  });

  source.onopen = () => {
    attempt = 0;
    onStatus({ connected: true, since: Date.now() });
  };

  source.onerror = () => {
    // EventSource reconnects by itself, but only on its own schedule and
    // only while the server is answering at all. Taking it over means a
    // terminal left on overnight comes back as soon as the till does.
    onStatus({ connected: false, since: Date.now() });
    close();
    schedule();
  };
}

function schedule() {
  if (stopped || timer) return;
  attempt += 1;
  // Back off, with a little jitter so twelve terminals do not all return in
  // the same millisecond when the router comes back.
  const base = Math.min(RECONNECT_MAX, RECONNECT_MIN * 2 ** (attempt - 1));
  const wait = base * (0.7 + Math.random() * 0.6);
  timer = setTimeout(() => { timer = null; open(); }, wait);
}

function close() {
  if (source) {
    try { source.close(); } catch { /* already closed */ }
    source = null;
  }
}

export function disconnect() {
  stopped = true;
  if (timer) { clearTimeout(timer); timer = null; }
  close();
}

const parse = (event) => {
  try { return JSON.parse(event.data); } catch { return null; }
};

export const isConnected = () => !!source && source.readyState === 1;
