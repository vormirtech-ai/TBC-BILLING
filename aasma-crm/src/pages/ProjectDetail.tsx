import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { ArrowLeft, Flag, Plus, TrendingUp } from 'lucide-react';
import { PageHeader } from '@/components/app/PageHeader';
import { FormDialog } from '@/components/app/FormDialog';
import { StatusBadge, RiskBadge } from '@/components/app/StatusBadge';
import { ChartCard, axisProps, chartTooltipStyle } from '@/components/app/ChartCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { Progress, Skeleton } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useResource } from '@/hooks/useResource';
import { ApiError, api } from '@/lib/api';
import { formatDate, money, number, percent, today } from '@/lib/format';
import { MILESTONE_STATUSES, humanize } from '@shared/constants';
import { milestoneSchema, stageProgressSchema, type MilestoneInput } from '@shared/schemas';
import type { ProjectForecast } from '@shared/types';

interface Overview {
  project: {
    id: number;
    name: string;
    code: string;
    location: string;
    status: string;
    startDate: string;
    expectedEndDate: string;
    budget: number;
    contractor: string | null;
    engineer: string | null;
    description: string | null;
    stages: { id: number; name: string; weight: number; progress: number }[];
    milestones: { id: number; title: string; dueDate: string; status: string; notes: string | null }[];
  };
  progress: number;
  properties: Record<string, number>;
  materialValue: number;
  attendanceEntries: number;
  dprCount: number;
}

type ProgressForm = { progress: number; recordedOn: string; note: string };

export function ProjectDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const projectId = Number(id);

  const overview = useResource<Overview>((signal) => api.get(`/projects/${projectId}/overview`, undefined, signal), [projectId]);
  const forecast = useResource<ProjectForecast>((signal) => api.get(`/forecast/${projectId}`, undefined, signal), [projectId]);

  const [stageDialog, setStageDialog] = useState<{ id: number; name: string; progress: number } | null>(null);
  const [milestoneOpen, setMilestoneOpen] = useState(false);

  const progressForm = useForm<ProgressForm>({
    resolver: zodResolver(stageProgressSchema),
    defaultValues: { progress: 0, recordedOn: today(), note: '' },
  });

  const milestoneForm = useForm<MilestoneInput>({
    resolver: zodResolver(milestoneSchema),
    defaultValues: { projectId, title: '', dueDate: today(), status: 'PENDING', notes: '' },
  });

  const openStage = (stage: { id: number; name: string; progress: number }): void => {
    setStageDialog(stage);
    progressForm.reset({ progress: stage.progress, recordedOn: today(), note: '' });
  };

  const saveProgress = progressForm.handleSubmit(async (values) => {
    if (!stageDialog) return;
    try {
      await api.post(`/projects/stages/${stageDialog.id}/progress`, values);
      toast.success(`${stageDialog.name} updated to ${values.progress}%.`);
      setStageDialog(null);
      overview.refresh();
      forecast.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Progress could not be saved.');
    }
  });

  const saveMilestone = milestoneForm.handleSubmit(async (values) => {
    try {
      await api.post('/milestones', { ...values, projectId });
      toast.success('Milestone added.');
      setMilestoneOpen(false);
      milestoneForm.reset({ projectId, title: '', dueDate: today(), status: 'PENDING', notes: '' });
      overview.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'The milestone could not be saved.');
    }
  });

  if (overview.loading && !overview.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-32" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  if (overview.error || !overview.data) {
    return (
      <Card>
        <CardContent className="space-y-3 p-8 text-center">
          <p className="text-sm text-muted-foreground">{overview.error ?? 'This project could not be found.'}</p>
          <Button variant="outline" onClick={() => navigate('/projects')}>
            Back to projects
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { project, progress, properties, materialValue, dprCount } = overview.data;

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => navigate('/projects')} className="-ml-2 text-muted-foreground">
        <ArrowLeft className="h-4 w-4" />
        All projects
      </Button>

      <PageHeader
        title={project.name}
        description={`${project.code} • ${project.location}`}
        actions={
          <>
            <StatusBadge status={project.status} />
            {forecast.data ? <RiskBadge risk={forecast.data.riskLevel} /> : null}
            <Button variant="outline" onClick={() => navigate('/forecasting')}>
              <TrendingUp className="h-4 w-4" />
              Forecast detail
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="space-y-2 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Overall progress</p>
            <p className="tabular text-2xl font-bold">{percent(progress, 1)}</p>
            <Progress value={progress} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Budget</p>
            <p className="tabular text-2xl font-bold">{money(project.budget, { compact: true })}</p>
            <p className="text-xs text-muted-foreground">
              Material issued {money(materialValue, { compact: true })}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Units</p>
            <p className="tabular text-2xl font-bold">
              {number((properties.AVAILABLE ?? 0) + (properties.RESERVED ?? 0) + (properties.SOLD ?? 0))}
            </p>
            <p className="text-xs text-muted-foreground">
              {number(properties.SOLD ?? 0)} sold • {number(properties.AVAILABLE ?? 0)} available
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Forecast completion</p>
            <p className="text-2xl font-bold">
              {forecast.data?.estimatedCompletion ? formatDate(forecast.data.estimatedCompletion, 'DD MMM YY') : '—'}
            </p>
            <p className="text-xs text-muted-foreground">
              Planned {formatDate(project.expectedEndDate, 'DD MMM YY')}
              {forecast.data && forecast.data.delayDays > 0 ? ` • ${forecast.data.delayDays} day(s) late` : ''}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="stages">
        <TabsList>
          <TabsTrigger value="stages">Stages</TabsTrigger>
          <TabsTrigger value="milestones">Milestones</TabsTrigger>
          <TabsTrigger value="progress">Progress history</TabsTrigger>
        </TabsList>

        <TabsContent value="stages">
          <Card>
            <CardHeader>
              <CardTitle>Construction stages</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {project.stages.map((stage) => (
                <div key={stage.id} className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{stage.name}</p>
                      <p className="text-xs text-muted-foreground">Weight {stage.weight}%</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="tabular w-14 text-right text-sm font-semibold">{percent(stage.progress, 0)}</span>
                      <Button size="sm" variant="outline" onClick={() => openStage(stage)}>
                        Update
                      </Button>
                    </div>
                  </div>
                  <Progress value={stage.progress} />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="milestones">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Milestones</CardTitle>
              <Button size="sm" onClick={() => setMilestoneOpen(true)}>
                <Plus className="h-4 w-4" />
                Add milestone
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {project.milestones.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No milestones set for this project.</p>
              ) : (
                project.milestones.map((milestone) => (
                  <div
                    key={milestone.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border px-4 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Flag className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{milestone.title}</p>
                        <p className="text-xs text-muted-foreground">Due {formatDate(milestone.dueDate)}</p>
                      </div>
                    </div>
                    <StatusBadge status={milestone.status} />
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="progress">
          <ChartCard
            title="Recorded progress"
            description={`${dprCount} daily report(s) filed for this site`}
            loading={forecast.loading}
            height={300}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={forecast.data?.history ?? []} margin={{ top: 8, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="date" {...axisProps} />
                <YAxis {...axisProps} domain={[0, 100]} width={44} tickFormatter={(value) => `${value}%`} />
                <RTooltip {...chartTooltipStyle} formatter={(value: number) => [`${value}%`, 'Progress']} />
                <Line type="monotone" dataKey="progress" stroke="#BC1F43" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </TabsContent>
      </Tabs>

      <FormDialog
        open={Boolean(stageDialog)}
        onOpenChange={(open) => !open && setStageDialog(null)}
        title={`Update ${stageDialog?.name ?? 'stage'}`}
        description="Recording progress also feeds the completion forecast."
        onSubmit={saveProgress}
        submitting={progressForm.formState.isSubmitting}
        submitLabel="Save progress"
        size="sm"
      >
        <div className="space-y-4">
          <Field label="Progress %" required error={progressForm.formState.errors.progress?.message}>
            <Input type="number" min={0} max={100} step={1} {...progressForm.register('progress')} />
          </Field>
          <Field label="Recorded on">
            <Input type="date" {...progressForm.register('recordedOn')} />
          </Field>
          <Field label="Note">
            <Textarea rows={3} {...progressForm.register('note')} placeholder="What was completed?" />
          </Field>
        </div>
      </FormDialog>

      <FormDialog
        open={milestoneOpen}
        onOpenChange={setMilestoneOpen}
        title="Add milestone"
        onSubmit={saveMilestone}
        submitting={milestoneForm.formState.isSubmitting}
        submitLabel="Add milestone"
        size="sm"
      >
        <div className="space-y-4">
          <Field label="Title" required error={milestoneForm.formState.errors.title?.message}>
            <Input {...milestoneForm.register('title')} placeholder="Slab casting complete" />
          </Field>
          <Field label="Due date" required error={milestoneForm.formState.errors.dueDate?.message}>
            <Input type="date" {...milestoneForm.register('dueDate')} />
          </Field>
          <Field label="Status">
            <SimpleSelect
              value={milestoneForm.watch('status') ?? 'PENDING'}
              onChange={(value) => milestoneForm.setValue('status', value as MilestoneInput['status'])}
              options={MILESTONE_STATUSES.map((status) => ({ value: status, label: humanize(status) }))}
            />
          </Field>
          <Field label="Notes">
            <Textarea rows={2} {...milestoneForm.register('notes')} />
          </Field>
        </div>
      </FormDialog>
    </>
  );
}
