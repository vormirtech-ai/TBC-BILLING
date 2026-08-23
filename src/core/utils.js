/** Small shared helpers: DOM building, ids, dates, files. No dependencies. */

/* --------------------------------------------------------------- DOM --- */

/**
 * el('div.card', { onclick }, [children])
 * Tag syntax supports #id and .class shorthands.
 */
export function el(spec, props = {}, children = []) {
  const text = String(spec);
  const idMatch = text.match(/#([A-Za-z0-9_-]+)/);
  const [tag, ...classes] = text.replace(/#[A-Za-z0-9_-]+/, '').split('.');

  const node = document.createElement(tag || 'div');
  if (idMatch) node.id = idMatch[1];
  if (classes.length) node.className = classes.filter(Boolean).join(' ');

  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = `${node.className} ${value}`.trim();
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value);
    } else if (key in node && typeof value !== 'object') {
      try {
        node[key] = value;
      } catch {
        node.setAttribute(key, value);
      }
    } else {
      node.setAttribute(key, value);
    }
  }

  append(node, children);
  return node;
}

export function append(parent, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* --------------------------------------------------------------- ids --- */

export function uid(prefix = 'id') {
  const random =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${Date.now().toString(36)}${random}`;
}

/* -------------------------------------------------------------- dates --- */

export function pad(value, length = 2) {
  return String(value).padStart(length, '0');
}

/** Local calendar date as YYYY-MM-DD (never UTC — a cafe trades in local time). */
export function toDateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fromDateKey(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/**
 * The business date for an instant, honouring a late-night rollover hour.
 * With rolloverHour = 4, a sale at 01:30 belongs to the previous calendar day.
 */
export function businessDateKey(date = new Date(), rolloverHour = 0) {
  const shifted = new Date(date.getTime());
  if (rolloverHour > 0 && shifted.getHours() < rolloverHour) {
    shifted.setDate(shifted.getDate() - 1);
  }
  return toDateKey(shifted);
}

const DATE_FMT = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});
const TIME_FMT = new Intl.DateTimeFormat('en-IN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});
const TIME_FULL_FMT = new Intl.DateTimeFormat('en-IN', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
});

export function formatDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : DATE_FMT.format(date);
}
export function formatTime(value, withSeconds = false) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return (withSeconds ? TIME_FULL_FMT : TIME_FMT).format(date);
}
export function formatDateTime(value) {
  return `${formatDate(value)}, ${formatTime(value)}`;
}
export function formatDateKeyLong(key) {
  return formatDate(fromDateKey(key));
}

/* -------------------------------------------------------------- files --- */

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke late: Safari needs the object alive until the download starts.
  setTimeout(() => URL.revokeObjectURL(url), 20000);
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.readAsText(file);
  });
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('That image could not be read.'));
    reader.readAsDataURL(file);
  });
}

/* --------------------------------------------------------------- misc --- */

export function debounce(fn, wait = 200) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/** Case/diacritic-insensitive substring match used by every search box. */
export function matchesQuery(haystack, query) {
  if (!query) return true;
  const normalise = (text) =>
    String(text ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  return normalise(haystack).includes(normalise(query));
}

export function sum(list, pick = (x) => x) {
  return list.reduce((total, item) => total + (Number(pick(item)) || 0), 0);
}

export function groupBy(list, pick) {
  const map = new Map();
  for (const item of list) {
    const key = pick(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

/** Error type whose message is safe to show to a cashier. */
export class AppError extends Error {
  constructor(message, code = 'APP_ERROR') {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}
