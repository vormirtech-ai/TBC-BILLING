import type { Request } from 'express';
import { listQuerySchema, type ListQuery } from '../../shared/schemas';
import type { Paginated } from '../../shared/types';

export type Where = Record<string, unknown>;

export function parseListQuery(req: Request): ListQuery {
  return listQuerySchema.parse(req.query);
}

/**
 * Text search across the given columns. SQLite's LIKE is case-insensitive for
 * ASCII, which is what `contains` compiles to, so no extra collation is needed.
 */
export function searchFilter(term: string | undefined, fields: string[]): Where | null {
  const q = term?.trim();
  if (!q || fields.length === 0) return null;
  return { OR: fields.map((field) => ({ [field]: { contains: q } })) };
}

/** Inclusive from/to filter on a date column. */
export function dateFilter(field: string, from?: Date, to?: Date): Where | null {
  if (!from && !to) return null;
  const range: Record<string, Date> = {};
  if (from) range.gte = startOfDay(from);
  if (to) range.lte = endOfDay(to);
  return { [field]: range };
}

export function combine(...parts: (Where | null | undefined)[]): Where {
  const clauses = parts.filter((part): part is Where => Boolean(part));
  if (clauses.length === 0) return {};
  if (clauses.length === 1) return clauses[0];
  return { AND: clauses };
}

/** Only ever sort by a column we have explicitly allowed. */
export function orderBy(query: ListQuery, allowed: string[], fallback: string): Record<string, 'asc' | 'desc'> {
  const column = query.sortBy && allowed.includes(query.sortBy) ? query.sortBy : fallback;
  return { [column]: query.sortDir };
}

export function paginate(query: ListQuery): { skip: number; take: number } {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

export function toPage<T>(rows: T[], total: number, query: ListQuery): Paginated<T> {
  return {
    rows,
    total,
    page: query.page,
    pageSize: query.pageSize,
    pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

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
  const ms = startOfDay(to).getTime() - startOfDay(from).getTime();
  return Math.round(ms / 86_400_000);
}

export function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
