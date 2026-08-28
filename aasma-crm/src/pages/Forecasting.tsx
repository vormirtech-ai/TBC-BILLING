import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CalendarClock, CircleAlert, Gauge, IndianRupee, Save, TrendingUp, Users } from 'lucide-react';
import { PageHeader } from '@/components/app/PageHeader';
import { ChartCard, axisProps, chartTooltipStyle } from '@/components/app/ChartCard';
import { RiskBadge } from '@/components/app/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress, Skeleton } from '@/components/ui/misc';
import { useResource } from '@/hooks/useResource';
import { ApiError, api } from '@/lib/api';
import { formatDate, money, number, percent } from '@/lib/format';
import { RISK_COLORS } from '@shared/constants';
import { cn } from '@/lib/utils';
import type { ProjectForecast } from '@shared/types';

/**
 * The forecasting screen. Every figure here is derived from what the site team
 * already records, and each one is explained in the "How this was calculated"
 * panel so the numbers can be trusted rather than guessed at.
 */
export function ForecastingPage(): JSX.Element {
  const [selected, setSelected] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const forecasts = useResource<ProjectForecast[]>((signal) => api.get('/forecast', undefined, signal));

  useEffect(() => {
    if (selected === null && forecasts.data && forecasts.data.length > 0) {
      setSelected(forecasts.data[0].projectId);
    }
  }, [forecasts.data, selected]);

  const current = forecasts.data?.find((forecast) => forecast.projectId === selected) ?? null;

  const snapshot = async (): Promise<void> => {
    if (!current) return;
    setSaving(true);
    try {
      await api.post(`/forecast/${current.projectId}/snapshot`);
      toast.success('Forecast snapshot saved.');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'The snapshot could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  if (forecasts.loading && !forecasts.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 sm:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Forecasting"
        description="Estimated completion, delay risk and what it will take to finish on time."
        actions={
          current ? (
            <Button variant="outline" onClick={snapshot} loading={saving}>
              <Save className="h-4 w-4" />
              Save snapshot
            </Button>
          ) : null
        }
      />

      {(forecasts.data ?? []).length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            No active projects to forecast. Create a project and record some stage progress first.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Project picker — each card is a traffic light in its own right. */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {(forecasts.data ?? []).map((forecast) => (
              <button
                key={forecast.projectId}
                type="button"
                onClick={() => setSelected(forecast.projectId)}
                className={cn(
                  'card-surface p-4 text-left transition-all',
                  selected === forecast.projectId ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : 'hover:shadow-lift',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{forecast.projectName}</p>
                    <p className="text-xs text-muted-foreground">{forecast.projectCode}</p>
                  </div>
                  <RiskBadge risk={forecast.riskLevel} />
                </div>
                <div className="mt-3 space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Progress</span>
                    <span className="tabular font-semibold">{percent(forecast.progressPct)}</span>
                  </div>
                  <Progress
                    value={forecast.progressPct}
                    indicatorClassName={
                      forecast.riskLevel === 'RED'
                        ? 'bg-destructive'
                        : forecast.riskLevel === 'YELLOW'
                          ? 'bg-warning'
                          : 'bg-success'
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    {forecast.estimatedCompletion
                      ? `Forecast finish ${formatDate(forecast.estimatedCompletion, 'DD MMM YYYY')}`
                      : 'Not enough data to forecast'}
                  </p>
                </div>
              </button>
            ))}
          </div>

          {current ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Card>
                  <CardContent className="space-y-1 p-5">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <CalendarClock className="h-3.5 w-3.5" />
                      Estimated completion
                    </p>
                    <p className="text-2xl font-bold">
                      {current.estimatedCompletion ? formatDate(current.estimatedCompletion, 'DD MMM YYYY') : '—'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Planned {formatDate(current.expectedEndDate, 'DD MMM YYYY')}
                      {current.estimatedDaysRemaining !== null ? ` • ${current.estimatedDaysRemaining} day(s) to go` : ''}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="space-y-1 p-5">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <CircleAlert className="h-3.5 w-3.5" />
                      Delay risk
                    </p>
                    <p
                      className="text-2xl font-bold"
                      style={{ color: RISK_COLORS[current.riskLevel] }}
                    >
                      {current.delayDays > 0 ? `${current.delayDays} days late` : 'On schedule'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Progressing {number(current.avgDailyProgress, 3)}% per day
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="space-y-1 p-5">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <Users className="h-3.5 w-3.5" />
                      Labour required
                    </p>
                    <p className="tabular text-2xl font-bold">{number(current.labour.requiredLabourPerDay)}/day</p>
                    <p className="text-xs text-muted-foreground">
                      {number(current.labour.labourDaysUsed, 1)} labour-days used •{' '}
                      {number(current.labour.avgDailyLabour, 1)} average
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="space-y-1 p-5">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <IndianRupee className="h-3.5 w-3.5" />
                      Cost projection
                    </p>
                    <p className="tabular text-2xl font-bold">{money(current.cost.projectedTotal, { compact: true })}</p>
                    <p
                      className={cn(
                        'text-xs',
                        current.cost.variance < 0 ? 'font-medium text-destructive' : 'text-muted-foreground',
                      )}
                    >
                      {current.cost.budget > 0
                        ? current.cost.variance < 0
                          ? `${money(Math.abs(current.cost.variance), { compact: true })} over budget`
                          : `${money(current.cost.variance, { compact: true })} within budget`
                        : 'No budget set'}
                    </p>
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <ChartCard
                  title="Progress trend"
                  description="Recorded progress and the pace it implies"
                  className="lg:col-span-2"
                  height={280}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={current.history} margin={{ top: 8, right: 12 }}>
                      <defs>
                        <linearGradient id="forecastFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#BC1F43" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="#BC1F43" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="date" {...axisProps} />
                      <YAxis {...axisProps} domain={[0, 100]} width={44} tickFormatter={(value) => `${value}%`} />
                      <RTooltip {...chartTooltipStyle} formatter={(value: number) => [`${value}%`, 'Progress']} />
                      <Area type="monotone" dataKey="progress" stroke="#BC1F43" strokeWidth={2.5} fill="url(#forecastFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartCard>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Gauge className="h-4 w-4" />
                      How this was calculated
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2.5 text-sm text-muted-foreground">
                      {current.notes.map((note, index) => (
                        <li key={index} className="flex gap-2">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                          <span>{note}</span>
                        </li>
                      ))}
                      {current.notes.length === 0 ? <li>Nothing unusual — the project is tracking to plan.</li> : null}
                    </ul>
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Stage-wise forecast</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {current.stages.map((stage) => (
                      <div key={stage.stageId} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="truncate font-medium">{stage.name}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {stage.daysRemaining === null
                              ? 'No pace recorded'
                              : stage.daysRemaining === 0
                                ? 'Complete'
                                : `${stage.daysRemaining} day(s) left`}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <Progress value={stage.progress} className="flex-1" />
                          <span className="tabular w-12 text-right text-xs font-semibold">
                            {percent(stage.progress, 0)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <ChartCard title="Material required to finish" description="Projected total against what is already consumed">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={current.material.topMaterials} layout="vertical" margin={{ left: 24 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                      <XAxis type="number" {...axisProps} />
                      <YAxis type="category" dataKey="name" {...axisProps} width={110} />
                      <RTooltip {...chartTooltipStyle} />
                      <Bar dataKey="quantity" name="Used" fill="#BC1F43" radius={[0, 4, 4, 0]} />
                      <Bar dataKey="projected" name="Projected total" fill="#C7C8CA" radius={[0, 4, 4, 0]}>
                        {current.material.topMaterials.map((entry) => (
                          <Cell key={entry.name} fill="#C7C8CA" />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    What it takes to finish
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Remaining work
                      </dt>
                      <dd className="tabular mt-1 text-lg font-semibold">{percent(100 - current.progressPct)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Labour-days still needed
                      </dt>
                      <dd className="tabular mt-1 text-lg font-semibold">
                        {number(current.labour.projectedLabourDays - current.labour.labourDaysUsed, 0)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Projected labour cost
                      </dt>
                      <dd className="tabular mt-1 text-lg font-semibold">
                        {money(current.labour.projectedLabourCost, { compact: true })}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Projected material cost
                      </dt>
                      <dd className="tabular mt-1 text-lg font-semibold">
                        {money(current.material.projectedValue, { compact: true })}
                      </dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
            </>
          ) : null}
        </>
      )}
    </>
  );
}
