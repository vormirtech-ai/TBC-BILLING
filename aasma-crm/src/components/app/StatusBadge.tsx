import { Badge } from '@/components/ui/badge';
import { humanize, type RiskLevel } from '@shared/constants';

type Variant = 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive' | 'muted';

/** One place deciding what colour each status code is shown in. */
const VARIANTS: Record<string, Variant> = {
  // Leads
  NEW: 'secondary',
  CONTACTED: 'secondary',
  INTERESTED: 'default',
  SITE_VISIT: 'default',
  NEGOTIATION: 'warning',
  WON: 'success',
  LOST: 'muted',
  // Properties
  AVAILABLE: 'success',
  RESERVED: 'warning',
  SOLD: 'default',
  // Projects and milestones
  PLANNED: 'secondary',
  ACTIVE: 'success',
  ON_HOLD: 'warning',
  COMPLETED: 'default',
  PENDING: 'secondary',
  DONE: 'success',
  DELAYED: 'destructive',
  // Attendance
  PRESENT: 'success',
  HALF_DAY: 'warning',
  ABSENT: 'destructive',
  // Bookings
  CANCELLED: 'destructive',
  // Stock
  LOW: 'destructive',
  OK: 'success',
};

export function StatusBadge({ status, className }: { status: string | null | undefined; className?: string }): JSX.Element {
  if (!status) return <Badge variant="muted" className={className}>—</Badge>;
  return (
    <Badge variant={VARIANTS[status] ?? 'secondary'} className={className}>
      {humanize(status)}
    </Badge>
  );
}

const RISK_VARIANT: Record<RiskLevel, Variant> = {
  GREEN: 'success',
  YELLOW: 'warning',
  RED: 'destructive',
};

const RISK_LABEL: Record<RiskLevel, string> = {
  GREEN: 'On track',
  YELLOW: 'At risk',
  RED: 'Delayed',
};

export function RiskBadge({ risk, className }: { risk: RiskLevel; className?: string }): JSX.Element {
  return (
    <Badge variant={RISK_VARIANT[risk]} className={className}>
      <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current" />
      {RISK_LABEL[risk]}
    </Badge>
  );
}
