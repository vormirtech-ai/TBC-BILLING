import { prisma } from '../lib/prisma';
import { addDays, daysBetween, round, startOfDay } from '../lib/query';
import { ATTENDANCE_WEIGHT, type AttendanceStatus, type RiskLevel } from '../../shared/constants';
import type { ProjectForecast, StageForecast } from '../../shared/types';

/**
 * The forecasting engine.
 *
 * Everything here is derived from data the site team already enters — stage
 * progress, attendance and material issues — so no separate planning module has
 * to be kept up to date. The method is deliberately simple and explainable:
 *
 *   1. Project progress is the weight-averaged progress of its stages.
 *   2. The rate of progress comes from the recorded progress history: the change
 *      in overall progress divided by the days between the first and last entry.
 *      With too little history it falls back to progress-since-start.
 *   3. Remaining work divided by that rate gives the days left, and therefore an
 *      estimated completion date.
 *   4. Labour and material requirements are scaled by observed productivity
 *      (progress achieved per labour-day, material consumed per progress point).
 *
 * Every number the UI shows in a traffic light is accompanied by a note
 * explaining how it was reached.
 */

const MIN_RATE = 0.0001;

interface StageWithLogs {
  id: number;
  name: string;
  weight: number;
  progress: number;
  progressLogs: { progress: number; recordedOn: Date }[];
}

/** Weighted overall progress using the latest log on or before `date`. */
function progressOn(stages: StageWithLogs[], date: Date, totalWeight: number): number {
  const sum = stages.reduce((acc, stage) => {
    const applicable = stage.progressLogs.filter((log) => log.recordedOn.getTime() <= date.getTime());
    const value = applicable.length > 0 ? applicable[applicable.length - 1].progress : 0;
    return acc + value * stage.weight;
  }, 0);
  return round(sum / totalWeight, 2);
}

function currentProgress(stages: StageWithLogs[], totalWeight: number): number {
  const sum = stages.reduce((acc, stage) => acc + stage.progress * stage.weight, 0);
  return round(sum / totalWeight, 2);
}

/** Average progress per day for one stage, from its own history. */
function stageRate(stage: StageWithLogs, projectStart: Date, today: Date): number {
  const logs = stage.progressLogs;
  if (logs.length >= 2) {
    const first = logs[0];
    const last = logs[logs.length - 1];
    const days = Math.max(1, daysBetween(first.recordedOn, last.recordedOn));
    const rate = (last.progress - first.progress) / days;
    if (rate > MIN_RATE) return rate;
  }
  const elapsed = Math.max(1, daysBetween(projectStart, today));
  return stage.progress > 0 ? stage.progress / elapsed : 0;
}

function riskFor(delayDays: number, plannedDuration: number): RiskLevel {
  if (delayDays <= 0) return 'GREEN';
  const tolerance = Math.max(7, Math.round(plannedDuration * 0.05));
  return delayDays <= tolerance ? 'YELLOW' : 'RED';
}

export async function buildForecast(projectId: number, today = new Date()): Promise<ProjectForecast | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      stages: {
        orderBy: { sortOrder: 'asc' },
        include: { progressLogs: { orderBy: { recordedOn: 'asc' } } },
      },
    },
  });
  if (!project) return null;

  const now = startOfDay(today);
  const stages: StageWithLogs[] = project.stages.map((stage) => ({
    id: stage.id,
    name: stage.name,
    weight: stage.weight > 0 ? stage.weight : 1,
    progress: stage.progress,
    progressLogs: stage.progressLogs.map((log) => ({ progress: log.progress, recordedOn: log.recordedOn })),
  }));
  const totalWeight = stages.reduce((acc, stage) => acc + stage.weight, 0) || 1;

  const progressPct = stages.length > 0 ? currentProgress(stages, totalWeight) : 0;
  const notes: string[] = [];

  // ---- progress history ------------------------------------------------
  const logDates = Array.from(
    new Set(stages.flatMap((stage) => stage.progressLogs.map((log) => startOfDay(log.recordedOn).getTime()))),
  )
    .sort((a, b) => a - b)
    .map((time) => new Date(time));

  const history = logDates.map((date) => ({
    date: date.toISOString().slice(0, 10),
    progress: progressOn(stages, date, totalWeight),
  }));

  const daysElapsed = Math.max(0, daysBetween(project.startDate, now));
  const plannedDuration = Math.max(1, daysBetween(project.startDate, project.expectedEndDate));

  let avgDailyProgress = 0;
  if (history.length >= 2) {
    const first = history[0];
    const last = history[history.length - 1];
    const span = Math.max(1, daysBetween(new Date(first.date), new Date(last.date)));
    avgDailyProgress = (last.progress - first.progress) / span;
    notes.push(
      `Rate measured from ${history.length} progress updates between ${first.date} and ${last.date}.`,
    );
  }
  if (avgDailyProgress <= MIN_RATE) {
    avgDailyProgress = daysElapsed > 0 ? progressPct / daysElapsed : 0;
    if (history.length < 2) {
      notes.push('Not enough progress history yet — rate estimated from progress since the start date.');
    }
  }
  avgDailyProgress = round(Math.max(0, avgDailyProgress), 4);

  // ---- completion estimate --------------------------------------------
  const remaining = Math.max(0, 100 - progressPct);
  let estimatedDaysRemaining: number | null = null;
  let estimatedCompletion: Date | null = null;

  if (remaining <= 0) {
    estimatedDaysRemaining = 0;
    estimatedCompletion = now;
    notes.push('All stages are reported complete.');
  } else if (avgDailyProgress > MIN_RATE) {
    estimatedDaysRemaining = Math.ceil(remaining / avgDailyProgress);
    estimatedCompletion = addDays(now, estimatedDaysRemaining);
  } else {
    notes.push('No measurable progress recorded yet, so a completion date cannot be estimated.');
  }

  const daysRemainingPlanned = daysBetween(now, project.expectedEndDate);
  let delayDays = 0;
  if (estimatedCompletion) {
    delayDays = Math.max(0, daysBetween(project.expectedEndDate, estimatedCompletion));
  } else if (daysRemainingPlanned < 0) {
    delayDays = Math.abs(daysRemainingPlanned);
  }

  let riskLevel = riskFor(delayDays, plannedDuration);
  if (!estimatedCompletion && progressPct < 100) riskLevel = daysRemainingPlanned < 0 ? 'RED' : 'YELLOW';
  if (project.status === 'ON_HOLD') {
    riskLevel = 'RED';
    notes.push('Project is on hold — the estimate assumes work restarts immediately.');
  }
  if (delayDays > 0) {
    notes.push(`Running ${delayDays} day(s) past the planned end date of ${project.expectedEndDate.toISOString().slice(0, 10)}.`);
  }

  // ---- labour ----------------------------------------------------------
  const attendances = await prisma.attendance.findMany({
    where: { projectId },
    include: { worker: { select: { dailyWage: true } } },
  });

  let labourDaysUsed = 0;
  let labourCostToDate = 0;
  const attendanceDates = new Set<string>();
  for (const row of attendances) {
    const weight = ATTENDANCE_WEIGHT[row.status as AttendanceStatus] ?? 0;
    labourDaysUsed += weight;
    const wage = row.worker?.dailyWage ?? 0;
    const overtimePay = (wage / 8) * row.overtimeHours;
    labourCostToDate += wage * weight + overtimePay;
    attendanceDates.add(row.markedOn.toISOString().slice(0, 10));
  }
  labourDaysUsed = round(labourDaysUsed, 2);
  labourCostToDate = round(labourCostToDate, 2);

  const workingDays = Math.max(1, attendanceDates.size);
  const avgDailyLabour = round(labourDaysUsed / workingDays, 2);
  const productivity = progressPct > 0 && labourDaysUsed > 0 ? progressPct / labourDaysUsed : 0;
  const requiredLabourDays = productivity > 0 ? remaining / productivity : 0;
  const daysToTarget = Math.max(1, daysRemainingPlanned > 0 ? daysRemainingPlanned : (estimatedDaysRemaining ?? 1));
  const requiredLabourPerDay = Math.ceil(requiredLabourDays / daysToTarget);
  const projectedLabourDays = round(labourDaysUsed + requiredLabourDays, 2);
  const costPerLabourDay = labourDaysUsed > 0 ? labourCostToDate / labourDaysUsed : 0;
  const projectedLabourCost = round(projectedLabourDays * costPerLabourDay, 2);

  if (productivity > 0) {
    notes.push(
      `${labourDaysUsed} labour-days delivered ${progressPct}% of the work — about ${round(requiredLabourPerDay, 0)} workers per day are needed to finish on time.`,
    );
  } else if (labourDaysUsed === 0) {
    notes.push('No attendance recorded against this project yet, so labour projections are unavailable.');
  }

  // ---- material --------------------------------------------------------
  const usages = await prisma.materialUsage.findMany({
    where: { projectId },
    include: { material: { select: { name: true, unit: true, rate: true } } },
  });

  const byMaterial = new Map<string, { name: string; unit: string; quantity: number; value: number }>();
  let consumedValue = 0;
  const usageDates = new Set<string>();
  for (const usage of usages) {
    const value = usage.quantity * (usage.material?.rate ?? 0);
    consumedValue += value;
    usageDates.add(usage.usedOn.toISOString().slice(0, 10));
    const key = usage.material?.name ?? `Material ${usage.materialId}`;
    const entry = byMaterial.get(key) ?? { name: key, unit: usage.material?.unit ?? '', quantity: 0, value: 0 };
    entry.quantity += usage.quantity;
    entry.value += value;
    byMaterial.set(key, entry);
  }
  consumedValue = round(consumedValue, 2);

  const scale = progressPct > 0 ? 100 / progressPct : 0;
  const topMaterials = Array.from(byMaterial.values())
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)
    .map((entry) => ({
      name: entry.name,
      unit: entry.unit,
      quantity: round(entry.quantity, 2),
      projected: round(entry.quantity * (scale || 1), 2),
    }));

  const avgDailyMaterialValue = round(consumedValue / Math.max(1, usageDates.size), 2);
  const projectedMaterialValue = round(consumedValue * (scale || 1), 2);

  // ---- cost ------------------------------------------------------------
  const spentToDate = round(labourCostToDate + consumedValue, 2);
  const projectedTotal = round(projectedLabourCost + projectedMaterialValue, 2);
  const variance = round(project.budget - projectedTotal, 2);
  if (project.budget > 0 && variance < 0) {
    notes.push(`Projected spend is ${round(Math.abs(variance), 0)} over the ${round(project.budget, 0)} budget.`);
  }

  // ---- per-stage -------------------------------------------------------
  const stageForecasts: StageForecast[] = stages.map((stage) => {
    const rate = stageRate(stage, project.startDate, now);
    const stageRemaining = Math.max(0, 100 - stage.progress);
    const daysRemaining = stageRemaining === 0 ? 0 : rate > MIN_RATE ? Math.ceil(stageRemaining / rate) : null;
    return {
      stageId: stage.id,
      name: stage.name,
      weight: stage.weight,
      progress: round(stage.progress, 2),
      avgDailyProgress: round(rate, 4),
      daysRemaining,
      estimatedCompletion: daysRemaining === null ? null : addDays(now, daysRemaining).toISOString().slice(0, 10),
    };
  });

  return {
    projectId: project.id,
    projectName: project.name,
    projectCode: project.code,
    status: project.status,
    startDate: project.startDate.toISOString(),
    expectedEndDate: project.expectedEndDate.toISOString(),
    progressPct,
    avgDailyProgress,
    daysElapsed,
    daysRemainingPlanned,
    estimatedCompletion: estimatedCompletion ? estimatedCompletion.toISOString() : null,
    estimatedDaysRemaining,
    delayDays,
    riskLevel,
    labour: {
      labourDaysUsed,
      avgDailyLabour,
      requiredLabourPerDay,
      projectedLabourDays,
      labourCostToDate,
      projectedLabourCost,
    },
    material: {
      consumedValue,
      avgDailyValue: avgDailyMaterialValue,
      projectedValue: projectedMaterialValue,
      topMaterials,
    },
    cost: {
      budget: round(project.budget, 2),
      spentToDate,
      projectedTotal,
      variance,
    },
    stages: stageForecasts,
    history,
    notes,
  };
}

export async function buildAllForecasts(): Promise<ProjectForecast[]> {
  const projects = await prisma.project.findMany({
    where: { status: { in: ['ACTIVE', 'PLANNED', 'ON_HOLD'] } },
    select: { id: true },
    orderBy: { name: 'asc' },
  });

  const forecasts: ProjectForecast[] = [];
  for (const project of projects) {
    const forecast = await buildForecast(project.id);
    if (forecast) forecasts.push(forecast);
  }
  return forecasts;
}

/** Stores the current forecast so trends can be charted later. */
export async function saveForecastSnapshot(forecast: ProjectForecast): Promise<void> {
  await prisma.forecastSnapshot.create({
    data: {
      projectId: forecast.projectId,
      progressPct: forecast.progressPct,
      avgDailyProgress: forecast.avgDailyProgress,
      estimatedCompletion: forecast.estimatedCompletion ? new Date(forecast.estimatedCompletion) : null,
      delayDays: forecast.delayDays,
      riskLevel: forecast.riskLevel,
      requiredLabour: forecast.labour.requiredLabourPerDay,
      costProjection: forecast.cost.projectedTotal,
      payload: JSON.stringify({
        labour: forecast.labour,
        material: forecast.material,
        cost: forecast.cost,
        notes: forecast.notes,
      }),
    },
  });
}
