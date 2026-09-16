import { db } from '../db';
import { addDays, dayKey, endOfDay, round, startOfDay } from '../query';
import { ATTENDANCE_WEIGHT, LEAD_STATUSES, humanize, type AttendanceStatus } from '@shared/constants';
import type { DashboardCharts, DashboardSummary } from '@shared/types';
import { stockRows } from './stock';
import { buildAllForecasts } from './forecast';

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
}

export function dashboardSummary(today = new Date()): DashboardSummary {
  const data = db();
  const dayStart = startOfDay(today);
  const dayEnd = endOfDay(today);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastMonthEnd = endOfDay(new Date(today.getFullYear(), today.getMonth(), 0));

  const attendanceToday = data.attendances.filter((row) => row.markedOn >= dayStart && row.markedOn <= dayEnd);
  const attendanceCounts = { present: 0, halfDay: 0, absent: 0, labourDays: 0 };
  for (const row of attendanceToday) {
    if (row.status === 'PRESENT') attendanceCounts.present += 1;
    else if (row.status === 'HALF_DAY') attendanceCounts.halfDay += 1;
    else attendanceCounts.absent += 1;
    attendanceCounts.labourDays += ATTENDANCE_WEIGHT[row.status as AttendanceStatus] ?? 0;
  }
  attendanceCounts.labourDays = round(attendanceCounts.labourDays, 2);

  const usageToday = data.materialUsages.filter((row) => row.usedOn >= dayStart && row.usedOn <= dayEnd);
  const materialUsedToday = {
    entries: usageToday.length,
    value: round(
      usageToday.reduce((acc, row) => {
        const rate = data.materials.find((material) => material.id === row.materialId)?.rate ?? 0;
        return acc + row.quantity * rate;
      }, 0),
      2,
    ),
  };

  const activeProjects = data.projects.filter((project) => ['ACTIVE', 'PLANNED'].includes(project.status));
  let weightSum = 0;
  let weightedProgress = 0;
  for (const project of activeProjects) {
    for (const stage of data.projectStages.filter((row) => row.projectId === project.id)) {
      const weight = stage.weight > 0 ? stage.weight : 1;
      weightSum += weight;
      weightedProgress += weight * stage.progress;
    }
  }

  const openLead = (status: string): boolean => !['WON', 'LOST'].includes(status);
  const stock = stockRows();

  return {
    totalLeads: data.leads.length,
    openLeads: data.leads.filter((lead) => openLead(lead.status)).length,
    wonLeads: data.leads.filter((lead) => lead.status === 'WON').length,
    activeClients: data.clients.length,
    propertiesAvailable: data.properties.filter((row) => row.status === 'AVAILABLE').length,
    propertiesReserved: data.properties.filter((row) => row.status === 'RESERVED').length,
    propertiesSold: data.properties.filter((row) => row.status === 'SOLD').length,
    attendanceToday: attendanceCounts,
    materialUsedToday,
    activeProjects: data.projects.filter((project) => project.status === 'ACTIVE').length,
    monthlyRevenue: round(
      data.payments.filter((row) => row.paidOn >= monthStart && row.paidOn <= dayEnd).reduce((acc, row) => acc + row.amount, 0),
      2,
    ),
    revenueLastMonth: round(
      data.payments
        .filter((row) => row.paidOn >= lastMonthStart && row.paidOn <= lastMonthEnd)
        .reduce((acc, row) => acc + row.amount, 0),
      2,
    ),
    overallProgress: weightSum > 0 ? round(weightedProgress / weightSum, 1) : 0,
    lowStockCount: stock.filter((row) => row.low).length,
    overdueFollowUps: data.leads.filter(
      (lead) => openLead(lead.status) && lead.followUpDate != null && lead.followUpDate < dayStart,
    ).length,
    todayFollowUps: data.leads.filter(
      (lead) =>
        openLead(lead.status) && lead.followUpDate != null && lead.followUpDate >= dayStart && lead.followUpDate <= dayEnd,
    ).length,
  };
}

export function dashboardCharts(today = new Date()): DashboardCharts {
  const data = db();
  const dayEnd = endOfDay(today);

  const leadFunnel = LEAD_STATUSES.map((status) => ({
    name: humanize(status),
    value: data.leads.filter((lead) => lead.status === status).length,
  }));

  const months: { key: string; label: string }[] = [];
  for (let index = 11; index >= 0; index -= 1) {
    const date = new Date(today.getFullYear(), today.getMonth() - index, 1);
    months.push({ key: monthKey(date), label: monthLabel(date) });
  }
  const trendStart = startOfDay(new Date(today.getFullYear(), today.getMonth() - 11, 1));

  const bookingByMonth = new Map<string, number>();
  for (const booking of data.bookings.filter((row) => row.bookingDate >= trendStart && row.bookingDate <= dayEnd)) {
    const key = monthKey(booking.bookingDate);
    bookingByMonth.set(key, (bookingByMonth.get(key) ?? 0) + 1);
  }
  const revenueByMonth = new Map<string, number>();
  for (const payment of data.payments.filter((row) => row.paidOn >= trendStart && row.paidOn <= dayEnd)) {
    const key = monthKey(payment.paidOn);
    revenueByMonth.set(key, (revenueByMonth.get(key) ?? 0) + payment.amount);
  }
  const salesTrend = months.map((month) => ({
    month: month.label,
    bookings: bookingByMonth.get(month.key) ?? 0,
    revenue: round(revenueByMonth.get(month.key) ?? 0, 2),
  }));

  const attendanceByDate = new Map<string, { present: number; halfDay: number; absent: number }>();
  for (let index = 13; index >= 0; index -= 1) {
    attendanceByDate.set(dayKey(addDays(today, -index)), { present: 0, halfDay: 0, absent: 0 });
  }
  for (const row of data.attendances) {
    const bucket = attendanceByDate.get(dayKey(row.markedOn));
    if (!bucket) continue;
    if (row.status === 'PRESENT') bucket.present += 1;
    else if (row.status === 'HALF_DAY') bucket.halfDay += 1;
    else bucket.absent += 1;
  }
  const attendanceTrend = Array.from(attendanceByDate.entries()).map(([date, value]) => ({
    date: date.slice(5),
    ...value,
  }));

  const usageStart = startOfDay(addDays(today, -29));
  const usageByMaterial = new Map<string, { name: string; quantity: number; value: number }>();
  for (const row of data.materialUsages.filter((usage) => usage.usedOn >= usageStart && usage.usedOn <= dayEnd)) {
    const material = data.materials.find((item) => item.id === row.materialId);
    const name = material?.name ?? `Material ${row.materialId}`;
    const entry = usageByMaterial.get(name) ?? { name, quantity: 0, value: 0 };
    entry.quantity += row.quantity;
    entry.value += row.quantity * (material?.rate ?? 0);
    usageByMaterial.set(name, entry);
  }
  const materialConsumption = Array.from(usageByMaterial.values())
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)
    .map((entry) => ({ name: entry.name, quantity: round(entry.quantity, 2), value: round(entry.value, 2) }));

  const inventoryStatus = stockRows()
    .slice()
    .sort((a, b) => a.inStock - a.reorderLevel - (b.inStock - b.reorderLevel))
    .slice(0, 8)
    .map((row) => ({ name: row.name, stock: row.inStock, reorderLevel: row.reorderLevel }));

  const projectCompletion = buildAllForecasts().map((forecast) => ({
    name: forecast.projectName,
    progress: forecast.progressPct,
    risk: forecast.riskLevel,
  }));

  const dprByDate = new Map<string, { labour: number; reports: number }>();
  for (let index = 6; index >= 0; index -= 1) {
    dprByDate.set(dayKey(addDays(today, -index)), { labour: 0, reports: 0 });
  }
  for (const row of data.dprs) {
    const bucket = dprByDate.get(dayKey(row.reportDate));
    if (!bucket) continue;
    bucket.labour += row.labourCount;
    bucket.reports += 1;
  }
  const weeklyDpr = Array.from(dprByDate.entries()).map(([date, value]) => ({ date: date.slice(5), ...value }));

  return {
    leadFunnel,
    salesTrend,
    attendanceTrend,
    materialConsumption,
    inventoryStatus,
    projectCompletion,
    weeklyDpr,
  };
}

export function dashboardAlerts(today = new Date()): {
  followUps: unknown[];
  lowStock: unknown[];
  milestones: unknown[];
  missingDpr: unknown[];
} {
  const data = db();
  const dayStart = startOfDay(today);
  const dayEnd = endOfDay(today);

  return {
    followUps: data.leads
      .filter((lead) => !['WON', 'LOST'].includes(lead.status) && lead.followUpDate != null && lead.followUpDate <= dayEnd)
      .sort((a, b) => (a.followUpDate?.getTime() ?? 0) - (b.followUpDate?.getTime() ?? 0))
      .slice(0, 20),
    lowStock: stockRows().filter((row) => row.low).slice(0, 20),
    milestones: data.milestones
      .filter((milestone) => milestone.status !== 'DONE' && milestone.dueDate <= dayEnd)
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
      .slice(0, 20)
      .map((milestone) => ({
        ...milestone,
        project: data.projects.find((project) => project.id === milestone.projectId) ?? null,
      })),
    missingDpr: data.projects
      .filter(
        (project) =>
          project.status === 'ACTIVE' &&
          !data.dprs.some(
            (dpr) => dpr.projectId === project.id && dpr.reportDate >= dayStart && dpr.reportDate <= dayEnd,
          ),
      )
      .slice(0, 20)
      .map((project) => ({ id: project.id, name: project.name })),
  };
}
