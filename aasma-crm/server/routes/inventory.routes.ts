import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler, badRequest } from '../lib/errors';
import { crudRouter } from '../lib/crud';
import type { AuthedRequest } from '../lib/auth';
import { addDays, combine, endOfDay, round, startOfDay } from '../lib/query';
import { materialSchema, materialUsageSchema, purchaseSchema, stockAdjustmentSchema } from '../../shared/schemas';
import { getStockForMaterial, getStockRows } from '../services/stock.service';

export const materialsRouter = Router();

materialsRouter.get(
  '/options',
  asyncHandler<AuthedRequest>(async (_req, res) => {
    const rows = await prisma.material.findMany({
      where: { active: true },
      select: { id: true, name: true, unit: true, rate: true, category: true },
      orderBy: { name: 'asc' },
    });
    res.json(rows);
  }),
);

/** Live stock for every material, with a low-stock flag. */
materialsRouter.get(
  '/stock',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const rows = await getStockRows({
      q: typeof req.query.q === 'string' ? req.query.q : undefined,
      category: typeof req.query.category === 'string' ? req.query.category : undefined,
    });
    res.json({
      rows,
      totals: {
        materials: rows.length,
        stockValue: round(
          rows.reduce((acc, row) => acc + row.stockValue, 0),
          2,
        ),
        lowStock: rows.filter((row) => row.low).length,
      },
    });
  }),
);

/** Every movement for one material, newest first. */
materialsRouter.get(
  '/:id/ledger',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const materialId = Number(req.params.id);
    const [purchases, usages, adjustments, stock] = await Promise.all([
      prisma.purchase.findMany({ where: { materialId }, include: { project: { select: { name: true } } } }),
      prisma.materialUsage.findMany({ where: { materialId }, include: { project: { select: { name: true } } } }),
      prisma.stockAdjustment.findMany({ where: { materialId } }),
      getStockForMaterial(materialId),
    ]);

    const entries = [
      ...purchases.map((row) => ({
        id: `P${row.id}`,
        at: row.purchasedOn.toISOString(),
        type: 'PURCHASE' as const,
        quantity: row.quantity,
        detail: `${row.supplier ?? 'Purchase'}${row.invoiceNo ? ` • ${row.invoiceNo}` : ''}`,
        project: row.project?.name ?? '',
      })),
      ...usages.map((row) => ({
        id: `U${row.id}`,
        at: row.usedOn.toISOString(),
        type: 'ISSUE' as const,
        quantity: -row.quantity,
        detail: row.issuedTo ? `Issued to ${row.issuedTo}` : 'Issued to site',
        project: row.project?.name ?? '',
      })),
      ...adjustments.map((row) => ({
        id: `A${row.id}`,
        at: row.adjustedOn.toISOString(),
        type: 'ADJUSTMENT' as const,
        quantity: row.quantity,
        detail: row.reason,
        project: '',
      })),
    ].sort((a, b) => b.at.localeCompare(a.at));

    res.json({ stock, entries });
  }),
);

materialsRouter.use(
  crudRouter({
    delegate: prisma.material,
    entity: 'Material',
    schema: materialSchema,
    searchFields: ['name', 'category', 'unit'],
    sortable: ['name', 'category', 'rate', 'createdAt'],
    defaultSort: 'name',
    filters: (query) => (query.category ? { category: query.category } : null),
  }),
);

// ------------------------------------------------------------------ purchases

export const purchasesRouter = Router();

purchasesRouter.use(
  crudRouter({
    delegate: prisma.purchase,
    entity: 'Purchase',
    schema: purchaseSchema,
    searchFields: ['supplier', 'invoiceNo', 'notes'],
    sortable: ['purchasedOn', 'amount', 'quantity', 'createdAt'],
    defaultSort: 'purchasedOn',
    dateField: 'purchasedOn',
    listInclude: {
      material: { select: { id: true, name: true, unit: true } },
      project: { select: { id: true, name: true } },
    },
    filters: (query) =>
      combine(
        query.materialId ? { materialId: query.materialId } : null,
        query.projectId ? { projectId: query.projectId } : null,
      ),
    // Amount is always quantity × rate, never whatever the client sent.
    toData: (input) => ({ ...input, amount: round(input.quantity * input.rate, 2) }),
  }),
);

// ------------------------------------------------------------------ issues

export const usageRouter = Router();

usageRouter.use(
  crudRouter({
    delegate: prisma.materialUsage,
    entity: 'Material issue',
    schema: materialUsageSchema,
    searchFields: ['issuedTo', 'notes'],
    sortable: ['usedOn', 'quantity', 'createdAt'],
    defaultSort: 'usedOn',
    dateField: 'usedOn',
    listInclude: {
      material: { select: { id: true, name: true, unit: true, rate: true } },
      project: { select: { id: true, name: true } },
    },
    filters: (query) =>
      combine(
        query.materialId ? { materialId: query.materialId } : null,
        query.projectId ? { projectId: query.projectId } : null,
      ),
  }),
);

/** Consumption summary used by the Material Consumption report card. */
usageRouter.get(
  '/summary/consumption',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    const from = req.query.from ? new Date(String(req.query.from)) : addDays(to, -29);
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;

    const usages = await prisma.materialUsage.findMany({
      where: {
        usedOn: { gte: startOfDay(from), lte: endOfDay(to) },
        ...(projectId ? { projectId } : {}),
      },
      include: { material: { select: { name: true, unit: true, rate: true } } },
    });

    const byMaterial = new Map<string, { name: string; unit: string; quantity: number; value: number }>();
    const byDay = new Map<string, number>();
    for (const usage of usages) {
      const name = usage.material?.name ?? `Material ${usage.materialId}`;
      const entry = byMaterial.get(name) ?? { name, unit: usage.material?.unit ?? '', quantity: 0, value: 0 };
      entry.quantity += usage.quantity;
      entry.value += usage.quantity * (usage.material?.rate ?? 0);
      byMaterial.set(name, entry);

      const day = usage.usedOn.toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + usage.quantity * (usage.material?.rate ?? 0));
    }

    const stock = await getStockRows();
    const stockByName = new Map(stock.map((row) => [row.name, row.inStock]));

    res.json({
      from: startOfDay(from).toISOString(),
      to: endOfDay(to).toISOString(),
      byMaterial: Array.from(byMaterial.values())
        .map((entry) => ({
          ...entry,
          quantity: round(entry.quantity, 2),
          value: round(entry.value, 2),
          remaining: stockByName.get(entry.name) ?? 0,
        }))
        .sort((a, b) => b.value - a.value),
      byDay: Array.from(byDay.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, value]) => ({ date, value: round(value, 2) })),
      totalValue: round(
        usages.reduce((acc, row) => acc + row.quantity * (row.material?.rate ?? 0), 0),
        2,
      ),
    });
  }),
);

// ------------------------------------------------------------------ adjustments

export const adjustmentsRouter = Router();

adjustmentsRouter.use(
  crudRouter({
    delegate: prisma.stockAdjustment,
    entity: 'Stock adjustment',
    schema: stockAdjustmentSchema,
    searchFields: ['reason', 'notes'],
    sortable: ['adjustedOn', 'quantity', 'createdAt'],
    defaultSort: 'adjustedOn',
    dateField: 'adjustedOn',
    listInclude: { material: { select: { id: true, name: true, unit: true } } },
    filters: (query) => (query.materialId ? { materialId: query.materialId } : null),
  }),
);

/** Guard: never let an adjustment push recorded stock below zero. */
adjustmentsRouter.post(
  '/validate',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const input = stockAdjustmentSchema.parse(req.body);
    const stock = await getStockForMaterial(input.materialId);
    if (!stock) throw badRequest('Unknown material.');
    const resulting = round(stock.inStock + input.quantity, 3);
    res.json({ current: stock.inStock, resulting, allowed: resulting >= 0 });
  }),
);
