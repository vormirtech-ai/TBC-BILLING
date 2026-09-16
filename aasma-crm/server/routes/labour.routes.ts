import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler, badRequest } from '../lib/errors';
import { crudRouter } from '../lib/crud';
import { logActivity } from '../lib/activity';
import type { AuthedRequest } from '../lib/auth';
import { combine, endOfDay, round, startOfDay } from '../lib/query';
import { ATTENDANCE_WEIGHT, type AttendanceStatus } from '../../shared/constants';
import { attendanceDaySchema, workerSchema } from '../../shared/schemas';

export const workersRouter = Router();

workersRouter.get(
  '/options',
  asyncHandler<AuthedRequest>(async (_req, res) => {
    const rows = await prisma.worker.findMany({
      where: { active: true },
      select: { id: true, name: true, skill: true, dailyWage: true, contractor: true, projectId: true },
      orderBy: { name: 'asc' },
    });
    res.json(rows);
  }),
);

workersRouter.use(
  crudRouter({
    delegate: prisma.worker,
    entity: 'Worker',
    schema: workerSchema,
    searchFields: ['name', 'mobile', 'contractor', 'skill'],
    sortable: ['name', 'skill', 'dailyWage', 'joinedOn', 'createdAt'],
    defaultSort: 'name',
    listInclude: { project: { select: { id: true, name: true } } },
    filters: (query) =>
      combine(
        query.projectId ? { projectId: query.projectId } : null,
        query.skill ? { skill: query.skill } : null,
        query.status === 'INACTIVE' ? { active: false } : query.status === 'ACTIVE' ? { active: true } : null,
      ),
  }),
);

// ------------------------------------------------------------------ attendance

export const attendanceRouter = Router();

/**
 * The roster for one day: every active worker, with whatever was already marked.
 * The screen can therefore be opened for any date and saved as a whole.
 */
attendanceRouter.get(
  '/day',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const date = req.query.date ? new Date(String(req.query.date)) : new Date();
    if (Number.isNaN(date.getTime())) throw badRequest('Enter a valid date.');
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;

    const [workers, marked] = await Promise.all([
      prisma.worker.findMany({
        where: { active: true, ...(projectId ? { projectId } : {}) },
        orderBy: [{ contractor: 'asc' }, { name: 'asc' }],
      }),
      prisma.attendance.findMany({
        where: { markedOn: { gte: startOfDay(date), lte: endOfDay(date) } },
      }),
    ]);

    const markedMap = new Map(marked.map((row) => [row.workerId, row]));
    res.json({
      date: startOfDay(date).toISOString(),
      rows: workers.map((worker) => {
        const entry = markedMap.get(worker.id);
        return {
          workerId: worker.id,
          name: worker.name,
          skill: worker.skill,
          contractor: worker.contractor,
          dailyWage: worker.dailyWage,
          projectId: worker.projectId,
          status: entry?.status ?? null,
          overtimeHours: entry?.overtimeHours ?? 0,
          notes: entry?.notes ?? '',
          attendanceId: entry?.id ?? null,
        };
      }),
    });
  }),
);

/** Saves a whole day of attendance in one transaction. */
attendanceRouter.post(
  '/day',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const input = attendanceDaySchema.parse(req.body);
    const markedOn = startOfDay(input.markedOn);

    await prisma.$transaction(
      input.entries.map((entry) =>
        prisma.attendance.upsert({
          where: { workerId_markedOn: { workerId: entry.workerId, markedOn } },
          create: {
            workerId: entry.workerId,
            projectId: input.projectId ?? null,
            markedOn,
            status: entry.status,
            overtimeHours: entry.overtimeHours,
            notes: entry.notes ?? null,
          },
          update: {
            projectId: input.projectId ?? null,
            status: entry.status,
            overtimeHours: entry.overtimeHours,
            notes: entry.notes ?? null,
          },
        }),
      ),
    );

    await logActivity({
      actor: req.user?.username ?? 'system',
      action: 'ATTENDANCE',
      entity: 'Attendance',
      detail: `${input.entries.length} worker(s) for ${markedOn.toISOString().slice(0, 10)}`,
    });
    res.json({ saved: input.entries.length, date: markedOn.toISOString() });
  }),
);

/**
 * Monthly attendance sheet: one row per worker, one column per day, plus the
 * wage calculation for the month. Also feeds the attendance heatmap.
 */
attendanceRouter.get(
  '/sheet',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const monthParam = String(req.query.month ?? '');
    const match = /^(\d{4})-(\d{2})$/.exec(monthParam);
    const today = new Date();
    const year = match ? Number(match[1]) : today.getFullYear();
    const month = match ? Number(match[2]) - 1 : today.getMonth();

    const from = startOfDay(new Date(year, month, 1));
    const to = endOfDay(new Date(year, month + 1, 0));
    const daysInMonth = to.getDate();
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;

    const [workers, attendance] = await Promise.all([
      prisma.worker.findMany({
        where: { active: true, ...(projectId ? { projectId } : {}) },
        orderBy: [{ contractor: 'asc' }, { name: 'asc' }],
      }),
      prisma.attendance.findMany({
        where: { markedOn: { gte: from, lte: to }, ...(projectId ? { projectId } : {}) },
      }),
    ]);

    const byWorker = new Map<number, Map<number, { status: string; overtimeHours: number }>>();
    for (const row of attendance) {
      const day = row.markedOn.getDate();
      const days = byWorker.get(row.workerId) ?? new Map();
      days.set(day, { status: row.status, overtimeHours: row.overtimeHours });
      byWorker.set(row.workerId, days);
    }

    const rows = workers.map((worker) => {
      const days = byWorker.get(worker.id) ?? new Map();
      let labourDays = 0;
      let overtime = 0;
      let present = 0;
      let halfDay = 0;
      let absent = 0;

      const cells: (null | { status: string; overtimeHours: number })[] = [];
      for (let day = 1; day <= daysInMonth; day += 1) {
        const cell = days.get(day) ?? null;
        cells.push(cell);
        if (!cell) continue;
        labourDays += ATTENDANCE_WEIGHT[cell.status as AttendanceStatus] ?? 0;
        overtime += cell.overtimeHours;
        if (cell.status === 'PRESENT') present += 1;
        else if (cell.status === 'HALF_DAY') halfDay += 1;
        else absent += 1;
      }

      const basePay = labourDays * worker.dailyWage;
      const overtimePay = (worker.dailyWage / 8) * overtime;
      return {
        workerId: worker.id,
        name: worker.name,
        skill: worker.skill,
        contractor: worker.contractor ?? '',
        dailyWage: worker.dailyWage,
        cells,
        present,
        halfDay,
        absent,
        labourDays: round(labourDays, 2),
        overtimeHours: round(overtime, 2),
        basePay: round(basePay, 2),
        overtimePay: round(overtimePay, 2),
        payable: round(basePay + overtimePay, 2),
      };
    });

    res.json({
      month: `${year}-${String(month + 1).padStart(2, '0')}`,
      daysInMonth,
      rows,
      totals: {
        labourDays: round(
          rows.reduce((acc, row) => acc + row.labourDays, 0),
          2,
        ),
        payable: round(
          rows.reduce((acc, row) => acc + row.payable, 0),
          2,
        ),
        workers: rows.length,
      },
    });
  }),
);

/**
 * Labour consumption: labour-days, cost and productivity for a period. This is
 * the "50 workers × 7 days = 350 labour-days" view.
 */
attendanceRouter.get(
  '/consumption',
  asyncHandler<AuthedRequest>(async (req, res) => {
    const to = req.query.to ? endOfDay(new Date(String(req.query.to))) : endOfDay(new Date());
    const from = req.query.from
      ? startOfDay(new Date(String(req.query.from)))
      : startOfDay(new Date(to.getFullYear(), to.getMonth(), 1));
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;

    const rows = await prisma.attendance.findMany({
      where: { markedOn: { gte: from, lte: to }, ...(projectId ? { projectId } : {}) },
      include: { worker: { select: { name: true, skill: true, dailyWage: true } } },
    });

    let labourDays = 0;
    let cost = 0;
    const bySkill = new Map<string, { skill: string; labourDays: number; cost: number }>();
    const byDay = new Map<string, number>();
    const workers = new Set<number>();

    for (const row of rows) {
      const weight = ATTENDANCE_WEIGHT[row.status as AttendanceStatus] ?? 0;
      const wage = row.worker?.dailyWage ?? 0;
      const pay = wage * weight + (wage / 8) * row.overtimeHours;
      labourDays += weight;
      cost += pay;
      workers.add(row.workerId);

      const skill = row.worker?.skill ?? 'HELPER';
      const entry = bySkill.get(skill) ?? { skill, labourDays: 0, cost: 0 };
      entry.labourDays += weight;
      entry.cost += pay;
      bySkill.set(skill, entry);

      const day = row.markedOn.toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + weight);
    }

    // Productivity is expressed against recorded construction progress so the
    // number means "progress delivered per labour-day".
    const stages = await prisma.projectStage.findMany({
      where: projectId ? { projectId } : {},
      select: { weight: true, progress: true },
    });
    const totalWeight = stages.reduce((acc, stage) => acc + (stage.weight > 0 ? stage.weight : 1), 0) || 1;
    const progress = round(
      stages.reduce((acc, stage) => acc + stage.progress * (stage.weight > 0 ? stage.weight : 1), 0) / totalWeight,
      2,
    );

    res.json({
      from: from.toISOString(),
      to: to.toISOString(),
      labourDays: round(labourDays, 2),
      cost: round(cost, 2),
      workers: workers.size,
      avgCostPerLabourDay: labourDays > 0 ? round(cost / labourDays, 2) : 0,
      progress,
      productivity: labourDays > 0 ? round(progress / labourDays, 4) : 0,
      bySkill: Array.from(bySkill.values())
        .map((entry) => ({ ...entry, labourDays: round(entry.labourDays, 2), cost: round(entry.cost, 2) }))
        .sort((a, b) => b.labourDays - a.labourDays),
      byDay: Array.from(byDay.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, value]) => ({ date, labourDays: round(value, 2) })),
    });
  }),
);
