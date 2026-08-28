/** Response shapes returned by the Express API and consumed by the React app. */
import type { RiskLevel } from './constants';

export interface Paginated<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface AuthUser {
  id: number;
  username: string;
  fullName: string;
  role: string;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

export interface DashboardSummary {
  totalLeads: number;
  openLeads: number;
  wonLeads: number;
  activeClients: number;
  propertiesAvailable: number;
  propertiesReserved: number;
  propertiesSold: number;
  attendanceToday: { present: number; halfDay: number; absent: number; labourDays: number };
  materialUsedToday: { entries: number; value: number };
  activeProjects: number;
  monthlyRevenue: number;
  revenueLastMonth: number;
  overallProgress: number;
  lowStockCount: number;
  overdueFollowUps: number;
  todayFollowUps: number;
}

export interface NamedValue {
  name: string;
  value: number;
}

export interface DashboardCharts {
  leadFunnel: NamedValue[];
  salesTrend: { month: string; bookings: number; revenue: number }[];
  attendanceTrend: { date: string; present: number; halfDay: number; absent: number }[];
  materialConsumption: { name: string; quantity: number; value: number }[];
  inventoryStatus: { name: string; stock: number; reorderLevel: number }[];
  projectCompletion: { name: string; progress: number; risk: RiskLevel }[];
  weeklyDpr: { date: string; labour: number; reports: number }[];
}

export interface StockRow {
  id: number;
  name: string;
  category: string;
  unit: string;
  rate: number;
  openingStock: number;
  purchased: number;
  used: number;
  adjusted: number;
  inStock: number;
  reorderLevel: number;
  stockValue: number;
  low: boolean;
}

export interface StageForecast {
  stageId: number;
  name: string;
  weight: number;
  progress: number;
  avgDailyProgress: number;
  daysRemaining: number | null;
  estimatedCompletion: string | null;
}

export interface ProjectForecast {
  projectId: number;
  projectName: string;
  projectCode: string;
  status: string;
  startDate: string;
  expectedEndDate: string;
  progressPct: number;
  avgDailyProgress: number;
  daysElapsed: number;
  daysRemainingPlanned: number;
  estimatedCompletion: string | null;
  estimatedDaysRemaining: number | null;
  delayDays: number;
  riskLevel: RiskLevel;
  labour: {
    labourDaysUsed: number;
    avgDailyLabour: number;
    requiredLabourPerDay: number;
    projectedLabourDays: number;
    labourCostToDate: number;
    projectedLabourCost: number;
  };
  material: {
    consumedValue: number;
    avgDailyValue: number;
    projectedValue: number;
    topMaterials: { name: string; unit: string; quantity: number; projected: number }[];
  };
  cost: {
    budget: number;
    spentToDate: number;
    projectedTotal: number;
    variance: number;
  };
  stages: StageForecast[];
  history: { date: string; progress: number }[];
  notes: string[];
}

export interface GlobalSearchHit {
  type: 'lead' | 'client' | 'property' | 'project' | 'worker' | 'material' | 'dpr';
  id: number;
  title: string;
  subtitle: string;
  href: string;
}

export interface BackupFile {
  name: string;
  size: number;
  createdAt: string;
}

export interface ReportDefinition {
  key: string;
  label: string;
  description: string;
  filters: ('date' | 'project' | 'status' | 'search')[];
}

export interface ApiError {
  error: string;
  details?: { path: string; message: string }[];
}
