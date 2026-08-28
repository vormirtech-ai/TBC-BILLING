import { Router } from 'express';
import { asyncHandler, notFound } from '../lib/errors';
import type { AuthedRequest } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { buildAllForecasts, buildForecast, saveForecastSnapshot } from '../services/forecast.service';

export const forecastRouter = Router();

forecastRouter.get(
  '/',
  asyncHandler<AuthedRequest>(async (_req, res) => {
    res.json(await buildAllForecasts());
  }),
);

forecastRouter.get(
  '/:projectId',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const forecast = await buildForecast(Number(req.params.projectId));
    if (!forecast) throw notFound('Project');
    res.json(forecast);
  }),
);

/** Stores today's forecast so the trend chart has a data point. */
forecastRouter.post(
  '/:projectId/snapshot',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const forecast = await buildForecast(Number(req.params.projectId));
    if (!forecast) throw notFound('Project');
    await saveForecastSnapshot(forecast);
    res.status(201).json(forecast);
  }),
);

forecastRouter.get(
  '/:projectId/snapshots',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const rows = await prisma.forecastSnapshot.findMany({
      where: { projectId: Number(req.params.projectId) },
      orderBy: { runOn: 'asc' },
      take: 365,
    });
    res.json(rows);
  }),
);
