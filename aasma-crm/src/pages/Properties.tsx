import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { Building, Grid3x3, MoreHorizontal, Pencil, Plus, Table as TableIcon, Trash2, Upload } from 'lucide-react';
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
import { Tooltip } from '@/components/ui/misc';
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
import { money, number } from '@/lib/format';
import { PROPERTY_FACINGS, PROPERTY_STATUSES, UNIT_TYPES, humanize } from '@shared/constants';
import { propertySchema, type PropertyInput } from '@shared/schemas';
import type { Paginated } from '@shared/types';

interface Property {
  id: number;
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
  project?: { id: number; name: string } | null;
  bookings: { id: number; client?: { id: number; name: string } | null }[];
}

interface MapTower {
  tower: string;
  floors: {
    floor: number;
    units: {
      id: number;
      unit: string;
      unitType: string;
      sizeSqft: number;
      price: number;
      facing: string;
      status: string;
      client: string | null;
    }[];
  }[];
}

const STATUS_STYLES: Record<string, string> = {
  AVAILABLE: 'border-success/40 bg-success/10 text-success hover:bg-success/20',
  RESERVED: 'border-warning/40 bg-warning/10 text-warning hover:bg-warning/20',
  SOLD: 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20',
};

export function PropertiesPage(): JSX.Element {
  const list = useListState({ sortBy: 'tower', sortDir: 'asc', pageSize: 50 });
  const [view, setView] = useState<'table' | 'map'>('table');
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importProject, setImportProject] = useState('');
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<Property | null>(null);
  const [deleting, setDeleting] = useState<Property | null>(null);

  const projects = useResource<{ id: number; name: string }[]>((signal) =>
    api.get('/projects/options', undefined, signal),
  );

  const properties = useResource<Paginated<Property>>(
    (signal) => api.list<Property>('/properties', list.query, signal),
    [JSON.stringify(list.query)],
  );

  const summary = useResource<{ byStatus: { status: string; count: number; value: number }[]; total: number; totalValue: number }>(
    (signal) => api.get('/properties/summary', { projectId: list.filters.projectId || '' }, signal),
    [list.filters.projectId, properties.data?.total],
  );

  const map = useResource<MapTower[]>(
    (signal) => api.get('/properties/map', { projectId: list.filters.projectId || '' }, signal),
    [list.filters.projectId, view],
    { enabled: view === 'map' },
  );

  const form = useForm<PropertyInput>({
    resolver: zodResolver(propertySchema),
    defaultValues: {
      projectId: 0,
      tower: '',
      floor: 1,
      unit: '',
      unitType: '2BHK',
      sizeSqft: 0,
      price: 0,
      facing: 'EAST',
      status: 'AVAILABLE',
      notes: '',
    },
  });

  const openCreate = (): void => {
    setEditing(null);
    form.reset({
      projectId: Number(list.filters.projectId) || projects.data?.[0]?.id || 0,
      tower: '',
      floor: 1,
      unit: '',
      unitType: '2BHK',
      sizeSqft: 0,
      price: 0,
      facing: 'EAST',
      status: 'AVAILABLE',
      notes: '',
    });
    setFormOpen(true);
  };

  const openEdit = (property: Property): void => {
    setEditing(property);
    form.reset({
      projectId: property.projectId,
      tower: property.tower,
      floor: property.floor,
      unit: property.unit,
      unitType: property.unitType as PropertyInput['unitType'],
      sizeSqft: property.sizeSqft,
      price: property.price,
      facing: property.facing as PropertyInput['facing'],
      status: property.status as PropertyInput['status'],
      notes: property.notes ?? '',
    });
    setFormOpen(true);
  };

  const save = form.handleSubmit(async (values) => {
    try {
      if (editing) await api.put(`/properties/${editing.id}`, values);
      else await api.post('/properties', values);
      toast.success(editing ? 'Unit updated.' : 'Unit added.');
      setFormOpen(false);
      properties.refresh();
      summary.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'The unit could not be saved.');
    }
  });

  /**
   * Bulk import accepts rows pasted straight out of a spreadsheet:
   * Tower, Floor, Unit, Type, Size, Price, Facing, Status
   */
  const runImport = async (): Promise<void> => {
    const projectId = Number(importProject);
    if (!projectId) {
      toast.error('Choose the project these units belong to.');
      return;
    }

    const rows = importText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(/[\t,]/).map((cell) => cell.trim()))
      .filter((cells) => cells.length >= 3 && !/^tower$/i.test(cells[0]))
      .map((cells) => ({
        projectId,
        tower: cells[0],
        floor: Number(cells[1] ?? 0),
        unit: cells[2],
        unitType: (cells[3] || '2BHK').toUpperCase(),
        sizeSqft: Number(cells[4] ?? 0),
        price: Number(cells[5] ?? 0),
        facing: (cells[6] || 'EAST').toUpperCase().replace(/[\s-]/g, '_'),
        status: (cells[7] || 'AVAILABLE').toUpperCase(),
      }));

    if (rows.length === 0) {
      toast.error('No rows could be read. Check the format and try again.');
      return;
    }

    setImporting(true);
    try {
      const result = await api.post<{ created: number; updated: number }>('/properties/import', { rows });
      toast.success(`${result.created} unit(s) created, ${result.updated} updated.`);
      setImportOpen(false);
      setImportText('');
      properties.refresh();
      summary.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'The import could not be completed.');
    } finally {
      setImporting(false);
    }
  };

  const columns = useMemo<ColumnDef<Property, unknown>[]>(
    () => [
      {
        id: 'unit',
        header: 'Unit',
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="font-medium">
              {row.original.tower}-{row.original.unit}
            </p>
            <p className="text-xs text-muted-foreground">
              Floor {row.original.floor} • {row.original.project?.name ?? ''}
            </p>
          </div>
        ),
      },
      { id: 'unitType', header: 'Type', cell: ({ row }) => row.original.unitType },
      {
        id: 'sizeSqft',
        header: 'Size',
        cell: ({ row }) => <span className="tabular">{number(row.original.sizeSqft)} sqft</span>,
      },
      {
        id: 'price',
        header: 'Price',
        cell: ({ row }) => <span className="tabular font-medium">{money(row.original.price, { compact: true })}</span>,
      },
      { id: 'facing', header: 'Facing', cell: ({ row }) => humanize(row.original.facing) },
      { id: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      {
        id: 'client',
        header: 'Booked by',
        cell: ({ row }) => row.original.bookings[0]?.client?.name ?? <span className="text-muted-foreground">—</span>,
      },
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

  const projectOptions = (projects.data ?? []).map((project) => ({ value: String(project.id), label: project.name }));

  return (
    <>
      <PageHeader
        title="Properties"
        description="Unit inventory across every tower."
        actions={
          <>
            <Tabs value={view} onValueChange={(value) => setView(value as 'table' | 'map')}>
              <TabsList>
                <TabsTrigger value="table">
                  <TableIcon className="h-4 w-4" />
                  List
                </TabsTrigger>
                <TabsTrigger value="map">
                  <Grid3x3 className="h-4 w-4" />
                  Map
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4" />
              Import
            </Button>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Add unit
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="space-y-1 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Total units</p>
            <p className="tabular text-2xl font-bold">{number(summary.data?.total)}</p>
            <p className="text-xs text-muted-foreground">
              Inventory value {money(summary.data?.totalValue, { compact: true })}
            </p>
          </CardContent>
        </Card>
        {PROPERTY_STATUSES.map((status) => {
          const entry = summary.data?.byStatus.find((row) => row.status === status);
          return (
            <Card key={status}>
              <CardContent className="space-y-1 p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{humanize(status)}</p>
                <p className="tabular text-2xl font-bold">{number(entry?.count ?? 0)}</p>
                <p className="text-xs text-muted-foreground">{money(entry?.value ?? 0, { compact: true })}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <FilterBar
        search={list.search}
        onSearchChange={list.setSearch}
        placeholder="Search tower or unit…"
        onReset={list.reset}
      >
        <SimpleSelect
          className="w-52"
          value={list.filters.projectId ?? ''}
          onChange={(value) => list.setFilter('projectId', value)}
          options={projectOptions}
          allowAll
          allLabel="All projects"
          placeholder="Project"
        />
        <SimpleSelect
          className="w-40"
          value={list.filters.status ?? ''}
          onChange={(value) => list.setFilter('status', value)}
          options={PROPERTY_STATUSES.map((status) => ({ value: status, label: humanize(status) }))}
          allowAll
          allLabel="All statuses"
          placeholder="Status"
        />
      </FilterBar>

      {view === 'table' ? (
        <DataTable
          columns={columns}
          data={properties.data?.rows ?? []}
          loading={properties.loading}
          page={properties.data?.page}
          pageCount={properties.data?.pageCount}
          total={properties.data?.total}
          onPageChange={list.setPage}
          sortBy={list.sortBy}
          sortDir={list.sortDir}
          onSortChange={list.toggleSort}
          sortableColumns={['tower', 'floor', 'price', 'sizeSqft', 'status']}
          onRowClick={openEdit}
          dense
          emptyTitle="No units yet"
          emptyDescription="Add units one at a time, or paste a whole tower from a spreadsheet."
        />
      ) : (
        <div className="space-y-4">
          {map.loading ? (
            <Card>
              <CardContent className="p-8 text-center text-sm text-muted-foreground">Loading unit map…</CardContent>
            </Card>
          ) : (map.data ?? []).length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                No units to plot. Choose a project or add units first.
              </CardContent>
            </Card>
          ) : (
            (map.data ?? []).map((tower) => (
              <Card key={tower.tower}>
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-center gap-2">
                    <Building className="h-4 w-4 text-muted-foreground" />
                    <p className="font-semibold">Tower {tower.tower}</p>
                  </div>
                  <div className="space-y-2">
                    {tower.floors.map((floor) => (
                      <div key={floor.floor} className="flex items-center gap-3">
                        <span className="w-16 shrink-0 text-xs font-semibold text-muted-foreground">
                          Floor {floor.floor}
                        </span>
                        <div className="flex flex-wrap gap-2">
                          {floor.units.map((unit) => (
                            <Tooltip
                              key={unit.id}
                              label={
                                <span className="block space-y-0.5">
                                  <span className="block font-semibold">
                                    {tower.tower}-{unit.unit} • {unit.unitType}
                                  </span>
                                  <span className="block">
                                    {number(unit.sizeSqft)} sqft • {money(unit.price, { compact: true })}
                                  </span>
                                  <span className="block text-muted-foreground">
                                    {humanize(unit.facing)} facing
                                    {unit.client ? ` • ${unit.client}` : ''}
                                  </span>
                                </span>
                              }
                            >
                              <button
                                type="button"
                                className={`h-11 w-14 rounded-md border text-xs font-semibold transition-colors ${
                                  STATUS_STYLES[unit.status] ?? 'border-border bg-muted'
                                }`}
                              >
                                {unit.unit}
                              </button>
                            </Tooltip>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      <FormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editing ? 'Edit unit' : 'Add unit'}
        onSubmit={save}
        submitting={form.formState.isSubmitting}
        submitLabel={editing ? 'Save changes' : 'Add unit'}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Project" required className="sm:col-span-2" error={form.formState.errors.projectId?.message}>
            <SimpleSelect
              value={form.watch('projectId') ? String(form.watch('projectId')) : ''}
              onChange={(value) => form.setValue('projectId', Number(value))}
              options={projectOptions}
              placeholder="Select project"
            />
          </Field>
          <Field label="Tower" required error={form.formState.errors.tower?.message}>
            <Input {...form.register('tower')} placeholder="A" />
          </Field>
          <Field label="Unit" required error={form.formState.errors.unit?.message}>
            <Input {...form.register('unit')} placeholder="101" />
          </Field>
          <Field label="Floor" required error={form.formState.errors.floor?.message}>
            <Input type="number" {...form.register('floor')} />
          </Field>
          <Field label="Type">
            <SimpleSelect
              value={form.watch('unitType') ?? '2BHK'}
              onChange={(value) => form.setValue('unitType', value as PropertyInput['unitType'])}
              options={UNIT_TYPES.map((type) => ({ value: type, label: type }))}
            />
          </Field>
          <Field label="Size (sqft)" error={form.formState.errors.sizeSqft?.message}>
            <Input type="number" min={0} step={1} {...form.register('sizeSqft')} />
          </Field>
          <Field label="Price" error={form.formState.errors.price?.message}>
            <Input type="number" min={0} step={10000} {...form.register('price')} />
          </Field>
          <Field label="Facing">
            <SimpleSelect
              value={form.watch('facing') ?? 'EAST'}
              onChange={(value) => form.setValue('facing', value as PropertyInput['facing'])}
              options={PROPERTY_FACINGS.map((facing) => ({ value: facing, label: humanize(facing) }))}
            />
          </Field>
          <Field label="Status">
            <SimpleSelect
              value={form.watch('status') ?? 'AVAILABLE'}
              onChange={(value) => form.setValue('status', value as PropertyInput['status'])}
              options={PROPERTY_STATUSES.map((status) => ({ value: status, label: humanize(status) }))}
            />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea rows={2} {...form.register('notes')} />
          </Field>
        </div>
      </FormDialog>

      <FormDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Import units"
        description="Paste rows from a spreadsheet. Existing tower + unit combinations are updated rather than duplicated."
        onSubmit={runImport}
        submitting={importing}
        submitLabel="Import units"
      >
        <div className="space-y-4">
          <Field label="Project" required>
            <SimpleSelect
              value={importProject}
              onChange={setImportProject}
              options={projectOptions}
              placeholder="Select project"
            />
          </Field>
          <Field
            label="Rows"
            hint="Tower, Floor, Unit, Type, Size, Price, Facing, Status — one unit per line, comma or tab separated."
          >
            <Textarea
              rows={10}
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder={'A, 1, 101, 2BHK, 1080, 4850000, EAST, AVAILABLE\nA, 1, 102, 3BHK, 1450, 6900000, WEST, AVAILABLE'}
              className="font-mono text-xs"
            />
          </Field>
        </div>
      </FormDialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this unit?"
        description={
          <>
            Unit <strong className="text-foreground">{deleting ? `${deleting.tower}-${deleting.unit}` : ''}</strong> and
            any booking against it will be removed.
          </>
        }
        confirmLabel="Delete unit"
        destructive
        successMessage="Unit deleted."
        onConfirm={async () => {
          if (deleting) await api.delete(`/properties/${deleting.id}`);
          properties.refresh();
          summary.refresh();
        }}
      />
    </>
  );
}
