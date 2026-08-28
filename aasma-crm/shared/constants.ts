/**
 * Single source of truth for the fixed value lists used by the CRM.
 *
 * SQLite has no native enum type, so these arrays back both the Zod validation
 * on the server and the dropdowns/badges in the React app. Adding a value here
 * makes it legal everywhere at once.
 */

export const LEAD_STATUSES = [
  'NEW',
  'CONTACTED',
  'INTERESTED',
  'SITE_VISIT',
  'NEGOTIATION',
  'WON',
  'LOST',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_SOURCES = [
  'WALK_IN',
  'REFERRAL',
  'WEBSITE',
  'CALL',
  'BROKER',
  'CAMPAIGN',
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_ACTIVITY_TYPES = ['NOTE', 'CALL', 'VISIT', 'STATUS_CHANGE', 'EMAIL'] as const;

export const PROPERTY_STATUSES = ['AVAILABLE', 'RESERVED', 'SOLD'] as const;
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];

export const PROPERTY_FACINGS = ['EAST', 'WEST', 'NORTH', 'SOUTH', 'NORTH_EAST', 'SOUTH_EAST', 'NORTH_WEST', 'SOUTH_WEST'] as const;

export const UNIT_TYPES = ['1BHK', '2BHK', '3BHK', '4BHK', 'PENTHOUSE', 'SHOP', 'OFFICE', 'PLOT'] as const;

export const PROJECT_STATUSES = ['PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** The default construction stages every new project is created with. */
export const DEFAULT_STAGES = [
  { name: 'Foundation', weight: 15 },
  { name: 'Structure', weight: 25 },
  { name: 'Brick Work', weight: 15 },
  { name: 'Plaster', weight: 10 },
  { name: 'Electrical', weight: 10 },
  { name: 'Plumbing', weight: 10 },
  { name: 'Finishing', weight: 15 },
] as const;

export const MILESTONE_STATUSES = ['PENDING', 'DONE', 'DELAYED'] as const;

export const MATERIAL_CATEGORIES = [
  'CEMENT',
  'SAND',
  'STEEL',
  'BRICKS',
  'GRAVEL',
  'PAINT',
  'PIPES',
  'ELECTRICAL',
  'GENERAL',
] as const;
export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number];

export const STOCK_ADJUSTMENT_REASONS = ['RETURN', 'DAMAGE', 'WASTAGE', 'CORRECTION'] as const;

export const WORKER_SKILLS = [
  'MASON',
  'CARPENTER',
  'ELECTRICIAN',
  'PLUMBER',
  'PAINTER',
  'HELPER',
  'OPERATOR',
  'SUPERVISOR',
] as const;
export type WorkerSkill = (typeof WORKER_SKILLS)[number];

export const ATTENDANCE_STATUSES = ['PRESENT', 'HALF_DAY', 'ABSENT'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** Day-value each attendance status contributes to a labour-day total. */
export const ATTENDANCE_WEIGHT: Record<AttendanceStatus, number> = {
  PRESENT: 1,
  HALF_DAY: 0.5,
  ABSENT: 0,
};

export const WEATHER_OPTIONS = ['CLEAR', 'CLOUDY', 'RAIN', 'STORM', 'HOT'] as const;

export const PAYMENT_MODES = ['CASH', 'BANK', 'CHEQUE', 'UPI', 'LOAN'] as const;

export const BOOKING_STATUSES = ['ACTIVE', 'CANCELLED', 'COMPLETED'] as const;

export const DOCUMENT_CATEGORIES = ['AGREEMENT', 'KYC', 'RECEIPT', 'PLAN', 'OTHER'] as const;

export const INTERACTION_TYPES = ['NOTE', 'CALL', 'MEETING', 'SITE_VISIT', 'PAYMENT', 'DOCUMENT'] as const;

export const USER_ROLES = ['ADMIN', 'MANAGER', 'ENGINEER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const RISK_LEVELS = ['GREEN', 'YELLOW', 'RED'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/** Turns SCREAMING_SNAKE codes into "Screaming Snake" for display. */
export function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  return value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Brand palette from the Aasma Construction guidelines. */
export const BRAND = {
  crimson: '#BC1F43',
  accent: '#EE3A43',
  mist: '#C7C8CA',
  steel: '#818286',
  ink: '#231F20',
} as const;

/** Ordered series colours for charts — brand first, then supporting hues. */
export const CHART_COLORS = [
  '#BC1F43',
  '#EE3A43',
  '#818286',
  '#E7899A',
  '#C7C8CA',
  '#7A1230',
  '#F2A9AE',
  '#4B4749',
] as const;

export const RISK_COLORS: Record<RiskLevel, string> = {
  GREEN: '#15803D',
  YELLOW: '#B45309',
  RED: '#BC1F43',
};
