/**
 * Record shapes for the browser database.
 *
 * They mirror the Prisma models one-for-one so the screens, the desktop build
 * and this build all speak the same language. Dates are held as real Date
 * objects in memory; responses are serialised to JSON before they reach the UI,
 * exactly as the HTTP API would.
 */

export interface BaseRow {
  id: number;
  /**
   * Stable identity across devices. The numeric id stays local to one browser
   * (it is what the screens and foreign keys use); the uid is what two devices
   * agree on when their data is merged through GitHub.
   */
  uid: string;
  createdAt: Date;
}

export interface UserRow extends BaseRow {
  username: string;
  passwordHash: string;
  fullName: string;
  role: string;
  active: boolean;
  lastLoginAt: Date | null;
  updatedAt: Date;
}

export interface SettingRow {
  key: string;
  value: string;
  updatedAt: Date;
}

/** Records a deletion so a merge does not resurrect the row from another device. */
export interface TombstoneRow {
  uid: string;
  table: TableName;
  deletedAt: Date;
}

/** Where the shared copy of the data lives. */
export type SyncProvider = 'github' | 'supabase';

/** The connection to the shared data and the state of the last exchange. */
export interface SyncMetaRow {
  key: 'sync';
  /** Identifies this browser in the sync log. */
  deviceId: string;
  deviceName: string;
  provider: SyncProvider;
  /** GitHub: a JSON file in a repository. */
  owner: string;
  repo: string;
  branch: string;
  path: string;
  token: string;
  /** Supabase: one row in a table, held as jsonb. */
  supabaseUrl: string;
  supabaseKey: string;
  supabaseTable: string;
  documentId: string;
  autoSync: boolean;
  /**
   * Bumped when someone erases the data for everyone. A device holding an older
   * generation drops its copy and takes the newer one instead of merging the
   * records back in.
   */
  generation: number;
  lastSyncedAt: Date | null;
  lastPushedAt: Date | null;
  lastStatus: string;
  /** The commit sha or row version the last exchange was based on. */
  remoteSha: string | null;
}

export interface ActivityLogRow extends BaseRow {
  actor: string;
  action: string;
  entity: string;
  entityId: string | null;
  detail: string | null;
}

export interface ProjectRow extends BaseRow {
  name: string;
  code: string;
  location: string;
  startDate: Date;
  expectedEndDate: Date;
  actualEndDate: Date | null;
  budget: number;
  contractor: string | null;
  engineer: string | null;
  status: string;
  description: string | null;
  updatedAt: Date;
}

export interface ProjectStageRow extends BaseRow {
  projectId: number;
  name: string;
  weight: number;
  progress: number;
  sortOrder: number;
  updatedAt: Date;
}

export interface StageProgressLogRow extends BaseRow {
  stageId: number;
  progress: number;
  recordedOn: Date;
  note: string | null;
}

export interface MilestoneRow extends BaseRow {
  projectId: number;
  title: string;
  dueDate: Date;
  completedOn: Date | null;
  status: string;
  notes: string | null;
  updatedAt: Date;
}

export interface PropertyRow extends BaseRow {
  projectId: number;
  tower: string;
  floor: number;
  unit: string;
  unitType: string;
  sizeSqft: number;
  price: number;
  facing: string;
  status: string;
  notes: string | null;
  updatedAt: Date;
}

export interface LeadRow extends BaseRow {
  name: string;
  phone: string;
  email: string | null;
  source: string;
  budget: number;
  interestedPropertyId: number | null;
  projectId: number | null;
  followUpDate: Date | null;
  status: string;
  assignedTo: string | null;
  notes: string | null;
  convertedClientId: number | null;
  updatedAt: Date;
}

export interface LeadActivityRow extends BaseRow {
  leadId: number;
  type: string;
  detail: string;
  happenedOn: Date;
}

export interface ClientRow extends BaseRow {
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  panNo: string | null;
  aadhaarNo: string | null;
  notes: string | null;
  updatedAt: Date;
}

export interface BookingRow extends BaseRow {
  clientId: number;
  propertyId: number;
  projectId: number | null;
  bookingDate: Date;
  agreementValue: number;
  bookingAmount: number;
  status: string;
  agreementNo: string | null;
  notes: string | null;
  updatedAt: Date;
}

export interface PaymentRow extends BaseRow {
  clientId: number;
  bookingId: number | null;
  amount: number;
  mode: string;
  paidOn: Date;
  reference: string | null;
  notes: string | null;
}

export interface DocumentRow extends BaseRow {
  clientId: number | null;
  bookingId: number | null;
  title: string;
  category: string;
  filePath: string;
  uploadedAt: Date;
}

export interface InteractionRow extends BaseRow {
  clientId: number;
  type: string;
  detail: string;
  happenedOn: Date;
}

export interface MaterialRow extends BaseRow {
  name: string;
  category: string;
  unit: string;
  openingStock: number;
  reorderLevel: number;
  rate: number;
  active: boolean;
  updatedAt: Date;
}

export interface PurchaseRow extends BaseRow {
  materialId: number;
  projectId: number | null;
  quantity: number;
  rate: number;
  amount: number;
  supplier: string | null;
  invoiceNo: string | null;
  purchasedOn: Date;
  notes: string | null;
}

export interface MaterialUsageRow extends BaseRow {
  materialId: number;
  projectId: number;
  quantity: number;
  usedOn: Date;
  issuedTo: string | null;
  notes: string | null;
}

export interface StockAdjustmentRow extends BaseRow {
  materialId: number;
  quantity: number;
  reason: string;
  adjustedOn: Date;
  notes: string | null;
}

export interface WorkerRow extends BaseRow {
  name: string;
  mobile: string | null;
  skill: string;
  contractor: string | null;
  dailyWage: number;
  projectId: number | null;
  active: boolean;
  joinedOn: Date;
  updatedAt: Date;
}

export interface AttendanceRow extends BaseRow {
  workerId: number;
  projectId: number | null;
  markedOn: Date;
  status: string;
  overtimeHours: number;
  notes: string | null;
}

export interface DprRow extends BaseRow {
  projectId: number;
  reportDate: Date;
  weather: string;
  workCompleted: string;
  labourCount: number;
  machinery: string | null;
  siteIssues: string | null;
  safetyNotes: string | null;
  preparedBy: string | null;
  updatedAt: Date;
}

export interface DprMaterialRow {
  id: number;
  uid: string;
  dprId: number;
  materialId: number;
  quantity: number;
}

export interface DprPhotoRow {
  id: number;
  uid: string;
  dprId: number;
  /** A data: URL — the image itself lives in this browser's database. */
  filePath: string;
  caption: string | null;
}

export interface ForecastSnapshotRow extends BaseRow {
  projectId: number;
  runOn: Date;
  progressPct: number;
  avgDailyProgress: number;
  estimatedCompletion: Date | null;
  delayDays: number;
  riskLevel: string;
  requiredLabour: number;
  costProjection: number;
  payload: string;
}

export interface BackupRow {
  name: string;
  createdAt: Date;
  size: number;
  /** The serialised database at the moment the backup was taken. */
  payload: string;
}

export interface SessionRow {
  token: string;
  userId: number;
  expiresAt: Date;
}

/** Every table in the browser database. */
export interface Database {
  users: UserRow[];
  settings: SettingRow[];
  activityLogs: ActivityLogRow[];
  projects: ProjectRow[];
  projectStages: ProjectStageRow[];
  stageProgressLogs: StageProgressLogRow[];
  milestones: MilestoneRow[];
  properties: PropertyRow[];
  leads: LeadRow[];
  leadActivities: LeadActivityRow[];
  clients: ClientRow[];
  bookings: BookingRow[];
  payments: PaymentRow[];
  documents: DocumentRow[];
  interactions: InteractionRow[];
  materials: MaterialRow[];
  purchases: PurchaseRow[];
  materialUsages: MaterialUsageRow[];
  stockAdjustments: StockAdjustmentRow[];
  workers: WorkerRow[];
  attendances: AttendanceRow[];
  dprs: DprRow[];
  dprMaterials: DprMaterialRow[];
  dprPhotos: DprPhotoRow[];
  forecastSnapshots: ForecastSnapshotRow[];
  backups: BackupRow[];
  sessions: SessionRow[];
  tombstones: TombstoneRow[];
  syncMeta: SyncMetaRow[];
}

export type TableName = keyof Database;

export const TABLE_NAMES: TableName[] = [
  'users',
  'settings',
  'activityLogs',
  'projects',
  'projectStages',
  'stageProgressLogs',
  'milestones',
  'properties',
  'leads',
  'leadActivities',
  'clients',
  'bookings',
  'payments',
  'documents',
  'interactions',
  'materials',
  'purchases',
  'materialUsages',
  'stockAdjustments',
  'workers',
  'attendances',
  'dprs',
  'dprMaterials',
  'dprPhotos',
  'forecastSnapshots',
  'backups',
  'sessions',
  'tombstones',
  'syncMeta',
];

/**
 * The tables that travel to GitHub. Backups, sessions and the sync settings
 * themselves stay on the device that made them.
 */
export const SYNCED_TABLES: TableName[] = [
  'users',
  'settings',
  'projects',
  'projectStages',
  'stageProgressLogs',
  'milestones',
  'properties',
  'leads',
  'leadActivities',
  'clients',
  'bookings',
  'payments',
  'documents',
  'interactions',
  'materials',
  'purchases',
  'materialUsages',
  'stockAdjustments',
  'workers',
  'attendances',
  'dprs',
  'dprMaterials',
  'dprPhotos',
  'forecastSnapshots',
];

/**
 * Foreign keys, so rows arriving from another device can have their references
 * repointed at the local numeric ids of the same records.
 */
export const RELATIONS: Partial<Record<TableName, Record<string, TableName>>> = {
  projectStages: { projectId: 'projects' },
  stageProgressLogs: { stageId: 'projectStages' },
  milestones: { projectId: 'projects' },
  properties: { projectId: 'projects' },
  leads: { interestedPropertyId: 'properties', projectId: 'projects', convertedClientId: 'clients' },
  leadActivities: { leadId: 'leads' },
  bookings: { clientId: 'clients', propertyId: 'properties', projectId: 'projects' },
  payments: { clientId: 'clients', bookingId: 'bookings' },
  documents: { clientId: 'clients', bookingId: 'bookings' },
  interactions: { clientId: 'clients' },
  purchases: { materialId: 'materials', projectId: 'projects' },
  materialUsages: { materialId: 'materials', projectId: 'projects' },
  stockAdjustments: { materialId: 'materials' },
  workers: { projectId: 'projects' },
  attendances: { workerId: 'workers', projectId: 'projects' },
  dprs: { projectId: 'projects' },
  dprMaterials: { dprId: 'dprs', materialId: 'materials' },
  dprPhotos: { dprId: 'dprs' },
  forecastSnapshots: { projectId: 'projects' },
};
