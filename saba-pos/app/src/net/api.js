/**
 * Talking to the till.
 *
 * Every command the terminal issues goes through here. Three things this
 * layer is responsible for, which the screens above it should never have to
 * think about:
 *
 *   Errors arrive as a thrown Error carrying the server's own sentence, so a
 *   view can put `error.message` straight in front of a human — "There is
 *   still 2,340.00 to pay" rather than "409".
 *
 *   A dropped connection is not a crash. Commands issued while the link is
 *   down are queued in order and replayed when it returns, and the shell
 *   shows that it is happening.
 *
 *   Being signed out is handled once, here, rather than in forty call sites.
 */

const HEADERS = { 'content-type': 'application/json' };

/** Listeners for the states the shell shows: offline, queued, signed out. */
const listeners = new Set();
export const onNetworkChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

const state = {
  online: true,
  /** Commands waiting for the link to come back. */
  queue: [],
  /** A request has been in flight long enough to be worth showing. */
  busy: false,
};

export const networkState = () => ({ ...state, queued: state.queue.length });

function announce() {
  for (const fn of [...listeners]) {
    try { fn(networkState()); } catch { /* a listener must not break the net */ }
  }
}

export class ApiError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

/** Raised when the server says this terminal is no longer signed in. */
export class SignedOutError extends ApiError {
  constructor(message) {
    super(401, message || 'This terminal has been signed out');
    this.name = 'SignedOutError';
  }
}

let onSignedOut = () => {};
export const whenSignedOut = (fn) => { onSignedOut = fn; };

/* ------------------------------------------------------------ requests --- */

let busyTimer = null;

async function request(method, path, body, { retryOnOffline = false } = {}) {
  // A command issued with the link already down joins the queue rather than
  // failing in the captain's face.
  if (!state.online && retryOnOffline) return enqueue(method, path, body);

  busyTimer = setTimeout(() => { state.busy = true; announce(); }, 400);

  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch (networkError) {
    clearTimeout(busyTimer);
    state.busy = false;
    if (state.online) { state.online = false; announce(); }
    if (retryOnOffline) return enqueue(method, path, body);
    throw new ApiError(0, 'The till is not reachable from this terminal');
  } finally {
    clearTimeout(busyTimer);
    if (state.busy) { state.busy = false; announce(); }
  }

  if (!state.online) { state.online = true; announce(); drain(); }

  if (response.status === 204) return null;

  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json')) {
    if (response.ok) return response;
    throw new ApiError(response.status, await response.text() || response.statusText);
  }

  const payload = await response.json().catch(() => ({}));

  if (response.ok) return payload;

  if (response.status === 401 && payload.code === 'SIGNED_OUT') {
    onSignedOut();
    throw new SignedOutError(payload.error);
  }
  throw new ApiError(response.status, payload.error || response.statusText, payload.detail);
}

/* -------------------------------------------------------------- queue --- */

/**
 * Hold a command until the link returns.
 *
 * Order is preserved, because "add two lamb racks" followed by "fire the
 * table" has to reach the kitchen in that order or the docket goes out short.
 * The promise the caller is holding settles when the command finally lands.
 */
function enqueue(method, path, body) {
  return new Promise((resolve, reject) => {
    state.queue.push({ method, path, body, resolve, reject });
    announce();
  });
}

let draining = false;

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (state.queue.length && state.online) {
      const job = state.queue[0];
      try {
        const result = await request(job.method, job.path, job.body);
        state.queue.shift();
        announce();
        job.resolve(result);
      } catch (error) {
        if (error.status === 0) break;        // still down; keep the queue
        state.queue.shift();                  // the server refused it; that is final
        announce();
        job.reject(error);
      }
    }
  } finally {
    draining = false;
  }
}

/** Give up on anything still queued — used when signing out. */
export function abandonQueue() {
  const waiting = state.queue.splice(0);
  for (const job of waiting) {
    job.reject(new ApiError(0, 'That was not sent before the terminal signed out'));
  }
  announce();
}

export function markOnline(online) {
  if (state.online === online) return;
  state.online = online;
  announce();
  if (online) drain();
}

/* ----------------------------------------------------------- verbs --- */

const q = (params) => {
  const search = new URLSearchParams(
    Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null)
  ).toString();
  return search ? `?${search}` : '';
};

export const get = (path, params) => request('GET', path + q(params));

/** A command. Queued rather than lost if the link is down. */
export const send = (method, path, body) =>
  request(method, path, body ?? {}, { retryOnOffline: true });

export const post = (path, body) => send('POST', path, body);
export const patch = (path, body) => send('PATCH', path, body);
export const del = (path, body) => send('DELETE', path, body);

/* ------------------------------------------------------------- the API --- */

export const api = {
  health: () => get('/api/health'),

  staff: () => get('/api/session/staff'),
  signIn: (userId, pin, terminal) =>
    request('POST', '/api/session', { userId, pin, terminal }),
  signOut: () => request('DELETE', '/api/session', {}),
  session: () => get('/api/session'),

  state: () => get('/api/state'),
  order: (id) => get(`/api/orders/${id}`),

  /** Check a manager's PIN so a dialog can refuse it on the spot. */
  authorise: (pin, ability) => request('POST', '/api/authorise', { pin, ability }),

  seat: (tableId, body) => post(`/api/tables/${tableId}/seat`, body),
  transfer: (id, toTableId) => post(`/api/orders/${id}/transfer`, { toTableId }),
  merge: (id, intoOrderId) => post(`/api/orders/${id}/merge`, { intoOrderId }),
  updateOrder: (id, body) => patch(`/api/orders/${id}`, body),

  addLine: (id, body) => post(`/api/orders/${id}/lines`, body),
  setLine: (id, lineId, body) => patch(`/api/orders/${id}/lines/${lineId}`, body),
  dropLine: (id, lineId) => del(`/api/orders/${id}/lines/${lineId}`),
  voidLine: (id, lineId, body) => post(`/api/orders/${id}/lines/${lineId}/void`, body),
  compLine: (id, lineId, body) => post(`/api/orders/${id}/lines/${lineId}/comp`, body),
  fire: (id, course) => post(`/api/orders/${id}/fire`, { course }),

  bumpKot: (kotId, to) => post(`/api/kots/${kotId}/status`, { to }),
  voidKot: (kotId, body) => post(`/api/kots/${kotId}/void`, body),
  reprintKot: (kotId) => post(`/api/kots/${kotId}/reprint`),

  charges: (id, body) => patch(`/api/orders/${id}/charges`, body),
  split: (id, body) => post(`/api/orders/${id}/split`, body),
  invoice: (id) => post(`/api/orders/${id}/invoice`),
  pay: (id, body) => post(`/api/orders/${id}/payments`, body),
  unpay: (id, payId) => del(`/api/orders/${id}/payments/${payId}`),
  settle: (id) => post(`/api/orders/${id}/settle`),
  reopen: (id, approverPin) => post(`/api/orders/${id}/reopen`, { approverPin }),

  menu: () => get('/api/menu'),
  eightySix: (itemId, on, note) => post(`/api/menu/${itemId}/eighty-six`, { on, note }),
  addItem: (body) => post('/api/menu', body),
  updateItem: (itemId, body) => patch(`/api/menu/${itemId}`, body),

  reservations: (day) => get('/api/reservations', { day }),
  saveReservation: (body) => (body.id
    ? patch(`/api/reservations/${body.id}`, body)
    : post('/api/reservations', body)),
  dropReservation: (id) => del(`/api/reservations/${id}`),

  reports: (from, to) => get('/api/reports', { from, to }),
  dayReport: (day) => get(`/api/reports/day/${day}`),
  audit: (day) => get('/api/audit', { day }),

  openShift: (floatPaise) => post('/api/shift/open', { floatPaise }),
  closeShift: (countedPaise, note) => post('/api/shift/close', { countedPaise, note }),

  users: () => get('/api/users'),
  addUser: (body) => post('/api/users', body),
  updateUser: (id, body) => patch(`/api/users/${id}`, body),

  settings: () => get('/api/settings'),
  saveSettings: (body) => patch('/api/settings', body),
  terminals: () => get('/api/terminals'),

  backup: () => post('/api/backup'),
  resetDemo: () => post('/api/demo/reset'),

  /** Download URLs, handed to the browser rather than fetched. */
  salesCsv: (from, to) => `/api/export/sales.csv${q({ from, to })}`,
  gstCsv: (from, to) => `/api/export/gst.csv${q({ from, to })}`,
  backupFile: () => '/api/backup/download',
};

export default api;
