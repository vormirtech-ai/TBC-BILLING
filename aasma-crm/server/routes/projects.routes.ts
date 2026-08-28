import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler, notFound } from '../lib/errors';
import { crudRouter } from '../lib/crud';
import { logActivity } from '../lib/activity';
import type { AuthedRequest } from '../lib/auth';
import { round } from '../lib/query';
import { DEFAULT_STAGES } from '../../shared/constants';
import { milestoneSchema, projectSchema, stageProgressSchema, stageSchema } from '../../shared/schemas';

export const projectsRouter = Router();

const listInclude = {
  stages: { orderBy: { sortOrder: 'asc' as const } },
  _count: { select: { properties: true, dprs: true, milestones: true } },
};

/** Compact list for dropdowns — no relations, no pagination envelope. */
projectsRouter.get(
  '/options',
  asyncHandler<AuthedRequest>(async (_req, res) => {
    const rows = await prisma.project.findMany({
      select: { id: true, name: true, code: true, status: true },
      orderBy: { name: 'asc' },
    });
    res.json(rows);
  }),
);

projectsRouter.get(
  '/:id/stages',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const projectId = Number(req.params.id);
    const stages = await prisma.projectStage.findMany({
      where: { projectId },
      orderBy: { sortOrder: 'asc' },
      include: { progressLogs: { orderBy: { recordedOn: 'desc' }, take: 20 } },
    });
    res.json(stages);
  }),
);

projectsRouter.post(
  '/:id/stages',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const projectId = Number(req.params.id);
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw notFound('Project');

    const input = stageSchema.parse(req.body);
    const stage = await prisma.projectStage.create({ data: { ...input, projectId } });
    res.status(201).json(stage);
  }),
);

/**
 * Recording progress writes both the current value and a history row — the
 * history is what the forecasting engine measures the rate of work from.
 */
projectsRouter.post(
  '/stages/:stageId/progress',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const stageId = Number(req.params.stageId);
    const stage = await prisma.projectStage.findUnique({ where: { id: stageId } });
    if (!stage) throw notFound('Stage');

    const input = stageProgressSchema.parse(req.body);
    if (input.progress < stage.progress) {
      // Allowed (corrections happen) but worth recording explicitly.
      await logActivity({
        actor: req.user?.username ?? 'system',
        action: 'PROGRESS_DOWN',
        entity: 'ProjectStage',
        entityId: stageId,
        detail: `${stage.progress}% → ${input.progress}%`,
      });
    }

    const [updated] = await prisma.$transaction([
      prisma.projectStage.update({ where: { id: stageId }, data: { progress: input.progress } }),
      prisma.stageProgressLog.create({
        data: {
          stageId,
          progress: input.progress,
          recordedOn: input.recordedOn,
          note: input.note ?? null,
        },
      }),
    ]);

    res.json(updated);
  }),
);

projectsRouter.put(
  '/stages/:stageId',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const stageId = Number(req.params.stageId);
    const input = stageSchema.parse(req.body);
    const stage = await prisma.projectStage.update({ where: { id: stageId }, data: input });
    res.json(stage);
  }),
);

projectsRouter.delete(
  '/stages/:stageId',
  asyncHandler<AuthedRequest>(async (req, res) => {
    await prisma.projectStage.delete({ where: { id: Number(req.params.stageId) } });
    res.json({ ok: true });
  }),
);

/** Progress, spend and open milestones for one project. */
projectsRouter.get(
  '/:id/overview',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const projectId = Number(req.params.id);
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { stages: { orderBy: { sortOrder: 'asc' } }, milestones: { orderBy: { dueDate: 'asc' } } },
    });
    if (!project) throw notFound('Project');

    const [properties, usage, attendance, dprCount] = await Promise.all([
      prisma.property.groupBy({ by: ['status'], where: { projectId }, _count: { _all: true } }),
      prisma.materialUsage.findMany({
        where: { projectId },
        include: { material: { select: { rate: true } } },
      }),
      prisma.attendance.count({ where: { projectId } }),
      prisma.dpr.count({ where: { projectId } }),
    ]);

    const totalWeight = project.stages.reduce((acc, stage) => acc + (stage.weight > 0 ? stage.weight : 1), 0) || 1;
    const progress = round(
      project.stages.reduce((acc, stage) => acc + stage.progress * (stage.weight > 0 ? stage.weight : 1), 0) / totalWeight,
      1,
    );

    res.json({
      project,
      progress,
      properties: Object.fromEntries(properties.map((row) => [row.status, row._count._all])),
      materialValue: round(
        usage.reduce((acc, row) => acc + row.quantity * (row.material?.rate ?? 0), 0),
        2,
      ),
      attendanceEntries: attendance,
      dprCount,
    });
  }),
);

projectsRouter.use(
  crudRouter({
    delegate: prisma.project,
    entity: 'Project',
    schema: projectSchema,
    searchFields: ['name', 'code', 'location', 'contractor', 'engineer'],
    sortable: ['name', 'code', 'startDate', 'expectedEndDate', 'budget', 'createdAt'],
    defaultSort: 'startDate',
    dateField: 'startDate',
    listInclude,
    filters: (query) => (query.status ? { status: query.status } : null),
    /** A new project starts with the standard construction stages. */
    afterWrite: async (row, mode) => {
      if (mode !== 'create') return;
      await prisma.projectStage.createMany({
        data: DEFAULT_STAGES.map((stage, index) => ({
          projectId: row.id,
          name: stage.name,
          weight: stage.weight,
          progress: 0,
          sortOrder: index,
        })),
      });
    },
  }),
);

// ------------------------------------------------------------------ milestones

export const milestonesRouter = Router();

milestonesRouter.use(
  crudRouter({
    delegate: prisma.milestone,
    entity: 'Milestone',
    schema: milestoneSchema,
    searchFields: ['title', 'notes'],
    sortable: ['dueDate', 'status', 'createdAt'],
    defaultSort: 'dueDate',
    dateField: 'dueDate',
    listInclude: { project: { select: { id: true, name: true } } },
    filters: (query) =>
      query.projectId ? { projectId: query.projectId } : query.status ? { status: query.status } : null,
  }),
);
