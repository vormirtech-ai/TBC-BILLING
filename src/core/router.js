/**
 * Hash-based routing (#/pos, #/dashboard …).
 *
 * Deliberate choice: GitHub Pages serves static files and cannot rewrite
 * unknown paths back to index.html, so a history-API router breaks on refresh
 * or deep links once the site lives under /<repo>/. Hash routes work at any
 * base path with no server configuration and no 404 workaround.
 */

const routes = new Map();
let notFound = null;
let beforeEach = null;
let currentPath = null;
let disposeCurrent = null;

export function defineRoute(path, config) {
  routes.set(path, config);
}

export function setNotFound(render) {
  notFound = render;
}

/** Guard hook: return a path string to redirect, or nothing to continue. */
export function setGuard(fn) {
  beforeEach = fn;
}

export function currentRoute() {
  return currentPath;
}

export function parseHash() {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [path, queryString = ''] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(queryString));
  return { path: path.startsWith('/') ? path : `/${path}`, query };
}

export function navigate(path, { replace = false } = {}) {
  const target = `#${path.startsWith('/') ? path : `/${path}`}`;
  if (window.location.hash === target) {
    resolve();
    return;
  }
  if (replace) window.location.replace(target);
  else window.location.hash = target;
}

async function resolve() {
  const { path, query } = parseHash();

  if (beforeEach) {
    const redirect = await beforeEach(path);
    if (redirect && redirect !== path) {
      navigate(redirect, { replace: true });
      return;
    }
  }

  const route = routes.get(path);
  const outlet = document.getElementById('view');
  if (!outlet) return;

  if (typeof disposeCurrent === 'function') {
    try {
      disposeCurrent();
    } catch (error) {
      console.error('[TBC POS] route cleanup failed', error);
    }
  }
  disposeCurrent = null;
  currentPath = path;

  outlet.replaceChildren();
  outlet.scrollTop = 0;

  try {
    const render = route?.render || notFound;
    const result = await render({ path, query, outlet });
    if (typeof result === 'function') disposeCurrent = result;
  } catch (error) {
    console.error('[TBC POS] route failed', error);
    outlet.replaceChildren();
    const message = document.createElement('div');
    message.className = 'empty';
    message.textContent = 'This screen could not be opened. Reload the page and try again.';
    outlet.appendChild(message);
  }

  document.dispatchEvent(new CustomEvent('route:changed', { detail: { path, query } }));
}

export function startRouter(defaultPath = '/') {
  window.addEventListener('hashchange', resolve);
  if (!window.location.hash) navigate(defaultPath, { replace: true });
  else resolve();
}
