import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Package, Plus, SlidersHorizontal } from 'lucide-react';
import { PageHeader } from '@/components/app/PageHeader';
import { FilterBar } from '@/components/app/FilterBar';
import { DataTable } from '@/components/app/DataTable';
import { FormDialog } from '@/components/app/FormDialog';
import { ChartCard, axisProps, chartTooltipStyle } from '@/components/app/ChartCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useListState } from '@/hooks/useListState';
import { useResource } from '@/hooks/useResource';
import { ApiError, api } from '@/lib/api';
import { formatDate, money, number, today } from '@/lib/format';
import { MATERIAL_CATEGORIES, STOCK_ADJUSTMENT_REASONS, humanize } from '@shared/constants';
import {
  materialSchema,
  materialUsageSchema,
  purchaseSchema,
  stockAdjustmentSchema,
  type MaterialInput,
  type MaterialUsageInput,
  type PurchaseInput,
  type StockAdjustmentInput,
} from '@shared/schemas';
import type { Paginated, StockRow } from '@shared/types';

interface MaterialOption {
  id: number;
  name: string;
  unit: string;
  rate: number;
  category: string;
}

interface Purchase {
  id: number;
  quantity: number;
  rate: number;
  amount: number;
  supplier: string | null;
  invoiceNo: string | null;
  purchasedOn: string;
  material?: { name: string; unit: string } | null;
  project?: { name: string } | null;
}

interface Usage {
  id: number;
  quantity: number;
  usedOn: string;
  issuedTo: string | null;
  material?: { name: string; unit: string; rate: number } | null;
  project?: { name: string } | null;
}

interface Adjustment {
  id: number;
  quantity: number;
  reason: string;
  adjustedOn: string;
  notes: string | null;
  material?: { name: string; unit: string } | null;
}

type DialogKind = 'material' | 'purchase' | 'usage' | 'adjustment' | null;

export function InventoryPage(): JSX.Element {
  const [tab, setTab] = useState('stock');
  const [dialog, setDialog] = useState<DialogKind>(null);

  const stockList = useListState();
  const ledgerList = useListState({ sortBy: 'purchasedOn', sortDir: 'desc' });

  const materials = useResource<MaterialOption[]>((signal) => api.get('/materials/options', undefined, signal));
  const projects = useResource<{ id: number; name: string }[]>((signal) => api.get('/projects/options', undefined, signal));

  const stock = useResource<{ rows: StockRow[]; totals: { materials: number; stockValue: number; lowStock: number } }>(
    (signal) => api.get('/materials/stock', { q: stockList.debouncedSearch, category: stockList.filters.category ?? '' }, signal),
    [stockList.debouncedSearch, stockList.filters.category],
  );

  const purchases = useResource<Paginated<Purchase>>(
    (signal) => api.list<Purchase>('/purchases', ledgerList.query, signal),
    [JSON.stringify(ledgerList.query), tab],
    { enabled: tab === 'purchases' },
  );

  const usage = useResource<Paginated<Usage>>(
    (signal) => api.list<Usage>('/usage', { ...ledgerList.query, sortBy: 'usedOn' }, signal),
    [JSON.stringify(ledgerList.query), tab],
    { enabled: tab === 'issues' },
  );

  const adjustments = useResource<Paginated<Adjustment>>(
    (signal) => api.list<Adjustment>('/adjustments', { ...ledgerList.query, sortBy: 'adjustedOn' }, signal),
    [JSON.stringify(ledgerList.query), tab],
    { enabled: tab === 'adjustments' },
  );

  const consumption = useResource<{
    byMaterial: { name: string; unit: string; quantity: number; value: number; remaining: number }[];
    byDay: { date: string; value: number }[];
    totalValue: number;
  }>((signal) => api.get('/usage/summary/consumption', undefined, signal), []);

  const materialForm = useForm<MaterialInput>({
    resolver: zodResolver(materialSchema),
    defaultValues: { name: '', category: 'GENERAL', unit: 'Nos', openingStock: 0, reorderLevel: 0, rate: 0, active: true },
  });

  const purchaseForm = useForm<PurchaseInput>({
    resolver: zodResolver(purchaseSchema),
    defaultValues: { materialId: 0, projectId: null, quantity: 0, rate: 0, supplier: '', invoiceNo: '', purchasedOn: today(), notes: '' },
  });

  const usageForm = useForm<MaterialUsageInput>({
    resolver: zodResolver(materialUsageSchema),
    defaultValues: { materialId: 0, projectId: 0, quantity: 0, usedOn: today(), issuedTo: '', notes: '' },
  });

  const adjustmentForm = useForm<StockAdjustmentInput>({
    resolver: zodResolver(stockAdjustmentSchema),
    defaultValues: { materialId: 0, quantity: 0, reason: 'RETURN', adjustedOn: today(), notes: '' },
  });

  const refreshAll = (): void => {
    stock.refresh();
    materials.refresh();
    consumption.refresh();
    purchases.refresh();
    usage.refresh();
    adjustments.refresh();
  };

  const submit = async (kind: Exclude<DialogKind, null>, path: string, values: unknown): Promise<void> => {
    try {
      await api.post(path, values);
      toast.success(
        {
          material: 'Material added.',
          purchase: 'Purchase recorded.',
          usage: 'Material issued to site.',
          adjustment: 'Stock adjusted.',
        }[kind],
      );
      setDialog(null);
      refreshAll();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'That entry could not be saved.');
    }
  };

  const materialOptions = (materials.data ?? []).map((material) => ({
    value: String(material.id),
    label: `${material.name} (${material.unit})`,
  }));
  const projectOptions = (projects.data ?? []).map((project) => ({ value: String(project.id), label: project.name }));

  const stockColumns = useMemo<ColumnDef<StockRow, unknown>[]>(
    () => [
      {
        id: 'name',
        header: 'Material',
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium">{row.original.name}</p>
            <p className="text-xs text-muted-foreground">{humanize(row.original.category)}</p>
          </div>
        ),
      },
      { id: 'unit', header: 'Unit', cell: ({ row }) => row.original.unit },
      { id: 'openingStock', header: 'Opening', cell: ({ row }) => <span className="tabular">{number(row.original.openingStock, 2)}</span> },
      { id: 'purchased', header: 'Purchased', cell: ({ row }) => <span className="tabular text-success">+{number(row.original.purchased, 2)}</span> },
      { id: 'used', header: 'Issued', cell: ({ row }) => <span className="tabular text-destructive">−{number(row.original.used, 2)}</span> },
      { id: 'adjusted', header: 'Adjusted', cell: ({ row }) => <span className="tabular">{number(row.original.adjusted, 2)}</span> },
      {
        id: 'inStock',
        header: 'In stock',
        cell: ({ row }) => (
          <span className={`tabular font-semibold ${row.original.low ? 'text-destructive' : ''}`}>
            {number(row.original.inStock, 2)}
          </span>
        ),
      },
      { id: 'reorderLevel', header: 'Reorder at', cell: ({ row }) => <span className="tabular">{number(row.original.reorderLevel, 2)}</span> },
      { id: 'stockValue', header: 'Value', cell: ({ row }) => <span className="tabular">{money(row.original.stockValue, { compact: true })}</span> },
      {
        id: 'alert',
        header: '',
        cell: ({ row }) =>
          row.original.low ? (
            <Badge variant="destructive">
              <AlertTriangle className="mr-1 h-3 w-3" />
              Low
            </Badge>
          ) : null,
      },
    ],
    [],
  );

  const purchaseColumns = useMemo<ColumnDef<Purchase, unknown>[]>(
    () => [
      { id: 'purchasedOn', header: 'Date', cell: ({ row }) => formatDate(row.original.purchasedOn) },
      { id: 'material', header: 'Material', cell: ({ row }) => row.original.material?.name ?? '—' },
      {
        id: 'quantity',
        header: 'Quantity',
        cell: ({ row }) => (
          <span className="tabular">
            {number(row.original.quantity, 2)} {row.original.material?.unit ?? ''}
          </span>
        ),
      },
      { id: 'rate', header: 'Rate', cell: ({ row }) => <span className="tabular">{money(row.original.rate)}</span> },
      { id: 'amount', header: 'Amount', cell: ({ row }) => <span className="tabular font-medium">{money(row.original.amount)}</span> },
      { id: 'supplier', header: 'Supplier', cell: ({ row }) => row.original.supplier ?? '—' },
      { id: 'invoiceNo', header: 'Invoice', cell: ({ row }) => row.original.invoiceNo ?? '—' },
      { id: 'project', header: 'Site', cell: ({ row }) => row.original.project?.name ?? '—' },
    ],
    [],
  );

  const usageColumns = useMemo<ColumnDef<Usage, unknown>[]>(
    () => [
      { id: 'usedOn', header: 'Date', cell: ({ row }) => formatDate(row.original.usedOn) },
      { id: 'material', header: 'Material', cell: ({ row }) => row.original.material?.name ?? '—' },
      {
        id: 'quantity',
        header: 'Quantity',
        cell: ({ row }) => (
          <span className="tabular">
            {number(row.original.quantity, 2)} {row.original.material?.unit ?? ''}
          </span>
        ),
      },
      {
        id: 'value',
        header: 'Value',
        cell: ({ row }) => (
          <span className="tabular">{money(row.original.quantity * (row.original.material?.rate ?? 0))}</span>
        ),
      },
      { id: 'project', header: 'Site', cell: ({ row }) => row.original.project?.name ?? '—' },
      { id: 'issuedTo', header: 'Issued to', cell: ({ row }) => row.original.issuedTo ?? '—' },
    ],
    [],
  );

  const adjustmentColumns = useMemo<ColumnDef<Adjustment, unknown>[]>(
    () => [
      { id: 'adjustedOn', header: 'Date', cell: ({ row }) => formatDate(row.original.adjustedOn) },
      { id: 'material', header: 'Material', cell: ({ row }) => row.original.material?.name ?? '—' },
      {
        id: 'quantity',
        header: 'Change',
        cell: ({ row }) => (
          <span className={`tabular font-medium ${row.original.quantity < 0 ? 'text-destructive' : 'text-success'}`}>
            {row.original.quantity > 0 ? '+' : ''}
            {number(row.original.quantity, 2)} {row.original.material?.unit ?? ''}
          </span>
        ),
      },
      { id: 'reason', header: 'Reason', cell: ({ row }) => humanize(row.original.reason) },
      { id: 'notes', header: 'Notes', cell: ({ row }) => row.original.notes ?? '—' },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Purchases, site issues and live stock for every material."
        actions={
          <>
            <Button variant="outline" onClick={() => setDialog('purchase')}>
              <ArrowDownToLine className="h-4 w-4" />
              Purchase
            </Button>
            <Button variant="outline" onClick={() => setDialog('usage')}>
              <ArrowUpFromLine className="h-4 w-4" />
              Issue
            </Button>
            <Button variant="outline" onClick={() => setDialog('adjustment')}>
              <SlidersHorizontal className="h-4 w-4" />
              Adjust
            </Button>
            <Button onClick={() => setDialog('material')}>
              <Plus className="h-4 w-4" />
              Material
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="space-y-1 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Materials tracked</p>
            <p className="tabular text-2xl font-bold">{number(stock.data?.totals.materials)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stock value</p>
            <p className="tabular text-2xl font-bold">{money(stock.data?.totals.stockValue, { compact: true })}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Below reorder level</p>
            <p className={`tabular text-2xl font-bold ${(stock.data?.totals.lowStock ?? 0) > 0 ? 'text-destructive' : ''}`}>
              {number(stock.data?.totals.lowStock)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="stock">
            <Package className="h-4 w-4" />
            Live stock
          </TabsTrigger>
          <TabsTrigger value="consumption">Consumption</TabsTrigger>
          <TabsTrigger value="purchases">Purchases</TabsTrigger>
          <TabsTrigger value="issues">Issues</TabsTrigger>
          <TabsTrigger value="adjustments">Adjustments</TabsTrigger>
        </TabsList>

        <TabsContent value="stock" className="space-y-4">
          <FilterBar
            search={stockList.search}
            onSearchChange={stockList.setSearch}
            placeholder="Search materials…"
            onReset={stockList.reset}
          >
            <SimpleSelect
              className="w-48"
              value={stockList.filters.category ?? ''}
              onChange={(value) => stockList.setFilter('category', value)}
              options={MATERIAL_CATEGORIES.map((category) => ({ value: category, label: humanize(category) }))}
              allowAll
              allLabel="All categories"
              placeholder="Category"
            />
          </FilterBar>
          <DataTable
            columns={stockColumns}
            data={stock.data?.rows ?? []}
            loading={stock.loading}
            dense
            emptyTitle="No materials yet"
            emptyDescription="Add the materials you buy, then record purchases and site issues against them."
          />
        </TabsContent>

        <TabsContent value="consumption" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Daily consumption value" description="Last 30 days" loading={consumption.loading}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={consumption.data?.byDay ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="date" {...axisProps} tickFormatter={(value: string) => value.slice(5)} />
                  <YAxis {...axisProps} width={60} tickFormatter={(value) => money(Number(value), { compact: true })} />
                  <RTooltip {...chartTooltipStyle} formatter={(value: number) => [money(value), 'Issued']} />
                  <Bar dataKey="value" fill="#BC1F43" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <Card>
              <CardContent className="p-5">
                <p className="mb-3 text-sm font-semibold">Consumed vs remaining</p>
                <div className="space-y-3">
                  {(consumption.data?.byMaterial ?? []).slice(0, 8).map((row) => (
                    <div key={row.name} className="flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 flex-1 truncate">{row.name}</span>
                      <span className="tabular text-destructive">
                        −{number(row.quantity, 1)} {row.unit}
                      </span>
                      <span className="tabular w-24 text-right text-muted-foreground">
                        {number(row.remaining, 1)} left
                      </span>
                    </div>
                  ))}
                  {(consumption.data?.byMaterial ?? []).length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      Nothing issued in the last 30 days.
                    </p>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="purchases" className="space-y-4">
          <FilterBar search={ledgerList.search} onSearchChange={ledgerList.setSearch} placeholder="Search supplier or invoice…" />
          <DataTable
            columns={purchaseColumns}
            data={purchases.data?.rows ?? []}
            loading={purchases.loading}
            page={purchases.data?.page}
            pageCount={purchases.data?.pageCount}
            total={purchases.data?.total}
            onPageChange={ledgerList.setPage}
            dense
            emptyTitle="No purchases recorded"
          />
        </TabsContent>

        <TabsContent value="issues" className="space-y-4">
          <FilterBar search={ledgerList.search} onSearchChange={ledgerList.setSearch} placeholder="Search issues…" />
          <DataTable
            columns={usageColumns}
            data={usage.data?.rows ?? []}
            loading={usage.loading}
            page={usage.data?.page}
            pageCount={usage.data?.pageCount}
            total={usage.data?.total}
            onPageChange={ledgerList.setPage}
            dense
            emptyTitle="Nothing issued yet"
          />
        </TabsContent>

        <TabsContent value="adjustments" className="space-y-4">
          <DataTable
            columns={adjustmentColumns}
            data={adjustments.data?.rows ?? []}
            loading={adjustments.loading}
            page={adjustments.data?.page}
            pageCount={adjustments.data?.pageCount}
            total={adjustments.data?.total}
            onPageChange={ledgerList.setPage}
            dense
            emptyTitle="No adjustments"
            emptyDescription="Returns from site, damage and stock-verification corrections appear here."
          />
        </TabsContent>
      </Tabs>

      {/* --- dialogs --- */}
      <FormDialog
        open={dialog === 'material'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Add material"
        onSubmit={materialForm.handleSubmit((values) => submit('material', '/materials', values))}
        submitting={materialForm.formState.isSubmitting}
        submitLabel="Add material"
        size="sm"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required className="sm:col-span-2" error={materialForm.formState.errors.name?.message}>
            <Input {...materialForm.register('name')} placeholder="OPC 53 Grade Cement" />
          </Field>
          <Field label="Category">
            <SimpleSelect
              value={materialForm.watch('category') ?? 'GENERAL'}
              onChange={(value) => materialForm.setValue('category', value as MaterialInput['category'])}
              options={MATERIAL_CATEGORIES.map((category) => ({ value: category, label: humanize(category) }))}
            />
          </Field>
          <Field label="Unit" required error={materialForm.formState.errors.unit?.message}>
            <Input {...materialForm.register('unit')} placeholder="Bag" />
          </Field>
          <Field label="Opening stock">
            <Input type="number" min={0} step="any" {...materialForm.register('openingStock')} />
          </Field>
          <Field label="Reorder level">
            <Input type="number" min={0} step="any" {...materialForm.register('reorderLevel')} />
          </Field>
          <Field label="Rate" className="sm:col-span-2">
            <Input type="number" min={0} step="any" {...materialForm.register('rate')} />
          </Field>
        </div>
      </FormDialog>

      <FormDialog
        open={dialog === 'purchase'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Record purchase"
        onSubmit={purchaseForm.handleSubmit((values) => submit('purchase', '/purchases', values))}
        submitting={purchaseForm.formState.isSubmitting}
        submitLabel="Save purchase"
        size="sm"
        footerExtra={`Amount ${money(
          Number(purchaseForm.watch('quantity') ?? 0) * Number(purchaseForm.watch('rate') ?? 0),
        )}`}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Material" required className="sm:col-span-2" error={purchaseForm.formState.errors.materialId?.message}>
            <SimpleSelect
              value={purchaseForm.watch('materialId') ? String(purchaseForm.watch('materialId')) : ''}
              onChange={(value) => {
                purchaseForm.setValue('materialId', Number(value));
                const material = materials.data?.find((item) => item.id === Number(value));
                if (material) purchaseForm.setValue('rate', material.rate);
              }}
              options={materialOptions}
              placeholder="Select material"
            />
          </Field>
          <Field label="Quantity" required error={purchaseForm.formState.errors.quantity?.message}>
            <Input type="number" min={0} step="any" {...purchaseForm.register('quantity')} />
          </Field>
          <Field label="Rate" required error={purchaseForm.formState.errors.rate?.message}>
            <Input type="number" min={0} step="any" {...purchaseForm.register('rate')} />
          </Field>
          <Field label="Supplier">
            <Input {...purchaseForm.register('supplier')} />
          </Field>
          <Field label="Invoice number">
            <Input {...purchaseForm.register('invoiceNo')} />
          </Field>
          <Field label="Purchased on" required>
            <Input type="date" {...purchaseForm.register('purchasedOn')} />
          </Field>
          <Field label="Site">
            <SimpleSelect
              value={purchaseForm.watch('projectId') ? String(purchaseForm.watch('projectId')) : ''}
              onChange={(value) => purchaseForm.setValue('projectId', value ? Number(value) : null)}
              options={projectOptions}
              allowAll
              allLabel="Central store"
              placeholder="Site"
            />
          </Field>
        </div>
      </FormDialog>

      <FormDialog
        open={dialog === 'usage'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Issue material to site"
        onSubmit={usageForm.handleSubmit((values) => submit('usage', '/usage', values))}
        submitting={usageForm.formState.isSubmitting}
        submitLabel="Issue material"
        size="sm"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Material" required className="sm:col-span-2" error={usageForm.formState.errors.materialId?.message}>
            <SimpleSelect
              value={usageForm.watch('materialId') ? String(usageForm.watch('materialId')) : ''}
              onChange={(value) => usageForm.setValue('materialId', Number(value))}
              options={materialOptions}
              placeholder="Select material"
            />
          </Field>
          <Field label="Site" required className="sm:col-span-2" error={usageForm.formState.errors.projectId?.message}>
            <SimpleSelect
              value={usageForm.watch('projectId') ? String(usageForm.watch('projectId')) : ''}
              onChange={(value) => usageForm.setValue('projectId', Number(value))}
              options={projectOptions}
              placeholder="Select site"
            />
          </Field>
          <Field label="Quantity" required error={usageForm.formState.errors.quantity?.message}>
            <Input type="number" min={0} step="any" {...usageForm.register('quantity')} />
          </Field>
          <Field label="Used on" required>
            <Input type="date" {...usageForm.register('usedOn')} />
          </Field>
          <Field label="Issued to" className="sm:col-span-2">
            <Input {...usageForm.register('issuedTo')} placeholder="Mason team A" />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea rows={2} {...usageForm.register('notes')} />
          </Field>
        </div>
      </FormDialog>

      <FormDialog
        open={dialog === 'adjustment'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Adjust stock"
        description="Use a positive quantity for returns from site, and a negative one for damage or wastage."
        onSubmit={adjustmentForm.handleSubmit((values) => submit('adjustment', '/adjustments', values))}
        submitting={adjustmentForm.formState.isSubmitting}
        submitLabel="Save adjustment"
        size="sm"
      >
        <div className="space-y-4">
          <Field label="Material" required error={adjustmentForm.formState.errors.materialId?.message}>
            <SimpleSelect
              value={adjustmentForm.watch('materialId') ? String(adjustmentForm.watch('materialId')) : ''}
              onChange={(value) => adjustmentForm.setValue('materialId', Number(value))}
              options={materialOptions}
              placeholder="Select material"
            />
          </Field>
          <Field label="Quantity" required error={adjustmentForm.formState.errors.quantity?.message}>
            <Input type="number" step="any" {...adjustmentForm.register('quantity')} placeholder="-25" />
          </Field>
          <Field label="Reason">
            <SimpleSelect
              value={adjustmentForm.watch('reason') ?? 'RETURN'}
              onChange={(value) => adjustmentForm.setValue('reason', value as StockAdjustmentInput['reason'])}
              options={STOCK_ADJUSTMENT_REASONS.map((reason) => ({ value: reason, label: humanize(reason) }))}
            />
          </Field>
          <Field label="Date" required>
            <Input type="date" {...adjustmentForm.register('adjustedOn')} />
          </Field>
          <Field label="Notes">
            <Textarea rows={2} {...adjustmentForm.register('notes')} />
          </Field>
        </div>
      </FormDialog>
    </>
  );
}
