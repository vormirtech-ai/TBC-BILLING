import { useNavigate } from 'react-router-dom';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  HardHat,
  IndianRupee,
  Package,
  TrendingUp,
  Users,
} from 'lucide-react';
import { PageHeader } from '@/components/app/PageHeader';
import { StatCard } from '@/components/app/StatCard';
import { ChartCard, axisProps, chartTooltipStyle } from '@/components/app/ChartCard';
import { RiskBadge } from '@/components/app/StatusBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/misc';
import { useResource } from '@/hooks/useResource';
import { api } from '@/lib/api';
import { formatDate, money, number, percent } from '@/lib/format';
import { CHART_COLORS } from '@shared/constants';
import type { DashboardCharts, DashboardSummary, StockRow } from '@shared/types';

interface Alerts {
  followUps: { id: number; name: string; phone: string; followUpDate: string | null; status: string }[];
  lowStock: StockRow[];
  milestones: { id: number; title: string; dueDate: string; project?: { name: string } | null }[];
  missingDpr: { id: number; name: string }[];
}

export function DashboardPage(): JSX.Element {
  const navigate = useNavigate();
  const summary = useResource<DashboardSummary>((signal) => api.get('/dashboard/summary', undefined, signal));
  const charts = useResource<DashboardCharts>((signal) => api.get('/dashboard/charts', undefined, signal));
  const alerts = useResource<Alerts>((signal) => api.get('/dashboard/alerts', undefined, signal));

  const data = summary.data;
  const revenueTrend =
    data && data.revenueLastMonth > 0
      ? ((data.monthlyRevenue - data.revenueLastMonth) / data.revenueLastMonth) * 100
      : null;

  const progressRing = [
    {
      name: 'Progress',
      value: data?.overallProgress ?? 0,
      fill: '#BC1F43',
    },
  ];

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Sales, sites, stock and labour at a glance."
        actions={
          <>
            <Button variant="outline" onClick={() => navigate('/reports')}>
              Reports
            </Button>
            <Button onClick={() => navigate('/forecasting')}>
              <TrendingUp className="h-4 w-4" />
              Forecast
            </Button>
          </>
        }
      />

      {summary.error ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">{summary.error}</CardContent>
        </Card>
      ) : null}

      {/* Headline numbers */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total leads"
          value={number(data?.totalLeads)}
          hint={`${number(data?.openLeads)} still open`}
          icon={<Users className="h-5 w-5" />}
          tone="primary"
          delay={0}
        />
        <StatCard
          label="Active clients"
          value={number(data?.activeClients)}
          hint={`${number(data?.wonLeads)} leads won`}
          icon={<Users className="h-5 w-5" />}
          tone="success"
          delay={0.04}
        />
        <StatCard
          label="Monthly revenue"
          value={money(data?.monthlyRevenue, { compact: true })}
          hint="Collections this month"
          trend={revenueTrend}
          icon={<IndianRupee className="h-5 w-5" />}
          tone="primary"
          delay={0.08}
        />
        <StatCard
          label="Construction progress"
          value={percent(data?.overallProgress)}
          hint={`${number(data?.activeProjects)} active project(s)`}
          icon={<Building2 className="h-5 w-5" />}
          tone="warning"
          delay={0.12}
        />
        <StatCard
          label="Available units"
          value={number(data?.propertiesAvailable)}
          hint={`${number(data?.propertiesReserved)} reserved • ${number(data?.propertiesSold)} sold`}
          icon={<HardHat className="h-5 w-5" />}
          delay={0.16}
        />
        <StatCard
          label="Today's attendance"
          value={number(data?.attendanceToday.present)}
          hint={`${number(data?.attendanceToday.labourDays, 1)} labour-days • ${number(
            data?.attendanceToday.absent,
          )} absent`}
          icon={<CalendarClock className="h-5 w-5" />}
          tone="success"
          delay={0.2}
        />
        <StatCard
          label="Material used today"
          value={money(data?.materialUsedToday.value, { compact: true })}
          hint={`${number(data?.materialUsedToday.entries)} issue(s)`}
          icon={<Package className="h-5 w-5" />}
          delay={0.24}
        />
        <StatCard
          label="Needs attention"
          value={number((data?.overdueFollowUps ?? 0) + (data?.lowStockCount ?? 0))}
          hint={`${number(data?.overdueFollowUps)} overdue follow-ups • ${number(data?.lowStockCount)} low stock`}
          icon={<AlertTriangle className="h-5 w-5" />}
          tone="destructive"
          delay={0.28}
        />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          title="Sales trend"
          description="Bookings and collections over the last 12 months"
          loading={charts.loading}
          className="lg:col-span-2"
          delay={0.05}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={charts.data?.salesTrend ?? []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#BC1F43" stopOpacity={0.32} />
                  <stop offset="100%" stopColor="#BC1F43" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="month" {...axisProps} />
              <YAxis {...axisProps} tickFormatter={(value) => money(Number(value), { compact: true })} width={70} />
              <RTooltip
                {...chartTooltipStyle}
                formatter={(value: number, name) =>
                  name === 'revenue' ? [money(value), 'Collections'] : [number(value), 'Bookings']
                }
              />
              <Area type="monotone" dataKey="revenue" stroke="#BC1F43" strokeWidth={2} fill="url(#revenueFill)" />
              <Line type="monotone" dataKey="bookings" stroke="#818286" strokeWidth={2} dot={false} yAxisId={0} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Lead funnel" description="Where every enquiry stands" loading={charts.loading} delay={0.1}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={charts.data?.leadFunnel ?? []} layout="vertical" margin={{ left: 12, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis type="number" {...axisProps} allowDecimals={false} />
              <YAxis type="category" dataKey="name" {...axisProps} width={78} />
              <RTooltip {...chartTooltipStyle} formatter={(value: number) => [number(value), 'Leads']} />
              <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                {(charts.data?.leadFunnel ?? []).map((entry, index) => (
                  <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Labour attendance"
          description="Present, half day and absent over 14 days"
          loading={charts.loading}
          className="lg:col-span-2"
          delay={0.15}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={charts.data?.attendanceTrend ?? []} margin={{ top: 8, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="date" {...axisProps} />
              <YAxis {...axisProps} allowDecimals={false} width={40} />
              <RTooltip {...chartTooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="present" stackId="a" fill="#BC1F43" name="Present" radius={[0, 0, 0, 0]} />
              <Bar dataKey="halfDay" stackId="a" fill="#EE3A43" name="Half day" />
              <Bar dataKey="absent" stackId="a" fill="#C7C8CA" name="Absent" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Overall progress" description="Weighted across active sites" loading={summary.loading} delay={0.2}>
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart
              data={progressRing}
              innerRadius="68%"
              outerRadius="100%"
              startAngle={90}
              endAngle={-270}
            >
              <RadialBar background dataKey="value" cornerRadius={12} />
              <text
                x="50%"
                y="48%"
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-foreground text-3xl font-bold"
              >
                {percent(data?.overallProgress, 0)}
              </text>
              <text x="50%" y="62%" textAnchor="middle" className="fill-muted-foreground text-xs">
                complete
              </text>
            </RadialBarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Material consumption"
          description="Top materials issued in the last 30 days"
          loading={charts.loading}
          delay={0.25}
        >
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={charts.data?.materialConsumption ?? []}
                dataKey="value"
                nameKey="name"
                innerRadius="52%"
                outerRadius="82%"
                paddingAngle={2}
              >
                {(charts.data?.materialConsumption ?? []).map((entry, index) => (
                  <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Pie>
              <RTooltip {...chartTooltipStyle} formatter={(value: number) => money(value)} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Inventory status" description="Stock against reorder level" loading={charts.loading} delay={0.3}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={charts.data?.inventoryStatus ?? []} margin={{ top: 8, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="name" {...axisProps} interval={0} angle={-18} textAnchor="end" height={54} />
              <YAxis {...axisProps} width={50} />
              <RTooltip {...chartTooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="stock" name="In stock" fill="#BC1F43" radius={[4, 4, 0, 0]} />
              <Bar dataKey="reorderLevel" name="Reorder at" fill="#C7C8CA" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Weekly DPR" description="Labour reported each day" loading={charts.loading} delay={0.35}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={charts.data?.weeklyDpr ?? []} margin={{ top: 8, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="date" {...axisProps} />
              <YAxis {...axisProps} width={40} allowDecimals={false} />
              <RTooltip {...chartTooltipStyle} />
              <Line type="monotone" dataKey="labour" name="Labour" stroke="#BC1F43" strokeWidth={2.5} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="reports" name="Reports" stroke="#818286" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Project completion + alerts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Project completion</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('/projects')}>
              View all
            </Button>
          </CardHeader>
          <CardContent className="space-y-5">
            {(charts.data?.projectCompletion ?? []).length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No active projects yet.</p>
            ) : (
              (charts.data?.projectCompletion ?? []).map((project) => (
                <div key={project.name} className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium">{project.name}</span>
                    <div className="flex shrink-0 items-center gap-3">
                      <RiskBadge risk={project.risk} />
                      <span className="tabular w-12 text-right text-sm font-semibold">
                        {percent(project.progress, 0)}
                      </span>
                    </div>
                  </div>
                  <Progress
                    value={project.progress}
                    indicatorClassName={
                      project.risk === 'RED'
                        ? 'bg-destructive'
                        : project.risk === 'YELLOW'
                          ? 'bg-warning'
                          : 'bg-success'
                    }
                  />
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Needs attention</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Follow-ups due</p>
              {(alerts.data?.followUps ?? []).slice(0, 4).map((lead) => (
                <button
                  key={lead.id}
                  type="button"
                  onClick={() => navigate('/leads')}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                >
                  <span className="truncate">{lead.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatDate(lead.followUpDate, 'DD MMM')}</span>
                </button>
              ))}
              {(alerts.data?.followUps ?? []).length === 0 ? (
                <p className="px-2 text-xs text-muted-foreground">Nothing due.</p>
              ) : null}
            </div>

            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Low stock</p>
              {(alerts.data?.lowStock ?? []).slice(0, 4).map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => navigate('/inventory')}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                >
                  <span className="truncate">{row.name}</span>
                  <span className="shrink-0 text-xs font-semibold text-destructive">
                    {number(row.inStock, 1)} {row.unit}
                  </span>
                </button>
              ))}
              {(alerts.data?.lowStock ?? []).length === 0 ? (
                <p className="px-2 text-xs text-muted-foreground">All materials above reorder level.</p>
              ) : null}
            </div>

            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">DPR not filed today</p>
              {(alerts.data?.missingDpr ?? []).slice(0, 4).map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => navigate('/dpr')}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                >
                  <span className="truncate">{project.name}</span>
                  <span className="shrink-0 text-xs text-warning">Pending</span>
                </button>
              ))}
              {(alerts.data?.missingDpr ?? []).length === 0 ? (
                <p className="px-2 text-xs text-muted-foreground">Every active site has filed today's report.</p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
