import { prisma } from '../lib/prisma';
import { addDays, endOfDay, round, startOfDay } from '../lib/query';
import { ATTENDANCE_WEIGHT, LEAD_STATUSES, humanize, type AttendanceStatus } from '../../shared/constants';
import type { DashboardCharts, DashboardSummary } from '../../shared/types';
import { getStockRows } from './stock.service';
import { buildAllForecasts } from './forecast.service';

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
}

export async function getDashboardSummary(today = new Date()): Promise<DashboardSummary> {
  const dayStart = startOfDay(today);
  const dayEnd = endOfDay(today);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastMonthEnd = endOfDay(new Date(today.getFullYear(), today.getMonth(), 0));

  const [
    totalLeads,
    wonLeads,
    lostLeads,
    activeClients,
    propertiesAvailable,
    propertiesReserved,
    propertiesSold,
    attendanceToday,
    usageToday,
    activeProjects,
    monthRevenue,
    lastMonthRevenue,
    overdueFollowUps,
    todayFollowUps,
    projects,
  ] = await Promise.all([
    prisma.lead.count(),
    prisma.lead.count({ where: { status: 'WON' } }),
    prisma.lead.count({ where: { status: 'LOST' } }),
    prisma.client.count(),
    prisma.property.count({ where: { status: 'AVAILABLE' } }),
    prisma.property.count({ where: { status: 'RESERVED' } }),
    prisma.property.count({ where: { status: 'SOLD' } }),
    prisma.attendance.findMany({ where: { markedOn: { gte: dayStart, lte: dayEnd } }, select: { status: true } }),
    prisma.materialUsage.findMany({
      where: { usedOn: { gte: dayStart, lte: dayEnd } },
      include: { material: { select: { rate: true } } },
    }),
    prisma.project.count({ where: { status: 'ACTIVE' } }),
    prisma.payment.aggregate({ _sum: { amount: true }, where: { paidOn: { gte: monthStart, lte: dayEnd } } }),
    prisma.payment.aggregate({ _sum: { amount: true }, where: { paidOn: { gte: lastMonthStart, lte: lastMonthEnd } } }),
    prisma.lead.count({
      where: { followUpDate: { lt: dayStart }, status: { notIn: ['WON', 'LOST'] } },
    }),
    prisma.lead.count({
      where: { followUpDate: { gte: dayStart, lte: dayEnd }, status: { notIn: ['WON', 'LOST'] } },
    }),
    prisma.project.findMany({
      where: { status: { in: ['ACTIVE', 'PLANNED'] } },
      include: { stages: { select: { weight: true, progress: true } } },
    }),
  ]);

  const attendanceCounts = { present: 0, halfDay: 0, absent: 0, labourDays: 0 };
  for (const row of attendanceToday) {
    if (row.status === 'PRESENT') attendanceCounts.present += 1;
    else if (row.status === 'HALF_DAY') attendanceCounts.halfDay += 1;
    else attendanceCounts.absent += 1;
    attendanceCounts.labourDays += ATTENDANCE_WEIGHT[row.status as AttendanceStatus] ?? 0;
  }
  attendanceCounts.labourDays = round(attendanceCounts.labourDays, 2);

  const materialUsedToday = {
    entries: usageToday.length,
    value: round(
      usageToday.reduce((acc, row) => acc + row.quantity * (row.material?.rate ?? 0), 0),
      2,
    ),
  };

  let weightSum = 0;
  let weightedProgress = 0;
  for (const project of projects) {
    for (const stage of project.stages) {
      const weight = stage.weight > 0 ? stage.weight : 1;
      weightSum += weight;
      weightedProgress += weight * stage.progress;
    }
  }

  const stock = await getStockRows();

  return {
    totalLeads,
    openLeads: totalLeads - wonLeads - lostLeads,
    wonLeads,
    activeClients,
    propertiesAvailable,
    propertiesReserved,
    propertiesSold,
    attendanceToday: attendanceCounts,
    materialUsedToday,
    activeProjects,
    monthlyRevenue: round(monthRevenue._sum.amount ?? 0, 2),
    revenueLastMonth: round(lastMonthRevenue._sum.amount ?? 0, 2),
    overallProgress: weightSum > 0 ? round(weightedProgress / weightSum, 1) : 0,
    lowStockCount: stock.filter((row) => row.low).length,
    overdueFollowUps,
    todayFollowUps,
  };
}

export async function getDashboardCharts(today = new Date()): Promise<DashboardCharts> {
  const dayEnd = endOfDay(today);

  // Lead funnel — one bar per status, in pipeline order.
  const leadGroups = await prisma.lead.groupBy({ by: ['status'], _count: { _all: true } });
  const leadMap = new Map(leadGroups.map((row) => [row.status, row._count._all]));
  const leadFunnel = LEAD_STATUSES.map((status) => ({
    name: humanize(status),
    value: leadMap.get(status) ?? 0,
  }));

  // Sales trend — bookings and collections for the last 12 months.
  const trendStart = startOfDay(new Date(today.getFullYear(), today.getMonth() - 11, 1));
  const [bookings, payments] = await Promise.all([
    prisma.booking.findMany({
      where: { bookingDate: { gte: trendStart, lte: dayEnd } },
      select: { bookingDate: true },
    }),
    prisma.payment.findMany({
      where: { paidOn: { gte: trendStart, lte: dayEnd } },
      select: { paidOn: true, amount: true },
    }),
  ]);

  const months: { key: string; label: string }[] = [];
  for (let index = 11; index >= 0; index -= 1) {
    const date = new Date(today.getFullYear(), today.getMonth() - index, 1);
    months.push({ key: monthKey(date), label: monthLabel(date) });
  }
  const bookingByMonth = new Map<string, number>();
  for (const booking of bookings) {
    const key = monthKey(booking.bookingDate);
    bookingByMonth.set(key, (bookingByMonth.get(key) ?? 0) + 1);
  }
  const revenueByMonth = new Map<string, number>();
  for (const payment of payments) {
    const key = monthKey(payment.paidOn);
    revenueByMonth.set(key, (revenueByMonth.get(key) ?? 0) + payment.amount);
  }
  const salesTrend = months.map((month) => ({
    month: month.label,
    bookings: bookingByMonth.get(month.key) ?? 0,
    revenue: round(revenueByMonth.get(month.key) ?? 0, 2),
  }));

  // Attendance trend — last 14 days.
  const attendanceStart = startOfDay(addDays(today, -13));
  const attendanceRows = await prisma.attendance.findMany({
    where: { markedOn: { gte: attendanceStart, lte: dayEnd } },
    select: { markedOn: true, status: true },
  });
  const attendanceByDate = new Map<string, { present: number; halfDay: number; absent: number }>();
  for (let index = 13; index >= 0; index -= 1) {
    const key = startOfDay(addDays(today, -index)).toISOString().slice(0, 10);
    attendanceByDate.set(key, { present: 0, halfDay: 0, absent: 0 });
  }
  for (const row of attendanceRows) {
    const key = startOfDay(row.markedOn).toISOString().slice(0, 10);
    const bucket = attendanceByDate.get(key);
    if (!bucket) continue;
    if (row.status === 'PRESENT') bucket.present += 1;
    else if (row.status === 'HALF_DAY') bucket.halfDay += 1;
    else bucket.absent += 1;
  }
  const attendanceTrend = Array.from(attendanceByDate.entries()).map(([date, value]) => ({
    date: date.slice(5),
    ...value,
  }));

  // Material consumption — last 30 days, top 8 materials by value.
  const usageStart = startOfDay(addDays(today, -29));
  const usageRows = await prisma.materialUsage.findMany({
    where: { usedOn: { gte: usageStart, lte: dayEnd } },
    include: { material: { select: { name: true, rate: true } } },
  });
  const usageByMaterial = new Map<string, { name: string; quantity: number; value: number }>();
  for (const row of usageRows) {
    const name = row.material?.name ?? `Material ${row.materialId}`;
    const entry = usageByMaterial.get(name) ?? { name, quantity: 0, value: 0 };
    entry.quantity += row.quantity;
    entry.value += row.quantity * (row.material?.rate ?? 0);
    usageByMaterial.set(name, entry);
  }
  const materialConsumption = Array.from(usageByMaterial.values())
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)
    .map((entry) => ({ name: entry.name, quantity: round(entry.quantity, 2), value: round(entry.value, 2) }));

  // Inventory — lowest cover first, so shortages surface immediately.
  const stock = await getStockRows();
  const inventoryStatus = stock
    .slice()
    .sort((a, b) => a.inStock - a.reorderLevel - (b.inStock - b.reorderLevel))
    .slice(0, 8)
    .map((row) => ({ name: row.name, stock: row.inStock, reorderLevel: row.reorderLevel }));

  // Project completion and risk, straight from the forecasting engine.
  const forecasts = await buildAllForecasts();
  const projectCompletion = forecasts.map((forecast) => ({
    name: forecast.projectName,
    progress: forecast.progressPct,
    risk: forecast.riskLevel,
  }));

  // Weekly DPR — reports filed and labour reported for the last 7 days.
  const dprStart = startOfDay(addDays(today, -6));
  const dprRows = await prisma.dpr.findMany({
    where: { reportDate: { gte: dprStart, lte: dayEnd } },
    select: { reportDate: true, labourCount: true },
  });
  const dprByDate = new Map<string, { labour: number; reports: number }>();
  for (let index = 6; index >= 0; index -= 1) {
    const key = startOfDay(addDays(today, -index)).toISOString().slice(0, 10);
    dprByDate.set(key, { labour: 0, reports: 0 });
  }
  for (const row of dprRows) {
    const key = startOfDay(row.reportDate).toISOString().slice(0, 10);
    const bucket = dprByDate.get(key);
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
