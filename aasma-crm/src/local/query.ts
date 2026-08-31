import type { Paginated } from '@shared/types';

/** Date and list helpers shared by the browser-side handlers. */

export function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000);
}

export function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function toDate(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dayKey(date: Date): string {
  return startOfDay(date).toISOString().slice(0, 10);
}

export interface ListOptions<T> {
  /** Fields matched, case-insensitively, against the ?q= term. */
  searchFields?: (keyof T)[];
  /** Field the ?from / ?to filters apply to. */
  dateField?: keyof T;
  sortable?: (keyof T | string)[];
  defaultSort?: keyof T | string;
  /** Extra filtering the caller wants applied. */
  filter?: (row: T) => boolean;
}

export interface Query {
  q?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  from?: string;
  to?: string;
  [key: string]: unknown;
}

function compare(left: unknown, right: unknown): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  if (left instanceof Date && right instanceof Date) return left.getTime() - right.getTime();
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right);
  return String(left).localeCompare(String(right), undefined, { numeric: true });
}

/**
 * Search, filter, sort and page a table the same way the Express API does, so
 * the screens behave identically whichever build they are running against.
 */
export function listRows<T extends Record<string, unknown>>(
  rows: T[],
  query: Query,
  options: ListOptions<T> = {},
): Paginated<T> {
  const term = String(query.q ?? '').trim().toLowerCase();
  const from = query.from ? startOfDay(new Date(String(query.from))) : null;
  const to = query.to ? endOfDay(new Date(String(query.to))) : null;

  let result = rows.filter((row) => {
    if (options.filter && !options.filter(row)) return false;

    if (term && options.searchFields?.length) {
      const hit = options.searchFields.some((field) => {
        const value = row[field];
        return value != null && String(value).toLowerCase().includes(term);
      });
      if (!hit) return false;
    }

    if ((from || to) && options.dateField) {
      const value = toDate(row[options.dateField]);
      if (!value) return false;
      if (from && value < from) return false;
      if (to && value > to) return false;
    }

    return true;
  });

  const sortable = (options.sortable ?? []).map(String);
  const sortBy =
    query.sortBy && sortable.includes(query.sortBy) ? query.sortBy : String(options.defaultSort ?? 'createdAt');
  const direction = query.sortDir === 'asc' ? 1 : -1;
  result = result.slice().sort((a, b) => compare(a[sortBy], b[sortBy]) * direction);

  const page = Math.max(1, Number(query.page ?? 1));
  const pageSize = Math.min(500, Math.max(1, Number(query.pageSize ?? 25)));
  const total = result.length;

  return {
    rows: result.slice((page - 1) * pageSize, page * pageSize),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export function byId<T extends { id: number }>(rows: T[], id: number): T | undefined {
  return rows.find((row) => row.id === id);
}

export function numberOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
