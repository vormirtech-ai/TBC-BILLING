import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/** The dashboard's headline number tile. */
export function StatCard({
  label,
  value,
  hint,
  icon,
  trend,
  tone = 'default',
  delay = 0,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  /** Percentage change against the previous period. */
  trend?: number | null;
  tone?: 'default' | 'primary' | 'success' | 'warning' | 'destructive';
  delay?: number;
}): JSX.Element {
  const toneClass = {
    default: 'bg-muted text-muted-foreground',
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/15 text-warning',
    destructive: 'bg-destructive/10 text-destructive',
  }[tone];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay }}
      className="card-surface flex items-start justify-between gap-4 p-5"
    >
      <div className="min-w-0 space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="tabular truncate text-2xl font-bold tracking-tight">{value}</p>
        <div className="flex items-center gap-2">
          {typeof trend === 'number' && Number.isFinite(trend) ? (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 text-xs font-semibold',
                trend >= 0 ? 'text-success' : 'text-destructive',
              )}
            >
              {trend >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              {Math.abs(trend).toFixed(1)}%
            </span>
          ) : null}
          {hint ? <span className="truncate text-xs text-muted-foreground">{hint}</span> : null}
        </div>
      </div>
      {icon ? <div className={cn('rounded-lg p-2.5', toneClass)}>{icon}</div> : null}
    </motion.div>
  );
}
