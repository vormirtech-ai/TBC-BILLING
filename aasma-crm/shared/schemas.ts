/**
 * Zod schemas shared by the Express API and the React forms.
 *
 * The server treats these as the trust boundary: nothing reaches Prisma without
 * passing through one of them. The client reuses the same schema in React Hook
 * Form, so a field can never be valid in the browser and rejected on the server.
 */
import { z } from 'zod';
import {
  ATTENDANCE_STATUSES,
  BOOKING_STATUSES,
  DOCUMENT_CATEGORIES,
  INTERACTION_TYPES,
  LEAD_ACTIVITY_TYPES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  MATERIAL_CATEGORIES,
  MILESTONE_STATUSES,
  PAYMENT_MODES,
  PROJECT_STATUSES,
  PROPERTY_FACINGS,
  PROPERTY_STATUSES,
  STOCK_ADJUSTMENT_REASONS,
  UNIT_TYPES,
  USER_ROLES,
  WEATHER_OPTIONS,
  WORKER_SKILLS,
} from './constants';

const optionalText = z
  .string()
  .trim()
  .max(4000)
  .optional()
  .nullable()
  .transform((value) => (value === '' ? null : (value ?? null)));

const requiredText = (label: string, max = 200) =>
  z.string({ required_error: `${label} is required` }).trim().min(1, `${label} is required`).max(max);

const money = z.coerce.number().min(0, 'Cannot be negative').max(1_000_000_000_000);
const quantity = z.coerce.number().min(0, 'Cannot be negative').max(100_000_000);

/**
 * Dates arrive either as an ISO string (an <input type="date"> value, or JSON on
 * the wire) or as a real Date. A union rather than z.coerce.date() keeps the
 * *input* type honest, so React Hook Form can hold the string the input element
 * actually gives it while the parsed value is always a Date.
 */
const toDate = (value: string | Date): Date => (value instanceof Date ? value : new Date(value));

const dateValue = z
  .union([z.string().min(1, 'Enter a valid date'), z.date()])
  .transform(toDate)
  .refine((value) => !Number.isNaN(value.getTime()), 'Enter a valid date');

const optionalDate = z
  .union([z.string(), z.date()])
  .nullish()
  .transform((value) => (value === '' || value == null ? null : toDate(value)))
  .refine((value) => value === null || !Number.isNaN(value.getTime()), 'Enter a valid date');
const optionalId = z.coerce.number().int().positive().optional().nullable();
const phone = z
  .string()
  .trim()
  .min(6, 'Enter a valid phone number')
  .max(20, 'Enter a valid phone number')
  .regex(/^[0-9+\-\s()]+$/, 'Phone can only contain digits and + - ( )');
const optionalEmail = z
  .string()
  .trim()
  .email('Enter a valid email')
  .max(200)
  .optional()
  .nullable()
  .or(z.literal(''))
  .transform((value) => (value ? value : null));

// ------------------------------------------------------------------ auth

export const loginSchema = z.object({
  username: requiredText('Username', 60),
  password: z.string().min(4, 'Password must be at least 4 characters').max(200),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(8, 'Use at least 8 characters')
      .max(200)
      .regex(/[A-Za-z]/, 'Include at least one letter')
      .regex(/[0-9]/, 'Include at least one number'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const userSchema = z.object({
  username: requiredText('Username', 60),
  fullName: requiredText('Full name', 120),
  role: z.enum(USER_ROLES).default('ADMIN'),
  password: z.string().min(8, 'Use at least 8 characters').max(200).optional(),
  active: z.coerce.boolean().default(true),
});

// ------------------------------------------------------------------ leads

export const leadSchema = z.object({
  name: requiredText('Name', 120),
  phone,
  email: optionalEmail,
  source: z.enum(LEAD_SOURCES).default('WALK_IN'),
  budget: money.default(0),
  interestedPropertyId: optionalId,
  projectId: optionalId,
  followUpDate: optionalDate,
  status: z.enum(LEAD_STATUSES).default('NEW'),
  assignedTo: optionalText,
  notes: optionalText,
});

export const leadActivitySchema = z.object({
  type: z.enum(LEAD_ACTIVITY_TYPES).default('NOTE'),
  detail: requiredText('Detail', 2000),
  happenedOn: dateValue.default(() => new Date()),
});

export const convertLeadSchema = z.object({
  address: optionalText,
  panNo: optionalText,
  createBooking: z.coerce.boolean().default(false),
  propertyId: optionalId,
  agreementValue: money.default(0),
  bookingAmount: money.default(0),
});

// ------------------------------------------------------------------ clients

export const clientSchema = z.object({
  name: requiredText('Name', 120),
  phone,
  email: optionalEmail,
  address: optionalText,
  panNo: optionalText,
  aadhaarNo: optionalText,
  notes: optionalText,
});

export const bookingSchema = z.object({
  clientId: z.coerce.number().int().positive('Select a client'),
  propertyId: z.coerce.number().int().positive('Select a property'),
  projectId: optionalId,
  bookingDate: dateValue,
  agreementValue: money.default(0),
  bookingAmount: money.default(0),
  status: z.enum(BOOKING_STATUSES).default('ACTIVE'),
  agreementNo: optionalText,
  notes: optionalText,
});

export const paymentSchema = z.object({
  clientId: z.coerce.number().int().positive('Select a client'),
  bookingId: optionalId,
  amount: money.refine((value) => value > 0, 'Amount must be greater than zero'),
  mode: z.enum(PAYMENT_MODES).default('BANK'),
  paidOn: dateValue,
  reference: optionalText,
  notes: optionalText,
});

export const interactionSchema = z.object({
  clientId: z.coerce.number().int().positive(),
  type: z.enum(INTERACTION_TYPES).default('NOTE'),
  detail: requiredText('Detail', 2000),
  happenedOn: dateValue.default(() => new Date()),
});

export const documentSchema = z.object({
  clientId: optionalId,
  bookingId: optionalId,
  title: requiredText('Title', 200),
  category: z.enum(DOCUMENT_CATEGORIES).default('AGREEMENT'),
});

// ------------------------------------------------------------------ projects

export const projectSchema = z.object({
  name: requiredText('Project name', 120),
  code: requiredText('Project code', 30).regex(/^[A-Za-z0-9-_]+$/, 'Use letters, numbers, - or _'),
  location: requiredText('Location', 200),
  startDate: dateValue,
  expectedEndDate: dateValue,
  actualEndDate: optionalDate,
  budget: money.default(0),
  contractor: optionalText,
  engineer: optionalText,
  status: z.enum(PROJECT_STATUSES).default('ACTIVE'),
  description: optionalText,
}).refine((data) => data.expectedEndDate >= data.startDate, {
  message: 'Expected end date must be on or after the start date',
  path: ['expectedEndDate'],
});

export const stageSchema = z.object({
  name: requiredText('Stage name', 80),
  weight: z.coerce.number().min(0).max(100).default(1),
  progress: z.coerce.number().min(0, 'Progress cannot be negative').max(100, 'Progress cannot exceed 100').default(0),
  sortOrder: z.coerce.number().int().min(0).default(0),
});

export const stageProgressSchema = z.object({
  progress: z.coerce.number().min(0).max(100),
  recordedOn: dateValue.default(() => new Date()),
  note: optionalText,
});

export const milestoneSchema = z.object({
  projectId: z.coerce.number().int().positive('Select a project'),
  title: requiredText('Title', 200),
  dueDate: dateValue,
  completedOn: optionalDate,
  status: z.enum(MILESTONE_STATUSES).default('PENDING'),
  notes: optionalText,
});

// ------------------------------------------------------------------ properties

export const propertySchema = z.object({
  projectId: z.coerce.number().int().positive('Select a project'),
  tower: requiredText('Tower', 40),
  floor: z.coerce.number().int().min(-5).max(200),
  unit: requiredText('Unit', 40),
  unitType: z.enum(UNIT_TYPES).default('2BHK'),
  sizeSqft: quantity.default(0),
  price: money.default(0),
  facing: z.enum(PROPERTY_FACINGS).default('EAST'),
  status: z.enum(PROPERTY_STATUSES).default('AVAILABLE'),
  notes: optionalText,
});

export const propertyImportSchema = z.object({
  rows: z.array(propertySchema).min(1, 'Nothing to import').max(5000),
});

// ------------------------------------------------------------------ inventory

export const materialSchema = z.object({
  name: requiredText('Material name', 120),
  category: z.enum(MATERIAL_CATEGORIES).default('GENERAL'),
  unit: requiredText('Unit', 20),
  openingStock: quantity.default(0),
  reorderLevel: quantity.default(0),
  rate: money.default(0),
  active: z.coerce.boolean().default(true),
});

export const purchaseSchema = z.object({
  materialId: z.coerce.number().int().positive('Select a material'),
  projectId: optionalId,
  quantity: quantity.refine((value) => value > 0, 'Quantity must be greater than zero'),
  rate: money,
  supplier: optionalText,
  invoiceNo: optionalText,
  purchasedOn: dateValue,
  notes: optionalText,
});

export const materialUsageSchema = z.object({
  materialId: z.coerce.number().int().positive('Select a material'),
  projectId: z.coerce.number().int().positive('Select a project'),
  quantity: quantity.refine((value) => value > 0, 'Quantity must be greater than zero'),
  usedOn: dateValue,
  issuedTo: optionalText,
  notes: optionalText,
});

export const stockAdjustmentSchema = z.object({
  materialId: z.coerce.number().int().positive('Select a material'),
  quantity: z.coerce.number().refine((value) => value !== 0, 'Quantity cannot be zero'),
  reason: z.enum(STOCK_ADJUSTMENT_REASONS).default('RETURN'),
  adjustedOn: dateValue,
  notes: optionalText,
});

// ------------------------------------------------------------------ labour

export const workerSchema = z.object({
  name: requiredText('Worker name', 120),
  mobile: phone.optional().nullable().or(z.literal('')).transform((value) => (value ? value : null)),
  skill: z.enum(WORKER_SKILLS).default('HELPER'),
  contractor: optionalText,
  dailyWage: money.default(0),
  projectId: optionalId,
  active: z.coerce.boolean().default(true),
  joinedOn: dateValue.default(() => new Date()),
});

export const attendanceEntrySchema = z.object({
  workerId: z.coerce.number().int().positive(),
  status: z.enum(ATTENDANCE_STATUSES).default('PRESENT'),
  overtimeHours: z.coerce.number().min(0).max(16).default(0),
  notes: optionalText,
});

/** The attendance screen saves a whole day for a site in one request. */
export const attendanceDaySchema = z.object({
  markedOn: dateValue,
  projectId: optionalId,
  entries: z.array(attendanceEntrySchema).max(2000),
});

// ------------------------------------------------------------------ dpr

export const dprMaterialSchema = z.object({
  materialId: z.coerce.number().int().positive(),
  quantity: quantity.refine((value) => value > 0, 'Quantity must be greater than zero'),
});

export const dprSchema = z.object({
  projectId: z.coerce.number().int().positive('Select a project'),
  reportDate: dateValue,
  weather: z.enum(WEATHER_OPTIONS).default('CLEAR'),
  workCompleted: requiredText('Work completed', 5000),
  labourCount: z.coerce.number().int().min(0).max(100000).default(0),
  machinery: optionalText,
  siteIssues: optionalText,
  safetyNotes: optionalText,
  preparedBy: optionalText,
  materials: z.array(dprMaterialSchema).max(100).default([]),
  /** When true the materials listed are also booked out of stock. */
  deductStock: z.coerce.boolean().default(false),
});

// ------------------------------------------------------------------ settings

export const settingsSchema = z.object({
  companyName: requiredText('Company name', 120),
  companyAddress: optionalText,
  companyPhone: optionalText,
  companyEmail: optionalEmail,
  gstNo: optionalText,
  currency: z.string().trim().min(1).max(5).default('₹'),
  financialYearStart: z.string().regex(/^\d{2}-\d{2}$/, 'Use MM-DD').default('04-01'),
  lowStockAlerts: z.coerce.boolean().default(true),
  followUpReminderDays: z.coerce.number().int().min(0).max(30).default(3),
});

// ------------------------------------------------------------------ queries

export const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(25),
  sortBy: z.string().trim().max(60).optional(),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  status: z.string().trim().max(60).optional(),
  projectId: z.coerce.number().int().positive().optional(),
  materialId: z.coerce.number().int().positive().optional(),
  clientId: z.coerce.number().int().positive().optional(),
  workerId: z.coerce.number().int().positive().optional(),
  category: z.string().trim().max(60).optional(),
  skill: z.string().trim().max(60).optional(),
  source: z.string().trim().max(60).optional(),
});

export type ListQuery = z.infer<typeof listQuerySchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type LeadInput = z.input<typeof leadSchema>;
export type ClientInput = z.input<typeof clientSchema>;
export type ProjectInput = z.input<typeof projectSchema>;
export type PropertyInput = z.input<typeof propertySchema>;
export type MaterialInput = z.input<typeof materialSchema>;
export type PurchaseInput = z.input<typeof purchaseSchema>;
export type MaterialUsageInput = z.input<typeof materialUsageSchema>;
export type StockAdjustmentInput = z.input<typeof stockAdjustmentSchema>;
export type WorkerInput = z.input<typeof workerSchema>;
export type DprInput = z.input<typeof dprSchema>;
export type BookingInput = z.input<typeof bookingSchema>;
export type PaymentInput = z.input<typeof paymentSchema>;
export type MilestoneInput = z.input<typeof milestoneSchema>;
export type SettingsInput = z.input<typeof settingsSchema>;
