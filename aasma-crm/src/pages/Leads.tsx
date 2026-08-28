import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import {
  CalendarClock,
  LayoutGrid,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  Table as TableIcon,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { PageHeader } from '@/components/app/PageHeader';
import { FilterBar } from '@/components/app/FilterBar';
import { DataTable } from '@/components/app/DataTable';
import { FormDialog } from '@/components/app/FormDialog';
import { ConfirmDialog } from '@/components/app/ConfirmDialog';
import { StatusBadge } from '@/components/app/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useListState } from '@/hooks/useListState';
import { useResource } from '@/hooks/useResource';
import { ApiError, api } from '@/lib/api';
import { dateInput, formatDate, money } from '@/lib/format';
import { LEAD_SOURCES, LEAD_STATUSES, humanize } from '@shared/constants';
import { leadSchema, type LeadInput } from '@shared/schemas';
import type { Paginated } from '@shared/types';

interface Lead {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  source: string;
  budget: number;
  status: string;
  followUpDate: string | null;
  assignedTo: string | null;
  notes: string | null;
  projectId: number | null;
  interestedPropertyId: number | null;
  interestedProperty?: { id: number; tower: string; unit: string } | null;
  project?: { id: number; name: string } | null;
  createdAt: string;
}

const emptyLead: LeadInput = {
  name: '',
  phone: '',
  email: '',
  source: 'WALK_IN',
  budget: 0,
  status: 'NEW',
  assignedTo: '',
  notes: '',
  followUpDate: null,
  projectId: null,
  interestedPropertyId: null,
};

export function LeadsPage(): JSX.Element {
  const list = useListState({ sortBy: 'createdAt', sortDir: 'desc' });
  const [view, setView] = useState<'table' | 'pipeline'>('table');
  const [editing, setEditing] = useState<Lead | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<Lead | null>(null);

  const leads = useResource<Paginated<Lead>>(
    (signal) => api.list<Lead>('/leads', list.query, signal),
    [JSON.stringify(list.query)],
  );

  const projects = useResource<{ id: number; name: string }[]>((signal) =>
    api.get('/projects/options', undefined, signal),
  );

  const form = useForm<LeadInput>({ resolver: zodResolver(leadSchema), defaultValues: emptyLead });

  const openCreate = (): void => {
    setEditing(null);
    form.reset(emptyLead);
    setFormOpen(true);
  };

  const openEdit = (lead: Lead): void => {
    setEditing(lead);
    form.reset({
      name: lead.name,
      phone: lead.phone,
      email: lead.email ?? '',
      source: lead.source as LeadInput['source'],
      budget: lead.budget,
      status: lead.status as LeadInput['status'],
      assignedTo: lead.assignedTo ?? '',
      notes: lead.notes ?? '',
      followUpDate: lead.followUpDate ? dateInput(lead.followUpDate) : null,
      projectId: lead.projectId ?? null,
      interestedPropertyId: lead.interestedPropertyId ?? null,
    });
    setFormOpen(true);
  };

  const save = form.handleSubmit(async (values) => {
    try {
      const payload = { ...values, followUpDate: values.followUpDate || null };
      if (editing) await api.put(`/leads/${editing.id}`, payload);
      else await api.post('/leads', payload);
      toast.success(editing ? 'Lead updated.' : 'Lead added.');
      setFormOpen(false);
      leads.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'The lead could not be saved.');
    }
  });

  const changeStatus = async (lead: Lead, status: string): Promise<void> => {
    try {
      await api.patch(`/leads/${lead.id}/status`, { status });
      toast.success(`${lead.name} moved to ${humanize(status)}.`);
      leads.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'The status could not be changed.');
    }
  };

  const convert = async (lead: Lead): Promise<void> => {
    try {
      await api.post(`/leads/${lead.id}/convert`, { createBooking: false });
      toast.success(`${lead.name} is now a client.`);
      leads.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'The lead could not be converted.');
    }
  };

  const columns = useMemo<ColumnDef<Lead, unknown>[]>(
    () => [
      {
        id: 'name',
        header: 'Lead',
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium">{row.original.name}</p>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Phone className="h-3 w-3" />
              {row.original.phone}
            </p>
          </div>
        ),
      },
      { id: 'source', header: 'Source', cell: ({ row }) => humanize(row.original.source) },
      {
        id: 'budget',
        header: 'Budget',
        cell: ({ row }) => <span className="tabular">{money(row.original.budget, { compact: true })}</span>,
      },
      {
        id: 'interested',
        header: 'Interested in',
        cell: ({ row }) =>
          row.original.interestedProperty
            ? `${row.original.interestedProperty.tower}-${row.original.interestedProperty.unit}`
            : row.original.project?.name ?? '—',
      },
      {
        id: 'followUpDate',
        header: 'Follow-up',
        cell: ({ row }) => {
          const value = row.original.followUpDate;
          if (!value) return <span className="text-muted-foreground">—</span>;
          const overdue = new Date(value) < new Date(new Date().toDateString());
          return (
            <span className={overdue ? 'font-medium text-destructive' : ''}>{formatDate(value, 'DD MMM YYYY')}</span>
          );
        },
      },
      { id: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" onClick={(event) => event.stopPropagation()}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => openEdit(row.original)}>
                <Pencil className="h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => convert(row.original)}>
                <UserPlus className="h-4 w-4" />
                Convert to client
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {LEAD_STATUSES.filter((status) => status !== row.original.status).map((status) => (
                <DropdownMenuItem key={status} onClick={() => changeStatus(row.original, status)}>
                  Move to {humanize(status)}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onClick={() => setDeleting(row.original)}>
                <Trash2 className="h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const pipeline = useMemo(() => {
    const rows = leads.data?.rows ?? [];
    return LEAD_STATUSES.map((status) => ({
      status,
      leads: rows.filter((lead) => lead.status === status),
    }));
  }, [leads.data]);

  return (
    <>
      <PageHeader
        title="Leads"
        description="Every enquiry, from first call to booking."
        actions={
          <>
            <Tabs value={view} onValueChange={(value) => setView(value as 'table' | 'pipeline')}>
              <TabsList>
                <TabsTrigger value="table">
                  <TableIcon className="h-4 w-4" />
                  Table
                </TabsTrigger>
                <TabsTrigger value="pipeline">
                  <LayoutGrid className="h-4 w-4" />
                  Pipeline
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Add lead
            </Button>
          </>
        }
      />

      <FilterBar
        search={list.search}
        onSearchChange={list.setSearch}
        placeholder="Search by name, phone or email…"
        onReset={list.reset}
      >
        <SimpleSelect
          className="w-40"
          value={list.filters.status ?? ''}
          onChange={(value) => list.setFilter('status', value)}
          options={LEAD_STATUSES.map((status) => ({ value: status, label: humanize(status) }))}
          allowAll
          allLabel="All statuses"
          placeholder="Status"
        />
        <SimpleSelect
          className="w-40"
          value={list.filters.source ?? ''}
          onChange={(value) => list.setFilter('source', value)}
          options={LEAD_SOURCES.map((source) => ({ value: source, label: humanize(source) }))}
          allowAll
          allLabel="All sources"
          placeholder="Source"
        />
      </FilterBar>

      {view === 'table' ? (
        <DataTable
          columns={columns}
          data={leads.data?.rows ?? []}
          loading={leads.loading}
          page={leads.data?.page}
          pageCount={leads.data?.pageCount}
          total={leads.data?.total}
          onPageChange={list.setPage}
          sortBy={list.sortBy}
          sortDir={list.sortDir}
          onSortChange={list.toggleSort}
          sortableColumns={['name', 'budget', 'followUpDate', 'status']}
          onRowClick={openEdit}
          emptyTitle="No leads yet"
          emptyDescription="Add your first enquiry to start building the pipeline."
          emptyAction={
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Add lead
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {pipeline.map((column) => (
            <Card key={column.status} className="flex flex-col">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <StatusBadge status={column.status} />
                <span className="text-xs font-semibold text-muted-foreground">{column.leads.length}</span>
              </div>
              <CardContent className="flex-1 space-y-2 p-3">
                {column.leads.length === 0 ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">Nothing here</p>
                ) : (
                  column.leads.map((lead) => (
                    <button
                      key={lead.id}
                      type="button"
                      onClick={() => openEdit(lead)}
                      className="w-full rounded-md border border-border bg-background p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted"
                    >
                      <p className="truncate text-sm font-medium">{lead.name}</p>
                      <p className="text-xs text-muted-foreground">{lead.phone}</p>
                      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                        <span className="tabular font-semibold text-primary">
                          {money(lead.budget, { compact: true })}
                        </span>
                        {lead.followUpDate ? (
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <CalendarClock className="h-3 w-3" />
                            {formatDate(lead.followUpDate, 'DD MMM')}
                          </span>
                        ) : null}
                      </div>
                    </button>
                  ))
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <FormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editing ? 'Edit lead' : 'Add lead'}
        description="Capture the enquiry and set the next follow-up."
        onSubmit={save}
        submitting={form.formState.isSubmitting}
        submitLabel={editing ? 'Save changes' : 'Add lead'}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required error={form.formState.errors.name?.message}>
            <Input {...form.register('name')} placeholder="Full name" />
          </Field>
          <Field label="Phone" required error={form.formState.errors.phone?.message}>
            <Input {...form.register('phone')} placeholder="98765 43210" />
          </Field>
          <Field label="Email" error={form.formState.errors.email?.message}>
            <Input type="email" {...form.register('email')} placeholder="name@example.com" />
          </Field>
          <Field label="Budget" error={form.formState.errors.budget?.message}>
            <Input type="number" min={0} step={10000} {...form.register('budget')} />
          </Field>
          <Field label="Source">
            <SimpleSelect
              value={form.watch('source') ?? 'WALK_IN'}
              onChange={(value) => form.setValue('source', value as LeadInput['source'])}
              options={LEAD_SOURCES.map((source) => ({ value: source, label: humanize(source) }))}
            />
          </Field>
          <Field label="Status">
            <SimpleSelect
              value={form.watch('status') ?? 'NEW'}
              onChange={(value) => form.setValue('status', value as LeadInput['status'])}
              options={LEAD_STATUSES.map((status) => ({ value: status, label: humanize(status) }))}
            />
          </Field>
          <Field label="Project of interest">
            <SimpleSelect
              value={form.watch('projectId') ? String(form.watch('projectId')) : ''}
              onChange={(value) => form.setValue('projectId', value ? Number(value) : null)}
              options={(projects.data ?? []).map((project) => ({ value: String(project.id), label: project.name }))}
              allowAll
              allLabel="Not decided"
              placeholder="Select project"
            />
          </Field>
          <Field label="Next follow-up" error={form.formState.errors.followUpDate?.message}>
            <Input
              type="date"
              value={dateInput(form.watch('followUpDate'))}
              onChange={(event) => form.setValue('followUpDate', event.target.value || null)}
            />
          </Field>
          <Field label="Assigned to" className="sm:col-span-2">
            <Input {...form.register('assignedTo')} placeholder="Sales executive" />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea rows={3} {...form.register('notes')} placeholder="Requirements, preferences, objections…" />
          </Field>
        </div>
      </FormDialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this lead?"
        description={
          <>
            <strong className="text-foreground">{deleting?.name}</strong> and the activity recorded against them will be
            removed. This cannot be undone.
          </>
        }
        confirmLabel="Delete lead"
        destructive
        successMessage="Lead deleted."
        onConfirm={async () => {
          if (deleting) await api.delete(`/leads/${deleting.id}`);
          leads.refresh();
        }}
      />
    </>
  );
}
