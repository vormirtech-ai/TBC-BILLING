import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../lib/errors';
import type { AuthedRequest } from '../lib/auth';
import type { GlobalSearchHit } from '../../shared/types';

export const searchRouter = Router();

/**
 * Global search. One query across the seven things people actually look for,
 * capped so the palette stays instant on a laptop.
 */
searchRouter.get(
  '/',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const term = String(req.query.q ?? '').trim();
    if (term.length < 2) {
      res.json([] satisfies GlobalSearchHit[]);
      return;
    }
    const take = 6;

    const [leads, clients, properties, projects, workers, materials, dprs] = await Promise.all([
      prisma.lead.findMany({
        where: { OR: [{ name: { contains: term } }, { phone: { contains: term } }, { email: { contains: term } }] },
        take,
      }),
      prisma.client.findMany({
        where: { OR: [{ name: { contains: term } }, { phone: { contains: term } }, { panNo: { contains: term } }] },
        take,
      }),
      prisma.property.findMany({
        where: { OR: [{ unit: { contains: term } }, { tower: { contains: term } }] },
        include: { project: { select: { name: true } } },
        take,
      }),
      prisma.project.findMany({
        where: { OR: [{ name: { contains: term } }, { code: { contains: term } }, { location: { contains: term } }] },
        take,
      }),
      prisma.worker.findMany({
        where: { OR: [{ name: { contains: term } }, { mobile: { contains: term } }, { contractor: { contains: term } }] },
        take,
      }),
      prisma.material.findMany({ where: { name: { contains: term } }, take }),
      prisma.dpr.findMany({
        where: { OR: [{ workCompleted: { contains: term } }, { siteIssues: { contains: term } }] },
        include: { project: { select: { name: true } } },
        take,
      }),
    ]);

    const hits: GlobalSearchHit[] = [
      ...leads.map((row) => ({
        type: 'lead' as const,
        id: row.id,
        title: row.name,
        subtitle: `Lead • ${row.phone} • ${row.status}`,
        href: `/leads?focus=${row.id}`,
      })),
      ...clients.map((row) => ({
        type: 'client' as const,
        id: row.id,
        title: row.name,
        subtitle: `Client • ${row.phone}`,
        href: `/clients/${row.id}`,
      })),
      ...properties.map((row) => ({
        type: 'property' as const,
        id: row.id,
        title: `${row.tower}-${row.unit}`,
        subtitle: `Unit • ${row.project?.name ?? ''} • ${row.status}`,
        href: `/properties?focus=${row.id}`,
      })),
      ...projects.map((row) => ({
        type: 'project' as const,
        id: row.id,
        title: row.name,
        subtitle: `Project • ${row.code} • ${row.location}`,
        href: `/projects/${row.id}`,
      })),
      ...workers.map((row) => ({
        type: 'worker' as const,
        id: row.id,
        title: row.name,
        subtitle: `Worker • ${row.skill}${row.contractor ? ` • ${row.contractor}` : ''}`,
        href: `/labour?focus=${row.id}`,
      })),
      ...materials.map((row) => ({
        type: 'material' as const,
        id: row.id,
        title: row.name,
        subtitle: `Material • ${row.category} • ${row.unit}`,
        href: `/inventory?focus=${row.id}`,
      })),
      ...dprs.map((row) => ({
        type: 'dpr' as const,
        id: row.id,
        title: `DPR ${row.reportDate.toISOString().slice(0, 10)}`,
        subtitle: `${row.project?.name ?? ''} • ${row.workCompleted.slice(0, 60)}`,
        href: `/dpr?focus=${row.id}`,
      })),
    ];

    res.json(hits);
  }),
);
