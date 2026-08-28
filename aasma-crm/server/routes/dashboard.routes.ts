import { Router } from 'express';
import { asyncHandler } from '../lib/errors';
import type { AuthedRequest } from '../lib/auth';
import { getDashboardCharts, getDashboardSummary } from '../services/dashboard.service';
import { getLowStockRows } from '../services/stock.service';
import { prisma } from '../lib/prisma';
import { endOfDay, startOfDay } from '../lib/query';

export const dashboardRouter = Router();

dashboardRouter.get(
  '/summary',
  asyncHandler<AuthedRequest>(async (_req, res) => {
    res.json(await getDashboardSummary());
  }),
);

dashboardRouter.get(
  '/charts',
  asyncHandler<AuthedRequest>(async (_req, res) => {
    res.json(await getDashboardCharts());
  }),
);

/** The alert rail: overdue follow-ups, low stock and slipping milestones. */
dashboardRouter.get(
  '/alerts',
  asyncHandler<AuthedRequest>(async (_req, res) => {
    const today = new Date();
    const [followUps, lowStock, milestones, missingDpr] = await Promise.all([
      prisma.lead.findMany({
        where: { status: { notIn: ['WON', 'LOST'] }, followUpDate: { lte: endOfDay(today) } },
        select: { id: true, name: true, phone: true, followUpDate: true, status: true },
        orderBy: { followUpDate: 'asc' },
        take: 20,
      }),
      getLowStockRows(),
      prisma.milestone.findMany({
        where: { status: { not: 'DONE' }, dueDate: { lte: endOfDay(today) } },
        include: { project: { select: { name: true } } },
        orderBy: { dueDate: 'asc' },
        take: 20,
      }),
      prisma.project.findMany({
        where: {
          status: 'ACTIVE',
          dprs: { none: { reportDate: { gte: startOfDay(today), lte: endOfDay(today) } } },
        },
        select: { id: true, name: true },
        take: 20,
      }),
    ]);

    res.json({
      followUps,
      lowStock: lowStock.slice(0, 20),
      milestones,
      missingDpr,
    });
  }),
);

/** Recent audit entries, shown on the dashboard's activity card. */
dashboardRouter.get(
  '/activity',
  asyncHandler<AuthedRequest>(async (_req, res) => {
    const rows = await prisma.activityLog.findMany({ orderBy: { createdAt: 'desc' }, take: 25 });
    res.json(rows);
  }),
);
