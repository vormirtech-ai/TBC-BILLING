import { prisma } from '../lib/prisma';
import { endOfDay, round, startOfDay } from '../lib/query';
import { ATTENDANCE_WEIGHT, humanize, type AttendanceStatus } from '../../shared/constants';
import type { ListQuery } from '../../shared/schemas';
import type { ReportDefinition } from '../../shared/types';
import { getStockRows } from './stock.service';
import { buildForecast } from './forecast.service';

export type ColumnType = 'text' | 'number' | 'money' | 'date' | 'percent';

export interface ReportColumn {
  key: string;
  header: string;
  type?: ColumnType;
  width?: number;
}

export interface ReportResult {
  key: string;
  title: string;
  subtitle: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  /** Column key → total, rendered as a bold last row in Excel. */
  totals: Record<string, number>;
}

/** Everything the Reports screen offers, and which filters each one honours. */
export const REPORTS: ReportDefinition[] = [
  { key: 'leads', label: 'Lead Report', description: 'Every enquiry with source, budget, status and next follow-up.', filters: ['date', 'status', 'search'] },
  { key: 'clients', label: 'Client Report', description: 'Clients with bookings, agreement value and amount collected.', filters: ['date', 'search'] },
  { key: 'properties', label: 'Property Report', description: 'Unit-wise inventory across towers with price and status.', filters: ['project', 'status', 'search'] },
  { key: 'projects', label: 'Project Report', description: 'Progress, budget and forecast completion for each site.', filters: ['status', 'search'] },
  { key: 'inventory', label: 'Inventory Report', description: 'Live stock, reorder level and stock value per material.', filters: ['search'] },
  { key: 'material', label: 'Material Consumption', description: 'Material issued to sites over the selected period.', filters: ['date', 'project', 'search'] },
  { key: 'labour', label: 'Labour Report', description: 'Labour-days, overtime and productivity by worker.', filters: ['date', 'project', 'search'] },
  { key: 'wages', label: 'Wage Report', description: 'Payable wages for the period including overtime.', filters: ['date', 'project', 'search'] },
  { key: 'dpr', label: 'DPR Report', description: 'Daily progress reports with labour, weather and site issues.', filters: ['date', 'project', 'search'] },
];

const MAX_ROWS = 5000;

function periodLabel(query: ListQuery): string {
  if (query.from && query.to) {
    return `${startOfDay(query.from).toLocaleDateString('en-IN')} to ${startOfDay(query.to).toLocaleDateString('en-IN')}`;
  }
  if (query.from) return `From ${startOfDay(query.from).toLocaleDateString('en-IN')}`;
  if (query.to) return `Up to ${startOfDay(query.to).toLocaleDateString('en-IN')}`;
  return 'All time';
}

function dateRange(query: ListQuery): { gte?: Date; lte?: Date } | undefined {
  if (!query.from && !query.to) return undefined;
  return {
    ...(query.from ? { gte: startOfDay(query.from) } : {}),
    ...(query.to ? { lte: endOfDay(query.to) } : {}),
  };
}

function sortRows(rows: Record<string, unknown>[], query: ListQuery, fallback: string): Record<string, unknown>[] {
  const key = query.sortBy && rows.length > 0 && key0(rows[0], query.sortBy) ? query.sortBy : fallback;
  const direction = query.sortDir === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const left = a[key];
    const right = b[key];
    if (left == null && right == null) return 0;
    if (left == null) return 1;
    if (right == null) return -1;
    if (typeof left === 'number' && typeof right === 'number') return (left - right) * direction;
    return String(left).localeCompare(String(right)) * direction;
  });
}

function key0(row: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(row, key);
}

function sum(rows: Record<string, unknown>[], keys: string[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const key of keys) {
    totals[key] = round(
      rows.reduce((acc, row) => acc + (typeof row[key] === 'number' ? (row[key] as number) : 0), 0),
      2,
    );
  }
  return totals;
}

export async function buildReport(key: string, query: ListQuery): Promise<ReportResult> {
  const definition = REPORTS.find((report) => report.key === key);
  if (!definition) {
    throw new Error(`Unknown report: ${key}`);
  }
  const subtitle = periodLabel(query);
  const search = query.q?.trim();

  switch (key) {
    case 'leads': {
      const leads = await prisma.lead.findMany({
        where: {
          ...(dateRange(query) ? { createdAt: dateRange(query) } : {}),
          ...(query.status ? { status: query.status } : {}),
          ...(query.source ? { source: query.source } : {}),
          ...(search ? { OR: [{ name: { contains: search } }, { phone: { contains: search } }, { email: { contains: search } }] } : {}),
        },
        include: { interestedProperty: { select: { tower: true, unit: true } }, project: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: MAX_ROWS,
      });
      const rows = leads.map((lead) => ({
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        email: lead.email ?? '',
        source: humanize(lead.source),
        budget: round(lead.budget, 2),
        project: lead.project?.name ?? '',
        interested: lead.interestedProperty ? `${lead.interestedProperty.tower}-${lead.interestedProperty.unit}` : '',
        status: humanize(lead.status),
        followUpDate: lead.followUpDate,
        assignedTo: lead.assignedTo ?? '',
        createdAt: lead.createdAt,
      }));
      return {
        key,
        title: definition.label,
        subtitle,
        columns: [
          { key: 'id', header: '#', type: 'number', width: 8 },
          { key: 'name', header: 'Name', width: 24 },
          { key: 'phone', header: 'Phone', width: 16 },
          { key: 'email', header: 'Email', width: 26 },
          { key: 'source', header: 'Source', width: 14 },
          { key: 'budget', header: 'Budget', type: 'money', width: 16 },
          { key: 'project', header: 'Project', width: 20 },
          { key: 'interested', header: 'Interested Unit', width: 16 },
          { key: 'status', header: 'Status', width: 14 },
          { key: 'followUpDate', header: 'Follow-up', type: 'date', width: 14 },
          { key: 'assignedTo', header: 'Owner', width: 16 },
          { key: 'createdAt', header: 'Created', type: 'date', width: 14 },
        ],
        rows: sortRows(rows, query, 'createdAt'),
        totals: sum(rows, ['budget']),
      };
    }

    case 'clients': {
      const clients = await prisma.client.findMany({
        where: {
          ...(dateRange(query) ? { createdAt: dateRange(query) } : {}),
          ...(search ? { OR: [{ name: { contains: search } }, { phone: { contains: search } }] } : {}),
        },
        include: {
          bookings: { select: { agreementValue: true, status: true } },
          payments: { select: { amount: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: MAX_ROWS,
      });
      const rows = clients.map((client) => {
        const agreement = client.bookings.reduce((acc, booking) => acc + booking.agreementValue, 0);
        const paid = client.payments.reduce((acc, payment) => acc + payment.amount, 0);
        return {
          id: client.id,
          name: client.name,
          phone: client.phone,
          email: client.email ?? '',
          bookings: client.bookings.filter((booking) => booking.status !== 'CANCELLED').length,
          agreementValue: round(agreement, 2),
          collected: round(paid, 2),
          outstanding: round(agreement - paid, 2),
          createdAt: client.createdAt,
        };
      });
      return {
        key,
        title: definition.label,
        subtitle,
        columns: [
          { key: 'id', header: '#', type: 'number', width: 8 },
          { key: 'name', header: 'Client', width: 26 },
          { key: 'phone', header: 'Phone', width: 16 },
          { key: 'email', header: 'Email', width: 26 },
          { key: 'bookings', header: 'Bookings', type: 'number', width: 12 },
          { key: 'agreementValue', header: 'Agreement Value', type: 'money', width: 18 },
          { key: 'collected', header: 'Collected', type: 'money', width: 16 },
          { key: 'outstanding', header: 'Outstanding', type: 'money', width: 16 },
          { key: 'createdAt', header: 'Since', type: 'date', width: 14 },
        ],
        rows: sortRows(rows, query, 'agreementValue'),
        totals: sum(rows, ['agreementValue', 'collected', 'outstanding']),
      };
    }

    case 'properties': {
      const properties = await prisma.property.findMany({
        where: {
          ...(query.projectId ? { projectId: query.projectId } : {}),
          ...(query.status ? { status: query.status } : {}),
          ...(search ? { OR: [{ tower: { contains: search } }, { unit: { contains: search } }] } : {}),
        },
        include: { project: { select: { name: true } }, bookings: { select: { client: { select: { name: true } }, status: true } } },
        orderBy: [{ projectId: 'asc' }, { tower: 'asc' }, { floor: 'asc' }],
        take: MAX_ROWS,
      });
      const rows = properties.map((property) => ({
        id: property.id,
        project: property.project?.name ?? '',
        tower: property.tower,
        floor: property.floor,
        unit: property.unit,
        unitType: property.unitType,
        sizeSqft: property.sizeSqft,
        price: round(property.price, 2),
        ratePerSqft: property.sizeSqft > 0 ? round(property.price / property.sizeSqft, 2) : 0,
        facing: humanize(property.facing),
        status: humanize(property.status),
        client: property.bookings.find((booking) => booking.status === 'ACTIVE')?.client?.name ?? '',
      }));
      return {
        key,
        title: definition.label,
        subtitle,
        columns: [
          { key: 'project', header: 'Project', width: 22 },
          { key: 'tower', header: 'Tower', width: 10 },
          { key: 'floor', header: 'Floor', type: 'number', width: 8 },
          { key: 'unit', header: 'Unit', width: 10 },
          { key: 'unitType', header: 'Type', width: 12 },
          { key: 'sizeSqft', header: 'Size (sqft)', type: 'number', width: 14 },
          { key: 'price', header: 'Price', type: 'money', width: 16 },
          { key: 'ratePerSqft', header: 'Rate/sqft', type: 'money', width: 14 },
          { key: 'facing', header: 'Facing', width: 12 },
          { key: 'status', header: 'Status', width: 12 },
          { key: 'client', header: 'Booked By', width: 22 },
        ],
        rows: sortRows(rows, query, 'tower'),
        totals: sum(rows, ['sizeSqft', 'price']),
      };
    }

    case 'projects': {
      const projects = await prisma.project.findMany({
        where: {
          ...(query.status ? { status: query.status } : {}),
          ...(search ? { OR: [{ name: { contains: search } }, { code: { contains: search } }, { location: { contains: search } }] } : {}),
        },
        orderBy: { name: 'asc' },
        take: 500,
      });
      const rows: Record<string, unknown>[] = [];
      for (const project of projects) {
        const forecast = await buildForecast(project.id);
        rows.push({
          code: project.code,
          name: project.name,
          location: project.location,
          status: humanize(project.status),
          startDate: project.startDate,
          expectedEndDate: project.expectedEndDate,
          budget: round(project.budget, 2),
          progress: forecast?.progressPct ?? 0,
          estimatedCompletion: forecast?.estimatedCompletion ? new Date(forecast.estimatedCompletion) : null,
          delayDays: forecast?.delayDays ?? 0,
          risk: forecast?.riskLevel ?? 'GREEN',
          projectedCost: forecast?.cost.projectedTotal ?? 0,
        });
      }
      return {
        key,
        title: definition.label,
        subtitle,
        columns: [
          { key: 'code', header: 'Code', width: 12 },
          { key: 'name', header: 'Project', width: 24 },
          { key: 'location', header: 'Location', width: 20 },
          { key: 'status', header: 'Status', width: 12 },
          { key: 'startDate', header: 'Start', type: 'date', width: 14 },
          { key: 'expectedEndDate', header: 'Planned End', type: 'date', width: 14 },
          { key: 'progress', header: 'Progress', type: 'percent', width: 12 },
          { key: 'estimatedCompletion', header: 'Forecast End', type: 'date', width: 14 },
          { key: 'delayDays', header: 'Delay (days)', type: 'number', width: 14 },
          { key: 'risk', header: 'Risk', width: 10 },
          { key: 'budget', header: 'Budget', type: 'money', width: 16 },
          { key: 'projectedCost', header: 'Projected Cost', type: 'money', width: 18 },
        ],
        rows: sortRows(rows, query, 'name'),
        totals: sum(rows, ['budget', 'projectedCost']),
      };
    }

    case 'inventory': {
      const stock = await getStockRows({ q: search, category: query.category });
      const rows = stock.map((row) => ({
        name: row.name,
        category: humanize(row.category),
        unit: row.unit,
        openingStock: row.openingStock,
        purchased: row.purchased,
        used: row.used,
        adjusted: row.adjusted,
        inStock: row.inStock,
        reorderLevel: row.reorderLevel,
        rate: row.rate,
        stockValue: row.stockValue,
        alert: row.low ? 'LOW STOCK' : 'OK',
      }));
      return {
        key,
        title: definition.label,
        subtitle: 'Live stock position',
        columns: [
          { key: 'name', header: 'Material', width: 24 },
          { key: 'category', header: 'Category', width: 14 },
          { key: 'unit', header: 'Unit', width: 10 },
          { key: 'openingStock', header: 'Opening', type: 'number', width: 12 },
          { key: 'purchased', header: 'Purchased', type: 'number', width: 12 },
          { key: 'used', header: 'Issued', type: 'number', width: 12 },
          { key: 'adjusted', header: 'Adjusted', type: 'number', width: 12 },
          { key: 'inStock', header: 'In Stock', type: 'number', width: 12 },
          { key: 'reorderLevel', header: 'Reorder At', type: 'number', width: 12 },
          { key: 'rate', header: 'Rate', type: 'money', width: 12 },
          { key: 'stockValue', header: 'Stock Value', type: 'money', width: 16 },
          { key: 'alert', header: 'Alert', width: 12 },
        ],
        rows: sortRows(rows, query, 'name'),
        totals: sum(rows, ['purchased', 'used', 'stockValue']),
      };
    }

    case 'material': {
      const usages = await prisma.materialUsage.findMany({
        where: {
          ...(dateRange(query) ? { usedOn: dateRange(query) } : {}),
          ...(query.projectId ? { projectId: query.projectId } : {}),
          ...(query.materialId ? { materialId: query.materialId } : {}),
          ...(search ? { material: { name: { contains: search } } } : {}),
        },
        include: { material: { select: { name: true, unit: true, rate: true } }, project: { select: { name: true } } },
        orderBy: { usedOn: 'desc' },
        take: MAX_ROWS,
      });
      const rows = usages.map((usage) => ({
        usedOn: usage.usedOn,
        material: usage.material?.name ?? '',
        unit: usage.material?.unit ?? '',
        project: usage.project?.name ?? '',
        quantity: round(usage.quantity, 3),
        rate: round(usage.material?.rate ?? 0, 2),
        value: round(usage.quantity * (usage.material?.rate ?? 0), 2),
        issuedTo: usage.issuedTo ?? '',
        notes: usage.notes ?? '',
      }));
      return {
        key,
        title: definition.label,
        subtitle,
        columns: [
          { key: 'usedOn', header: 'Date', type: 'date', width: 14 },
          { key: 'material', header: 'Material', width: 22 },
          { key: 'unit', header: 'Unit', width: 10 },
          { key: 'project', header: 'Project', width: 22 },
          { key: 'quantity', header: 'Quantity', type: 'number', width: 14 },
          { key: 'rate', header: 'Rate', type: 'money', width: 12 },
          { key: 'value', header: 'Value', type: 'money', width: 16 },
          { key: 'issuedTo', header: 'Issued To', width: 18 },
          { key: 'notes', header: 'Notes', width: 28 },
        ],
        rows: sortRows(rows, query, 'usedOn'),
        totals: sum(rows, ['quantity', 'value']),
      };
    }

    case 'labour':
    case 'wages': {
      const attendance = await prisma.attendance.findMany({
        where: {
          ...(dateRange(query) ? { markedOn: dateRange(query) } : {}),
          ...(query.projectId ? { projectId: query.projectId } : {}),
          ...(search ? { worker: { name: { contains: search } } } : {}),
        },
        include: { worker: { select: { id: true, name: true, skill: true, contractor: true, dailyWage: true } } },
        take: MAX_ROWS * 4,
      });

      const byWorker = new Map<
        number,
        {
          name: string;
          skill: string;
          contractor: string;
          dailyWage: number;
          present: number;
          halfDay: number;
          absent: number;
          overtime: number;
          labourDays: number;
        }
      >();

      for (const row of attendance) {
        if (!row.worker) continue;
        const entry =
          byWorker.get(row.worker.id) ??
          {
            name: row.worker.name,
            skill: humanize(row.worker.skill),
            contractor: row.worker.contractor ?? '',
            dailyWage: row.worker.dailyWage,
            present: 0,
            halfDay: 0,
            absent: 0,
            overtime: 0,
            labourDays: 0,
          };
        if (row.status === 'PRESENT') entry.present += 1;
        else if (row.status === 'HALF_DAY') entry.halfDay += 1;
        else entry.absent += 1;
        entry.overtime += row.overtimeHours;
        entry.labourDays += ATTENDANCE_WEIGHT[row.status as AttendanceStatus] ?? 0;
        byWorker.set(row.worker.id, entry);
      }

      const rows = Array.from(byWorker.values()).map((entry) => {
        const basePay = entry.labourDays * entry.dailyWage;
        const overtimePay = (entry.dailyWage / 8) * entry.overtime;
        return {
          name: entry.name,
          skill: entry.skill,
          contractor: entry.contractor,
          dailyWage: round(entry.dailyWage, 2),
          present: entry.present,
          halfDay: entry.halfDay,
          absent: entry.absent,
          labourDays: round(entry.labourDays, 2),
          overtimeHours: round(entry.overtime, 2),
          basePay: round(basePay, 2),
          overtimePay: round(overtimePay, 2),
          payable: round(basePay + overtimePay, 2),
        };
      });

      const labourColumns: ReportColumn[] = [
        { key: 'name', header: 'Worker', width: 24 },
        { key: 'skill', header: 'Skill', width: 14 },
        { key: 'contractor', header: 'Contractor', width: 20 },
        { key: 'present', header: 'Present', type: 'number', width: 10 },
        { key: 'halfDay', header: 'Half Day', type: 'number', width: 10 },
        { key: 'absent', header: 'Absent', type: 'number', width: 10 },
        { key: 'labourDays', header: 'Labour Days', type: 'number', width: 14 },
        { key: 'overtimeHours', header: 'OT Hours', type: 'number', width: 12 },
      ];

      const wageColumns: ReportColumn[] = [
        ...labourColumns,
        { key: 'dailyWage', header: 'Daily Wage', type: 'money', width: 14 },
        { key: 'basePay', header: 'Base Pay', type: 'money', width: 16 },
        { key: 'overtimePay', header: 'Overtime Pay', type: 'money', width: 16 },
        { key: 'payable', header: 'Total Payable', type: 'money', width: 18 },
      ];

      return {
        key,
        title: definition.label,
        subtitle,
        columns: key === 'wages' ? wageColumns : labourColumns,
        rows: sortRows(rows, query, 'labourDays'),
        totals:
          key === 'wages'
            ? sum(rows, ['labourDays', 'overtimeHours', 'basePay', 'overtimePay', 'payable'])
            : sum(rows, ['present', 'halfDay', 'absent', 'labourDays', 'overtimeHours']),
      };
    }

    case 'dpr': {
      const reports = await prisma.dpr.findMany({
        where: {
          ...(dateRange(query) ? { reportDate: dateRange(query) } : {}),
          ...(query.projectId ? { projectId: query.projectId } : {}),
          ...(search ? { OR: [{ workCompleted: { contains: search } }, { siteIssues: { contains: search } }] } : {}),
        },
        include: {
          project: { select: { name: true } },
          materials: { include: { material: { select: { name: true, unit: true } } } },
        },
        orderBy: { reportDate: 'desc' },
        take: MAX_ROWS,
      });
      const rows = reports.map((report) => ({
        reportDate: report.reportDate,
        project: report.project?.name ?? '',
        weather: humanize(report.weather),
        labourCount: report.labourCount,
        workCompleted: report.workCompleted,
        materials: report.materials
          .map((item) => `${item.material?.name ?? ''} ${round(item.quantity, 2)} ${item.material?.unit ?? ''}`.trim())
          .join('; '),
        machinery: report.machinery ?? '',
        siteIssues: report.siteIssues ?? '',
        safetyNotes: report.safetyNotes ?? '',
        preparedBy: report.preparedBy ?? '',
      }));
      return {
        key,
        title: definition.label,
        subtitle,
        columns: [
          { key: 'reportDate', header: 'Date', type: 'date', width: 14 },
          { key: 'project', header: 'Project', width: 22 },
          { key: 'weather', header: 'Weather', width: 12 },
          { key: 'labourCount', header: 'Labour', type: 'number', width: 10 },
          { key: 'workCompleted', header: 'Work Completed', width: 44 },
          { key: 'materials', header: 'Materials Used', width: 34 },
          { key: 'machinery', header: 'Machinery', width: 22 },
          { key: 'siteIssues', header: 'Site Issues', width: 28 },
          { key: 'safetyNotes', header: 'Safety Notes', width: 24 },
          { key: 'preparedBy', header: 'Prepared By', width: 18 },
        ],
        rows: sortRows(rows, query, 'reportDate'),
        totals: sum(rows, ['labourCount']),
      };
    }

    default:
      throw new Error(`Unknown report: ${key}`);
  }
}
