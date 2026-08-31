import { db } from '../db';
import { endOfDay, round, startOfDay, type Query } from '../query';
import { ATTENDANCE_WEIGHT, humanize, type AttendanceStatus } from '@shared/constants';
import type { ReportDefinition } from '@shared/types';
import { stockRows } from './stock';
import { buildForecast } from './forecast';

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
  totals: Record<string, number>;
}

/** The same nine registers the desktop build offers. */
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

function periodLabel(query: Query): string {
  const from = query.from ? new Date(String(query.from)) : null;
  const to = query.to ? new Date(String(query.to)) : null;
  if (from && to) return `${from.toLocaleDateString('en-IN')} to ${to.toLocaleDateString('en-IN')}`;
  if (from) return `From ${from.toLocaleDateString('en-IN')}`;
  if (to) return `Up to ${to.toLocaleDateString('en-IN')}`;
  return 'All time';
}

function inRange(value: Date | null | undefined, query: Query): boolean {
  if (!value) return !query.from && !query.to;
  if (query.from && value < startOfDay(new Date(String(query.from)))) return false;
  if (query.to && value > endOfDay(new Date(String(query.to)))) return false;
  return true;
}

function contains(value: unknown, term: string): boolean {
  return value != null && String(value).toLowerCase().includes(term);
}

function sortRows(rows: Record<string, unknown>[], query: Query, fallback: string): Record<string, unknown>[] {
  const key = query.sortBy && rows.length > 0 && Object.prototype.hasOwnProperty.call(rows[0], query.sortBy)
    ? query.sortBy
    : fallback;
  const direction = query.sortDir === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const left = a[key];
    const right = b[key];
    if (left == null && right == null) return 0;
    if (left == null) return 1;
    if (right == null) return -1;
    if (left instanceof Date && right instanceof Date) return (left.getTime() - right.getTime()) * direction;
    if (typeof left === 'number' && typeof right === 'number') return (left - right) * direction;
    return String(left).localeCompare(String(right)) * direction;
  });
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

export function buildReport(key: string, query: Query): ReportResult {
  const definition = REPORTS.find((report) => report.key === key);
  if (!definition) throw new Error(`Unknown report: ${key}`);

  const data = db();
  const subtitle = periodLabel(query);
  const term = String(query.q ?? '').trim().toLowerCase();
  const projectId = query.projectId ? Number(query.projectId) : null;
  const status = query.status ? String(query.status) : null;

  switch (key) {
    case 'leads': {
      const rows = data.leads
        .filter((lead) => inRange(lead.createdAt, query))
        .filter((lead) => (status ? lead.status === status : true))
        .filter((lead) =>
          term ? contains(lead.name, term) || contains(lead.phone, term) || contains(lead.email, term) : true,
        )
        .map((lead) => {
          const property = data.properties.find((row) => row.id === lead.interestedPropertyId);
          return {
            id: lead.id,
            name: lead.name,
            phone: lead.phone,
            email: lead.email ?? '',
            source: humanize(lead.source),
            budget: round(lead.budget, 2),
            project: data.projects.find((row) => row.id === lead.projectId)?.name ?? '',
            interested: property ? `${property.tower}-${property.unit}` : '',
            status: humanize(lead.status),
            followUpDate: lead.followUpDate,
            assignedTo: lead.assignedTo ?? '',
            createdAt: lead.createdAt,
          };
        });
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
      const rows = data.clients
        .filter((client) => inRange(client.createdAt, query))
        .filter((client) => (term ? contains(client.name, term) || contains(client.phone, term) : true))
        .map((client) => {
          const bookings = data.bookings.filter((row) => row.clientId === client.id && row.status !== 'CANCELLED');
          const agreement = bookings.reduce((acc, row) => acc + row.agreementValue, 0);
          const paid = data.payments
            .filter((row) => row.clientId === client.id)
            .reduce((acc, row) => acc + row.amount, 0);
          return {
            id: client.id,
            name: client.name,
            phone: client.phone,
            email: client.email ?? '',
            bookings: bookings.length,
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
      const rows = data.properties
        .filter((property) => (projectId ? property.projectId === projectId : true))
        .filter((property) => (status ? property.status === status : true))
        .filter((property) => (term ? contains(property.tower, term) || contains(property.unit, term) : true))
        .map((property) => {
          const booking = data.bookings.find((row) => row.propertyId === property.id && row.status === 'ACTIVE');
          return {
            id: property.id,
            project: data.projects.find((row) => row.id === property.projectId)?.name ?? '',
            tower: property.tower,
            floor: property.floor,
            unit: property.unit,
            unitType: property.unitType,
            sizeSqft: property.sizeSqft,
            price: round(property.price, 2),
            ratePerSqft: property.sizeSqft > 0 ? round(property.price / property.sizeSqft, 2) : 0,
            facing: humanize(property.facing),
            status: humanize(property.status),
            client: booking ? (data.clients.find((row) => row.id === booking.clientId)?.name ?? '') : '',
          };
        });
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
      const rows = data.projects
        .filter((project) => (status ? project.status === status : true))
        .filter((project) =>
          term ? contains(project.name, term) || contains(project.code, term) || contains(project.location, term) : true,
        )
        .map((project) => {
          const forecast = buildForecast(project.id);
          return {
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
          };
        });
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
      const rows = stockRows({ q: term, category: query.category ? String(query.category) : undefined }).map((row) => ({
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
      const rows = data.materialUsages
        .filter((usage) => inRange(usage.usedOn, query))
        .filter((usage) => (projectId ? usage.projectId === projectId : true))
        .filter((usage) =>
          term ? contains(data.materials.find((row) => row.id === usage.materialId)?.name, term) : true,
        )
        .map((usage) => {
          const material = data.materials.find((row) => row.id === usage.materialId);
          return {
            usedOn: usage.usedOn,
            material: material?.name ?? '',
            unit: material?.unit ?? '',
            project: data.projects.find((row) => row.id === usage.projectId)?.name ?? '',
            quantity: round(usage.quantity, 3),
            rate: round(material?.rate ?? 0, 2),
            value: round(usage.quantity * (material?.rate ?? 0), 2),
            issuedTo: usage.issuedTo ?? '',
            notes: usage.notes ?? '',
          };
        });
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
      const attendance = data.attendances
        .filter((row) => inRange(row.markedOn, query))
        .filter((row) => (projectId ? row.projectId === projectId : true))
        .filter((row) => (term ? contains(data.workers.find((w) => w.id === row.workerId)?.name, term) : true));

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
        const worker = data.workers.find((item) => item.id === row.workerId);
        if (!worker) continue;
        const entry =
          byWorker.get(worker.id) ??
          {
            name: worker.name,
            skill: humanize(worker.skill),
            contractor: worker.contractor ?? '',
            dailyWage: worker.dailyWage,
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
        byWorker.set(worker.id, entry);
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
      const rows = data.dprs
        .filter((report) => inRange(report.reportDate, query))
        .filter((report) => (projectId ? report.projectId === projectId : true))
        .filter((report) => (term ? contains(report.workCompleted, term) || contains(report.siteIssues, term) : true))
        .map((report) => ({
          reportDate: report.reportDate,
          project: data.projects.find((row) => row.id === report.projectId)?.name ?? '',
          weather: humanize(report.weather),
          labourCount: report.labourCount,
          workCompleted: report.workCompleted,
          materials: data.dprMaterials
            .filter((item) => item.dprId === report.id)
            .map((item) => {
              const material = data.materials.find((row) => row.id === item.materialId);
              return `${material?.name ?? ''} ${round(item.quantity, 2)} ${material?.unit ?? ''}`.trim();
            })
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
