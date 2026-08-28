import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../lib/errors';
import { crudRouter } from '../lib/crud';
import { logActivity } from '../lib/activity';
import type { AuthedRequest } from '../lib/auth';
import { combine } from '../lib/query';
import { propertyImportSchema, propertySchema } from '../../shared/schemas';

export const propertiesRouter = Router();

const listInclude = {
  project: { select: { id: true, name: true, code: true } },
  bookings: {
    where: { status: 'ACTIVE' },
    select: { id: true, client: { select: { id: true, name: true } } },
  },
};

/**
 * Tower → floor → unit grid used by the property map. Returns every unit for a
 * project in one call so the map renders without further requests.
 */
propertiesRouter.get(
  '/map',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    const properties = await prisma.property.findMany({
      where: projectId ? { projectId } : {},
      include: { bookings: { where: { status: 'ACTIVE' }, select: { client: { select: { name: true } } } } },
      orderBy: [{ tower: 'asc' }, { floor: 'desc' }, { unit: 'asc' }],
    });

    const towers = new Map<string, Map<number, typeof properties>>();
    for (const property of properties) {
      const floors = towers.get(property.tower) ?? new Map<number, typeof properties>();
      const units = floors.get(property.floor) ?? [];
      units.push(property);
      floors.set(property.floor, units);
      towers.set(property.tower, floors);
    }

    res.json(
      Array.from(towers.entries()).map(([tower, floors]) => ({
        tower,
        floors: Array.from(floors.entries())
          .sort((a, b) => b[0] - a[0])
          .map(([floor, units]) => ({
            floor,
            units: units.map((unit) => ({
              id: unit.id,
              unit: unit.unit,
              unitType: unit.unitType,
              sizeSqft: unit.sizeSqft,
              price: unit.price,
              facing: unit.facing,
              status: unit.status,
              client: unit.bookings[0]?.client?.name ?? null,
            })),
          })),
      })),
    );
  }),
);

propertiesRouter.get(
  '/summary',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    const where = projectId ? { projectId } : {};
    const [byStatus, value] = await Promise.all([
      prisma.property.groupBy({ by: ['status'], where, _count: { _all: true }, _sum: { price: true } }),
      prisma.property.aggregate({ where, _sum: { price: true, sizeSqft: true }, _count: { _all: true } }),
    ]);
    res.json({
      byStatus: byStatus.map((row) => ({
        status: row.status,
        count: row._count._all,
        value: row._sum.price ?? 0,
      })),
      total: value._count._all,
      totalValue: value._sum.price ?? 0,
      totalArea: value._sum.sizeSqft ?? 0,
    });
  }),
);

/** Bulk import from the Properties screen (parsed from a pasted sheet). */
propertiesRouter.post(
  '/import',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { rows } = propertyImportSchema.parse(req.body);
    let created = 0;
    let updated = 0;

    for (const row of rows) {
      const existing = await prisma.property.findFirst({
        where: { projectId: row.projectId, tower: row.tower, unit: row.unit },
      });
      if (existing) {
        await prisma.property.update({ where: { id: existing.id }, data: row });
        updated += 1;
      } else {
        await prisma.property.create({ data: row });
        created += 1;
      }
    }

    await logActivity({
      actor: req.user?.username ?? 'system',
      action: 'IMPORT',
      entity: 'Property',
      detail: `${created} created, ${updated} updated`,
    });
    res.status(201).json({ created, updated });
  }),
);

propertiesRouter.use(
  crudRouter({
    delegate: prisma.property,
    entity: 'Property',
    schema: propertySchema,
    searchFields: ['tower', 'unit', 'unitType', 'notes'],
    sortable: ['tower', 'floor', 'unit', 'price', 'sizeSqft', 'status', 'createdAt'],
    defaultSort: 'tower',
    listInclude,
    filters: (query) =>
      combine(
        query.projectId ? { projectId: query.projectId } : null,
        query.status ? { status: query.status } : null,
      ),
  }),
);
