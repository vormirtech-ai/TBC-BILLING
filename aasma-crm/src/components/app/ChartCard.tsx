import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/misc';
import { cn } from '@/lib/utils';

export function ChartCard({
  title,
  description,
  action,
  children,
  loading,
  className,
  height = 260,
  delay = 0,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  loading?: boolean;
  className?: string;
  height?: number;
  delay?: number;
}): JSX.Element {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay }}>
      <Card className={cn('h-full', className)}>
        <CardHeader className="flex-row items-start justify-between space-y-0 gap-4">
          <div className="space-y-1">
            <CardTitle>{title}</CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>
          {action}
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton style={{ height }} className="w-full" />
          ) : (
            <div style={{ height }} className="w-full">
              {children}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

/** Recharts tooltip styled with the app's own tokens. */
export const chartTooltipStyle = {
  contentStyle: {
    background: 'hsl(var(--popover))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '0.6rem',
    fontSize: '0.8rem',
    color: 'hsl(var(--popover-foreground))',
    boxShadow: '0 12px 30px -16px hsl(var(--shadow-color) / 0.5)',
  },
  labelStyle: { color: 'hsl(var(--muted-foreground))', fontWeight: 600, marginBottom: 4 },
  cursor: { fill: 'hsl(var(--muted) / 0.6)' },
} as const;

export const axisProps = {
  stroke: 'hsl(var(--muted-foreground))',
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;
