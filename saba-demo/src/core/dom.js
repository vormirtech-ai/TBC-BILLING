/**
 * A very small DOM builder. Views describe what they want as nested calls and
 * get real elements back — no template strings, so nothing a guest or a staff
 * member types can ever be parsed as markup.
 */

/**
 * h('div.card#main', { onclick, text }, [children])
 * The tag string carries `.class` and `#id` shorthands.
 */
export function h(spec, props = {}, children = []) {
  const raw = String(spec);
  const id = raw.match(/#([\w-]+)/)?.[1];
  const [tag, ...classes] = raw.replace(/#[\w-]+/, '').split('.');

  const node = document.createElement(tag || 'div');
  if (id) node.id = id;
  if (classes.length) node.className = classes.filter(Boolean).join(' ');

  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = `${node.className} ${value}`.trim();
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key === 'aria' && typeof value === 'object') {
      for (const [a, v] of Object.entries(value)) node.setAttribute(`aria-${a}`, v);
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value);
    } else if (key in node && typeof value !== 'object') {
      try { node[key] = value; } catch { node.setAttribute(key, value); }
    } else {
      node.setAttribute(key, value);
    }
  }

  add(node, children);
  return node;
}

export function add(parent, children) {
  for (const child of (Array.isArray(children) ? children : [children]).flat(4)) {
    if (child == null || child === false || child === '') continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Replace a node's contents in one paint rather than child by child. */
export function fill(node, children) {
  const frag = document.createDocumentFragment();
  add(frag, children);
  clear(node).appendChild(frag);
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** An inline SVG from a path list. Keeps icons dependency-free and themeable. */
export function svg(paths, { size = 20, stroke = 1.6, fill = 'none', box = 24 } = {}) {
  const ns = 'http://www.w3.org/2000/svg';
  const el = document.createElementNS(ns, 'svg');
  el.setAttribute('viewBox', `0 0 ${box} ${box}`);
  el.setAttribute('width', size);
  el.setAttribute('height', size);
  el.setAttribute('fill', fill);
  el.setAttribute('stroke', 'currentColor');
  el.setAttribute('stroke-width', stroke);
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('aria-hidden', 'true');
  for (const d of [].concat(paths)) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    el.appendChild(p);
  }
  return el;
}

/** Run fn on the next frame — used to let a freshly inserted node animate in. */
export const nextFrame = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));

/**
 * Trap focus inside a container while it is open. Dialogs are unusable with a
 * keyboard without this, and a POS gets driven by keyboard far more than by
 * mouse once staff know it.
 */
export function trapFocus(container) {
  const selector =
    'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';
  function onKey(event) {
    if (event.key !== 'Tab') return;
    const items = $$(selector, container).filter((n) => n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  }
  container.addEventListener('keydown', onKey);
  return () => container.removeEventListener('keydown', onKey);
}
