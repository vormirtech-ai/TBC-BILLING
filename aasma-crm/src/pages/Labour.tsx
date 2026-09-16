import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { CalendarCheck, Download, HardHat, Plus, Save, Users } from 'lucide-react';
import { PageHeader } from '@/components/app/PageHeader';
import { FilterBar } from '@/components/app/FilterBar';
import { DataTable } from '@/components/app/DataTable';
import { FormDialog } from '@/components/app/FormDialog';
import { ChartCard, axisProps, chartTooltipStyle } from '@/components/app/ChartCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton, Tooltip } from '@/components/ui/misc';
import { useListState } from '@/hooks/useListState';
import { useResource } from '@/hooks/useResource';
import { ApiError, api, downloadFile } from '@/lib/api';
import { money, monthInput, number, today } from '@/lib/format';
import { ATTENDANCE_STATUSES, WORKER_SKILLS, humanize } from '@shared/constants';
import { workerSchema, type WorkerInput } from '@shared/schemas';
import type { Paginated } from '@shared/types';

interface Worker {
  id: number;
  name: string;
  mobile: string | null;
  skill: string;
  contractor: string | null;
  dailyWage: number;
  active: boolean;
  projectId: number | null;
  project?: { id: number; name: string } | null;
}

interface DayRow {
  workerId: number;
  name: string;
  skill: string;
  contractor: string | null;
  dailyWage: number;
  status: string | null;
  overtimeHours: number;
  notes: string;
}

interface SheetRow {
  workerId: number;
  name: string;
  skill: string;
  contractor: string;
  cells: (null | { status: string; overtimeHours: number })[];
  present: number;
  halfDay: number;
  absent: number;
  labourDays: number;
  overtimeHours: number;
  payable: number;
}

interface Consumption {
  labourDays: number;
  cost: number;
  workers: number;
  avgCostPerLabourDay: number;
  progress: number;
  productivity: number;
  bySkill: { skill: string; labourDays: number; cost: number }[];
  byDay: { date: string; labourDays: number }[];
}

const CELL_STYLES: Record<string, string> = {
  PRESENT: 'bg-success/80 text-white',
  HALF_DAY: 'bg-warning/80 text-white',
  ABSENT: 'bg-destructive/70 text-white',
};

export function LabourPage(): JSX.Element {
  const [tab, setTab] = useState('attendance');
  const list = useListState({ sortBy: 'name', sortDir: 'asc' });

  const [date, setDate] = useState(today());
  const [projectId, setProjectId] = useState('');
  const [month, setMonth] = useState(monthInput());
  const [draft, setDraft] = useState<Record<number, { status: string; overtimeHours: number }>>({});
  const [saving, setSaving] = useState(false);
  const [workerOpen, setWorkerOpen] = useState(false);
  const [editing, setEditing] = useState<Worker | null>(null);

  const projects = useResource<{ id: number; name: string }[]>((signal) => api.get('/projects/options', undefined, signal));

  const day = useResource<{ date: string; rows: DayRow[] }>(
    (signal) => api.get('/attendance/day', { date, projectId }, signal),
    [date, projectId, tab],
    { enabled: tab === 'attendance' },
  );

  const sheet = useResource<{ month: string; daysInMonth: number; rows: SheetRow[]; totals: { labourDays: number; payable: number; workers: number } }>(
    (signal) => api.get('/attendance/sheet', { month, projectId }, signal),
    [month, projectId, tab],
    { enabled: tab === 'sheet' },
  );

  const consumption = useResource<Consumption>(
    (signal) => api.get('/attendance/consumption', { projectId }, signal),
    [projectId, tab],
    { enabled: tab === 'consumption' },
  );

  const workers = useResource<Paginated<Worker>>(
    (signal) => api.list<Worker>('/workers', list.query, signal),
    [JSON.stringify(list.query), tab],
    { enabled: tab === 'workers' },
  );

  // Start from whatever is already marked for the chosen day.
  useEffect(() => {
    if (!day.data) return;
    const next: Record<number, { status: string; overtimeHours: number }> = {};
    for (const row of day.data.rows) {
      next[row.workerId] = { status: row.status ?? 'PRESENT', overtimeHours: row.overtimeHours };
    }
    setDraft(next);
  }, [day.data]);

  const form = useForm<WorkerInput>({
    resolver: zodResolver(workerSchema),
    defaultValues: {
      name: '',
      mobile: '',
      skill: 'HELPER',
      contractor: '',
      dailyWage: 0,
      projectId: null,
      active: true,
      joinedOn: today(),
    },
  });

  const openCreate = (): void => {
    setEditing(null);
    form.reset({
      name: '',
      mobile: '',
      skill: 'HELPER',
      contractor: '',
      dailyWage: 0,
      projectId: projectId ? Number(projectId) : null,
      active: true,
      joinedOn: today(),
    });
    setWorkerOpen(true);
  };

  const openEdit = (worker: Worker): void => {
    setEditing(worker);
    form.reset({
      name: worker.name,
      mobile: worker.mobile ?? '',
      skill: worker.skill as WorkerInput['skill'],
      contractor: worker.contractor ?? '',
      dailyWage: worker.dailyWage,
      projectId: worker.projectId ?? null,
      active: worker.active,
      joinedOn: today(),
    });
    setWorkerOpen(true);
  };

  const saveWorker = form.handleSubmit(async (values) => {
    try {
      if (editing) await api.put(`/workers/${editing.id}`, values);
      else await api.post('/workers', values);
      toast.success(editing ? 'Worker updated.' : 'Worker added.');
      setWorkerOpen(false);
      workers.refresh();
      day.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'The worker could not be saved.');
    }
  });

  const markAll = (status: string): void => {
    const next: Record<number, { status: string; overtimeHours: number }> = {};
    for (const row of day.data?.rows ?? []) {
      next[row.workerId] = { status, overtimeHours: draft[row.workerId]?.overtimeHours ?? 0 };
    }
    setDraft(next);
  };

  const saveAttendance = async (): Promise<void> => {
    setSaving(true);
    try {
      const entries = Object.entries(draft).map(([workerId, value]) => ({
        workerId: Number(workerId),
        status: value.status,
        overtimeHours: value.overtimeHours,
      }));
      const result = await api.post<{ saved: number }>('/attendance/day', {
        markedOn: date,
        projectId: projectId ? Number(projectId) : null,
        entries,
      });
      toast.success(`Attendance saved for ${result.saved} worker(s).`);
      day.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Attendance could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const workerColumns = useMemo<ColumnDef<Worker, unknown>[]>(
    () => [
      {
        id: 'name',
        header: 'Worker',
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium">{row.original.name}</p>
            <p className="text-xs text-muted-foreground">{row.original.mobile ?? 'No number'}</p>
          </div>
        ),
      },
      { id: 'skill', header: 'Skill', cell: ({ row }) => humanize(row.original.skill) },
      { id: 'contractor', header: 'Contractor', cell: ({ row }) => row.original.contractor ?? '—' },
      { id: 'dailyWage', header: 'Daily wage', cell: ({ row }) => <span className="tabular">{money(row.original.dailyWage)}</span> },
      { id: 'project', header: 'Site', cell: ({ row }) => row.original.project?.name ?? 'Unassigned' },
    ],
    [],
  );

  const totals = useMemo(() => {
    const values = Object.values(draft);
    return {
      present: values.filter((entry) => entry.status === 'PRESENT').length,
      halfDay: values.filter((entry) => entry.status === 'HALF_DAY').length,
      absent: values.filter((entry) => entry.status === 'ABSENT').length,
    };
  }, [draft]);

  const projectOptions = (projects.data ?? []).map((project) => ({ value: String(project.id), label: project.name }));

  return (
    <>
      <PageHeader
        title="Labour"
        description="Worker records, daily attendance, wages and productivity."
        actions={
          <>
            <SimpleSelect
              className="w-48"
              value={projectId}
              onChange={setProjectId}
              options={projectOptions}
              allowAll
              allLabel="All sites"
              placeholder="Site"
            />
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Add worker
            </Button>
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="attendance">
            <CalendarCheck className="h-4 w-4" />
            Daily attendance
          </TabsTrigger>
          <TabsTrigger value="sheet">Monthly sheet</TabsTrigger>
          <TabsTrigger value="consumption">Labour consumption</TabsTrigger>
          <TabsTrigger value="workers">
            <Users className="h-4 w-4" />
            Workers
          </TabsTrigger>
        </TabsList>

        <TabsContent value="attendance" className="space-y-4">
          <Card>
            <CardContent className="flex flex-wrap items-end justify-between gap-4 p-5">
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Date" className="w-44">
                  <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
                </Field>
                <div className="flex gap-2 pb-0.5">
                  <Button size="sm" variant="outline" onClick={() => markAll('PRESENT')}>
                    All present
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => markAll('ABSENT')}>
                    All absent
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right text-sm">
                  <p className="font-semibold">
                    {totals.present} present • {totals.halfDay} half • {totals.absent} absent
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {number(totals.present + totals.halfDay * 0.5, 1)} labour-days
                  </p>
                </div>
                <Button onClick={saveAttendance} loading={saving}>
                  <Save className="h-4 w-4" />
                  Save attendance
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              {day.loading && !day.data ? (
                <div className="space-y-2 p-5">
                  {[0, 1, 2, 3].map((index) => (
                    <Skeleton key={index} className="h-10" />
                  ))}
                </div>
              ) : (day.data?.rows ?? []).length === 0 ? (
                <p className="p-8 text-center text-sm text-muted-foreground">
                  No active workers for this site. Add workers first.
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {(day.data?.rows ?? []).map((row) => (
                    <div key={row.workerId} className="flex flex-wrap items-center gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{row.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {humanize(row.skill)}
                          {row.contractor ? ` • ${row.contractor}` : ''} • {money(row.dailyWage)}/day
                        </p>
                      </div>

                      <div className="flex items-center gap-1">
                        {ATTENDANCE_STATUSES.map((status) => {
                          const active = draft[row.workerId]?.status === status;
                          return (
                            <Button
                              key={status}
                              size="sm"
                              variant={active ? 'default' : 'outline'}
                              onClick={() =>
                                setDraft((current) => ({
                                  ...current,
                                  [row.workerId]: {
                                    status,
                                    overtimeHours: current[row.workerId]?.overtimeHours ?? 0,
                                  },
                                }))
                              }
                            >
                              {humanize(status)}
                            </Button>
                          );
                        })}
                      </div>

                      <div className="w-28">
                        <Input
                          type="number"
                          min={0}
                          max={16}
                          step={0.5}
                          value={draft[row.workerId]?.overtimeHours ?? 0}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              [row.workerId]: {
                                status: current[row.workerId]?.status ?? 'PRESENT',
                                overtimeHours: Number(event.target.value),
                              },
                            }))
                          }
                          className="h-9"
                          placeholder="OT hrs"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sheet" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <Field label="Month" className="w-48">
              <Input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
            </Field>
            <div className="flex items-center gap-3">
              <div className="text-right text-sm">
                <p className="font-semibold">{number(sheet.data?.totals.labourDays, 1)} labour-days</p>
                <p className="text-xs text-muted-foreground">
                  Payable {money(sheet.data?.totals.payable, { compact: true })}
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() =>
                  downloadFile('/reports/wages/export', {
                    from: `${month}-01`,
                    to: `${month}-31`,
                    projectId: projectId || '',
                  }).catch(() => toast.error('The export could not be generated.'))
                }
              >
                <Download className="h-4 w-4" />
                Export wages
              </Button>
            </div>
          </div>

          <Card>
            <CardContent className="overflow-x-auto p-0">
              {sheet.loading && !sheet.data ? (
                <div className="space-y-2 p-5">
                  {[0, 1, 2].map((index) => (
                    <Skeleton key={index} className="h-10" />
                  ))}
                </div>
              ) : (
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-muted/60">
                    <tr>
                      <th className="sticky left-0 z-10 bg-muted/60 px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Worker
                      </th>
                      {Array.from({ length: sheet.data?.daysInMonth ?? 30 }, (_, index) => index + 1).map((dayNumber) => (
                        <th key={dayNumber} className="w-7 px-0 py-2 text-center text-[0.65rem] font-semibold text-muted-foreground">
                          {dayNumber}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-muted-foreground">Days</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-muted-foreground">Payable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(sheet.data?.rows ?? []).map((row) => (
                      <tr key={row.workerId} className="border-t border-border">
                        <td className="sticky left-0 z-10 bg-card px-4 py-2">
                          <p className="truncate text-sm font-medium">{row.name}</p>
                          <p className="text-[0.7rem] text-muted-foreground">{humanize(row.skill)}</p>
                        </td>
                        {row.cells.map((cell, index) => (
                          <td key={index} className="px-0.5 py-1 text-center">
                            {cell ? (
                              <Tooltip label={`${humanize(cell.status)}${cell.overtimeHours ? ` • ${cell.overtimeHours}h OT` : ''}`}>
                                <span
                                  className={`mx-auto flex h-5 w-5 items-center justify-center rounded text-[0.6rem] font-bold ${
                                    CELL_STYLES[cell.status] ?? 'bg-muted'
                                  }`}
                                >
                                  {cell.status === 'PRESENT' ? 'P' : cell.status === 'HALF_DAY' ? 'H' : 'A'}
                                </span>
                              </Tooltip>
                            ) : (
                              <span className="mx-auto block h-5 w-5 rounded bg-muted/50" />
                            )}
                          </td>
                        ))}
                        <td className="tabular px-3 py-2 text-right font-semibold">{number(row.labourDays, 1)}</td>
                        <td className="tabular px-3 py-2 text-right">{money(row.payable)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {(sheet.data?.rows ?? []).length === 0 && !sheet.loading ? (
                <p className="p-8 text-center text-sm text-muted-foreground">No attendance recorded for this month.</p>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="consumption" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardContent className="space-y-1 p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Labour-days</p>
                <p className="tabular text-2xl font-bold">{number(consumption.data?.labourDays, 1)}</p>
                <p className="text-xs text-muted-foreground">{number(consumption.data?.workers)} worker(s)</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-1 p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Labour cost</p>
                <p className="tabular text-2xl font-bold">{money(consumption.data?.cost, { compact: true })}</p>
                <p className="text-xs text-muted-foreground">
                  {money(consumption.data?.avgCostPerLabourDay)} per labour-day
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-1 p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Work output</p>
                <p className="tabular text-2xl font-bold">{number(consumption.data?.progress, 1)}%</p>
                <p className="text-xs text-muted-foreground">Recorded construction progress</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-1 p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Productivity</p>
                <p className="tabular text-2xl font-bold">{number(consumption.data?.productivity, 3)}</p>
                <p className="text-xs text-muted-foreground">% progress per labour-day</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Labour-days per day" loading={consumption.loading}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={consumption.data?.byDay ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="date" {...axisProps} tickFormatter={(value: string) => value.slice(5)} />
                  <YAxis {...axisProps} width={40} />
                  <RTooltip {...chartTooltipStyle} />
                  <Bar dataKey="labourDays" name="Labour-days" fill="#BC1F43" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="By skill" loading={consumption.loading}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={consumption.data?.bySkill ?? []} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" {...axisProps} />
                  <YAxis type="category" dataKey="skill" {...axisProps} width={90} tickFormatter={humanize} />
                  <RTooltip {...chartTooltipStyle} />
                  <Bar dataKey="labourDays" name="Labour-days" fill="#EE3A43" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </TabsContent>

        <TabsContent value="workers" className="space-y-4">
          <FilterBar
            search={list.search}
            onSearchChange={list.setSearch}
            placeholder="Search workers…"
            onReset={list.reset}
          >
            <SimpleSelect
              className="w-44"
              value={list.filters.skill ?? ''}
              onChange={(value) => list.setFilter('skill', value)}
              options={WORKER_SKILLS.map((skill) => ({ value: skill, label: humanize(skill) }))}
              allowAll
              allLabel="All skills"
              placeholder="Skill"
            />
          </FilterBar>
          <DataTable
            columns={workerColumns}
            data={workers.data?.rows ?? []}
            loading={workers.loading}
            page={workers.data?.page}
            pageCount={workers.data?.pageCount}
            total={workers.data?.total}
            onPageChange={list.setPage}
            sortBy={list.sortBy}
            sortDir={list.sortDir}
            onSortChange={list.toggleSort}
            sortableColumns={['name', 'skill', 'dailyWage']}
            onRowClick={openEdit}
            emptyTitle="No workers yet"
            emptyDescription="Add the site team to start marking attendance."
            emptyAction={
              <Button onClick={openCreate}>
                <HardHat className="h-4 w-4" />
                Add worker
              </Button>
            }
          />
        </TabsContent>
      </Tabs>

      <FormDialog
        open={workerOpen}
        onOpenChange={setWorkerOpen}
        title={editing ? 'Edit worker' : 'Add worker'}
        onSubmit={saveWorker}
        submitting={form.formState.isSubmitting}
        submitLabel={editing ? 'Save changes' : 'Add worker'}
        size="sm"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required className="sm:col-span-2" error={form.formState.errors.name?.message}>
            <Input {...form.register('name')} />
          </Field>
          <Field label="Mobile" error={form.formState.errors.mobile?.message}>
            <Input {...form.register('mobile')} />
          </Field>
          <Field label="Daily wage" error={form.formState.errors.dailyWage?.message}>
            <Input type="number" min={0} step={10} {...form.register('dailyWage')} />
          </Field>
          <Field label="Skill">
            <SimpleSelect
              value={form.watch('skill') ?? 'HELPER'}
              onChange={(value) => form.setValue('skill', value as WorkerInput['skill'])}
              options={WORKER_SKILLS.map((skill) => ({ value: skill, label: humanize(skill) }))}
            />
          </Field>
          <Field label="Contractor">
            <Input {...form.register('contractor')} />
          </Field>
          <Field label="Site" className="sm:col-span-2">
            <SimpleSelect
              value={form.watch('projectId') ? String(form.watch('projectId')) : ''}
              onChange={(value) => form.setValue('projectId', value ? Number(value) : null)}
              options={projectOptions}
              allowAll
              allLabel="Unassigned"
              placeholder="Site"
            />
          </Field>
        </div>
      </FormDialog>
    </>
  );
}
