/**
 * Hash routing. A billing terminal is often a locked-down browser opened on a
 * local file, where the History API is unavailable — the hash always works.
 *
 * Routes carry the role list that may open them, so an unauthorised screen is
 * never rendered and then hidden; it is never built at all.
 */

const routes = new Map();
let notFound = () => {};
let guard = () => true;
let current = null;

/** '#/order?table=t4' -> { path: '/order', params: { table: 't4' } } */
export function parseHash(hash = window.location.hash) {
  const raw = String(hash || '').replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  const params = {};
  for (const [key, value] of new URLSearchParams(query)) params[key] = value;
  return { path: path.startsWith('/') ? path : `/${path}`, params };
}

export function defineRoute(path, render, meta = {}) {
  routes.set(path, { render, meta });
}

export const setNotFound = (fn) => { notFound = fn; };

/**
 * The guard returns true to allow, or a path string to redirect to. It runs
 * before the view is built, on every navigation.
 */
export const setGuard = (fn) => { guard = fn; };

export function navigate(path, params = {}) {
  const query = new URLSearchParams(params).toString();
  const next = `#${path}${query ? `?${query}` : ''}`;
  if (window.location.hash === next) resolve();
  else window.location.hash = next;
}

export const getRoute = () => current;

function resolve() {
  const route = parseHash();
  const verdict = guard(route);
  if (typeof verdict === 'string') {
    if (verdict !== route.path) { navigate(verdict); return; }
  } else if (verdict === false) {
    return;
  }

  current = route;
  const entry = routes.get(route.path);
  if (entry) entry.render(route.params, route);
  else notFound(route);
}

export function startRouter() {
  window.addEventListener('hashchange', resolve);
  resolve();
}
