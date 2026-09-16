import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { Building2, CalendarRange, HardHat, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/app/PageHeader';
import { FilterBar } from '@/components/app/FilterBar';
import { FormDialog } from '@/components/app/FormDialog';
import { ConfirmDialog } from '@/components/app/ConfirmDialog';
import { StatusBadge } from '@/components/app/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { Progress, Skeleton } from '@/components/ui/misc';
import { useListState } from '@/hooks/useListState';
import { useResource } from '@/hooks/useResource';
import { ApiError, api } from '@/lib/api';
import { dateInput, formatDate, money, percent, today } from '@/lib/format';
import { PROJECT_STATUSES, humanize } from '@shared/constants';
import { projectSchema, type ProjectInput } from '@shared/schemas';
import type { Paginated } from '@shared/types';

interface Project {
  id: number;
  name: string;
  code: string;
  location: string;
  startDate: string;
  expectedEndDate: string;
  budget: number;
  contractor: string | null;
  engineer: string | null;
  status: string;
  description: string | null;
  stages: { id: number; name: string; weight: number; progress: number }[];
  _count: { properties: number; dprs: number; milestones: number };
}

const emptyProject: ProjectInput = {
  name: '',
  code: '',
  location: '',
  startDate: today(),
  expectedEndDate: today(),
  budget: 0,
  contractor: '',
  engineer: '',
  status: 'ACTIVE',
  description: '',
};

function projectProgress(project: Project): number {
  const totalWeight = project.stages.reduce((acc, stage) => acc + (stage.weight > 0 ? stage.weight : 1), 0);
  if (totalWeight === 0) return 0;
  return project.stages.reduce((acc, stage) => acc + stage.progress * (stage.weight > 0 ? stage.weight : 1), 0) / totalWeight;
}

export function ProjectsPage(): JSX.Element {
  const navigate = useNavigate();
  const list = useListState({ sortBy: 'startDate', sortDir: 'desc', pageSize: 24 });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);

  const projects = useResource<Paginated<Project>>(
    (signal) => api.list<Project>('/projects', list.query, signal),
    [JSON.stringify(list.query)],
  );

  const form = useForm<ProjectInput>({ resolver: zodResolver(projectSchema), defaultValues: emptyProject });

  const openCreate = (): void => {
    setEditing(null);
    form.reset(emptyProject);
    setFormOpen(true);
  };

  const openEdit = (project: Project): void => {
    setEditing(project);
    form.reset({
      name: project.name,
      code: project.code,
      location: project.location,
      startDate: dateInput(project.startDate),
      expectedEndDate: dateInput(project.expectedEndDate),
      budget: project.budget,
      contractor: project.contractor ?? '',
      engineer: project.engineer ?? '',
      status: project.status as ProjectInput['status'],
      description: project.description ?? '',
    });
    setFormOpen(true);
  };

  const save = form.handleSubmit(async (values) => {
    try {
      if (editing) await api.put(`/projects/${editing.id}`, values);
      else await api.post('/projects', values);
      toast.success(editing ? 'Project updated.' : 'Project created with the standard construction stages.');
      setFormOpen(false);
      projects.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'The project could not be saved.');
    }
  });

  const rows = projects.data?.rows ?? [];

  return (
    <>
      <PageHeader
        title="Projects"
        description="Sites, stages and milestones."
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            New project
          </Button>
        }
      />

      <FilterBar
        search={list.search}
        onSearchChange={list.setSearch}
        placeholder="Search by name, code, contractor…"
        onReset={list.reset}
      >
        <SimpleSelect
          className="w-44"
          value={list.filters.status ?? ''}
          onChange={(value) => list.setFilter('status', value)}
          options={PROJECT_STATUSES.map((status) => ({ value: status, label: humanize(status) }))}
          allowAll
          allLabel="All statuses"
          placeholder="Status"
        />
      </FilterBar>

      {projects.loading && rows.length === 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-56" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Building2 className="h-5 w-5" />}
            title="No projects yet"
            description="Create a site to start tracking progress, labour and materials against it."
            action={
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" />
                New project
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((project, index) => {
            const progress = projectProgress(project);
            return (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: index * 0.04 }}
              >
                <Card className="group h-full transition-shadow hover:shadow-lift">
                  <CardContent className="space-y-4 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => navigate(`/projects/${project.id}`)}
                        className="min-w-0 text-left"
                      >
                        <p className="truncate font-semibold group-hover:text-primary">{project.name}</p>
                        <p className="flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3" />
                          {project.location}
                        </p>
                      </button>
                      <StatusBadge status={project.status} />
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Progress</span>
                        <span className="tabular font-semibold">{percent(progress, 1)}</span>
                      </div>
                      <Progress value={progress} />
                    </div>

                    <dl className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <dt className="text-muted-foreground">Budget</dt>
                        <dd className="tabular font-semibold">{money(project.budget, { compact: true })}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Units</dt>
                        <dd className="font-semibold">{project._count.properties}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Contractor</dt>
                        <dd className="truncate font-semibold">{project.contractor ?? '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Engineer</dt>
                        <dd className="truncate font-semibold">{project.engineer ?? '—'}</dd>
                      </div>
                    </dl>

                    <p className="flex items-center gap-1.5 border-t border-border pt-3 text-xs text-muted-foreground">
                      <CalendarRange className="h-3.5 w-3.5" />
                      {formatDate(project.startDate, 'DD MMM YY')} → {formatDate(project.expectedEndDate, 'DD MMM YY')}
                    </p>

                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => navigate(`/projects/${project.id}`)}>
                        <HardHat className="h-4 w-4" />
                        Open site
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => openEdit(project)} aria-label="Edit project">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => setDeleting(project)}
                        aria-label="Delete project"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      <FormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editing ? 'Edit project' : 'New project'}
        description={editing ? undefined : 'The seven standard construction stages are added automatically.'}
        onSubmit={save}
        submitting={form.formState.isSubmitting}
        submitLabel={editing ? 'Save changes' : 'Create project'}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Project name" required error={form.formState.errors.name?.message}>
            <Input {...form.register('name')} placeholder="Aasma Greens — Site A" />
          </Field>
          <Field label="Code" required error={form.formState.errors.code?.message}>
            <Input {...form.register('code')} placeholder="AG-A" />
          </Field>
          <Field label="Location" required className="sm:col-span-2" error={form.formState.errors.location?.message}>
            <Input {...form.register('location')} />
          </Field>
          <Field label="Start date" required error={form.formState.errors.startDate?.message}>
            <Input type="date" {...form.register('startDate')} />
          </Field>
          <Field label="Expected end" required error={form.formState.errors.expectedEndDate?.message}>
            <Input type="date" {...form.register('expectedEndDate')} />
          </Field>
          <Field label="Budget" error={form.formState.errors.budget?.message}>
            <Input type="number" min={0} step={100000} {...form.register('budget')} />
          </Field>
          <Field label="Status">
            <SimpleSelect
              value={form.watch('status') ?? 'ACTIVE'}
              onChange={(value) => form.setValue('status', value as ProjectInput['status'])}
              options={PROJECT_STATUSES.map((status) => ({ value: status, label: humanize(status) }))}
            />
          </Field>
          <Field label="Contractor">
            <Input {...form.register('contractor')} />
          </Field>
          <Field label="Engineer">
            <Input {...form.register('engineer')} />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <Textarea rows={3} {...form.register('description')} />
          </Field>
        </div>
      </FormDialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this project?"
        description={
          <>
            Units, stages, milestones, attendance and daily reports linked to{' '}
            <strong className="text-foreground">{deleting?.name}</strong> will be deleted. This cannot be undone.
          </>
        }
        confirmLabel="Delete project"
        destructive
        successMessage="Project deleted."
        onConfirm={async () => {
          if (deleting) await api.delete(`/projects/${deleting.id}`);
          projects.refresh();
        }}
      />
    </>
  );
}
