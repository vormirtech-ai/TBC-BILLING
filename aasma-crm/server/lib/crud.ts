import { Router } from 'express';
import type { ZodTypeAny } from 'zod';
import { asyncHandler, notFound } from './errors';
import { logActivity } from './activity';
import type { AuthedRequest } from './auth';
import { combine, dateFilter, orderBy, paginate, parseListQuery, searchFilter, toPage, type Where } from './query';
import type { ListQuery } from '../../shared/schemas';

/**
 * The subset of a Prisma model delegate this factory needs. Prisma generates a
 * differently-typed delegate per model, so the shared shape is declared here
 * rather than fighting the generated generics.
 */
export interface Delegate {
  findMany(args?: any): Promise<any[]>;
  count(args?: any): Promise<number>;
  findUnique(args: any): Promise<any | null>;
  create(args: any): Promise<any>;
  update(args: any): Promise<any>;
  delete(args: any): Promise<any>;
}

export interface CrudOptions {
  delegate: Delegate;
  /** Human label used in messages and the audit log, e.g. "Lead". */
  entity: string;
  schema: ZodTypeAny;
  /** Schema used for updates when it differs from the create schema. */
  updateSchema?: ZodTypeAny;
  searchFields?: string[];
  sortable?: string[];
  defaultSort?: string;
  /** Column the ?from / ?to filters apply to. */
  dateField?: string;
  /** Relations to load for a list request. */
  listInclude?: any;
  /** Relations to load for a single record. */
  detailInclude?: any;
  /** Extra where-clause built from the query string. */
  filters?: (query: ListQuery) => Where | null;
  /** Maps validated input onto the Prisma data object. */
  toData?: (input: any, mode: 'create' | 'update') => any;
  /** Runs inside the request, after the row is written. */
  afterWrite?: (row: any, mode: 'create' | 'update', actor: string) => Promise<void>;
  /** Runs before a delete; throw to block it. */
  beforeDelete?: (id: number) => Promise<void>;
}

/**
 * Builds the five routes every master screen needs. Each resource still owns
 * its validation, filters and relations — only the plumbing is shared.
 */
export function crudRouter(options: CrudOptions): Router {
  const router = Router();
  const sortable = options.sortable ?? ['id', 'createdAt'];
  const defaultSort = options.defaultSort ?? 'createdAt';
  const label = options.entity;

  router.get(
    '/',
    asyncHandler<AuthedRequest>(async (req, res) => {
      const query = parseListQuery(req);
      const where = combine(
        searchFilter(query.q, options.searchFields ?? []),
        options.dateField ? dateFilter(options.dateField, query.from, query.to) : null,
        options.filters?.(query) ?? null,
      );

      const [rows, total] = await Promise.all([
        options.delegate.findMany({
          where,
          include: options.listInclude,
          orderBy: orderBy(query, sortable, defaultSort),
          ...paginate(query),
        }),
        options.delegate.count({ where }),
      ]);

      res.json(toPage(rows, total, query));
    }),
  );

  router.get(
    '/:id',
    asyncHandler<AuthedRequest>(async (req, res) => {
      const id = Number(req.params.id);
      const row = await options.delegate.findUnique({
        where: { id },
        include: options.detailInclude ?? options.listInclude,
      });
      if (!row) throw notFound(label);
      res.json(row);
    }),
  );

  router.post(
    '/',
    asyncHandler<AuthedRequest>(async (req, res) => {
      const input = options.schema.parse(req.body);
      const data = options.toData ? options.toData(input, 'create') : input;
      const row = await options.delegate.create({ data, include: options.detailInclude });
      const actor = req.user?.username ?? 'system';
      await options.afterWrite?.(row, 'create', actor);
      await logActivity({ actor, action: 'CREATE', entity: label, entityId: row.id });
      res.status(201).json(row);
    }),
  );

  router.put(
    '/:id',
    asyncHandler<AuthedRequest>(async (req, res) => {
      const id = Number(req.params.id);
      const existing = await options.delegate.findUnique({ where: { id } });
      if (!existing) throw notFound(label);

      const input = (options.updateSchema ?? options.schema).parse(req.body);
      const data = options.toData ? options.toData(input, 'update') : input;
      const row = await options.delegate.update({ where: { id }, data, include: options.detailInclude });
      const actor = req.user?.username ?? 'system';
      await options.afterWrite?.(row, 'update', actor);
      await logActivity({ actor, action: 'UPDATE', entity: label, entityId: id });
      res.json(row);
    }),
  );

  router.delete(
    '/:id',
    asyncHandler<AuthedRequest>(async (req, res) => {
      const id = Number(req.params.id);
      const existing = await options.delegate.findUnique({ where: { id } });
      if (!existing) throw notFound(label);
      await options.beforeDelete?.(id);
      await options.delegate.delete({ where: { id } });
      await logActivity({
        actor: req.user?.username ?? 'system',
        action: 'DELETE',
        entity: label,
        entityId: id,
      });
      res.json({ ok: true });
    }),
  );

  return router;
}
