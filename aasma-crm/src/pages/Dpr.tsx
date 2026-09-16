import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  CalendarDays,
  CloudRain,
  Download,
  HardHat,
  Image as ImageIcon,
  Plus,
  Trash2,
  TriangleAlert,
  Upload,
} from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/app/PageHeader';
import { FormDialog } from '@/components/app/FormDialog';
import { ConfirmDialog } from '@/components/app/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { Skeleton, Switch } from '@/components/ui/misc';
import { useResource } from '@/hooks/useResource';
import { ApiError, api, downloadFile } from '@/lib/api';
import { fileUrl } from '@/lib/files';
import { dateInput, formatDate, number, today } from '@/lib/format';
import { WEATHER_OPTIONS, humanize } from '@shared/constants';
import { dprSchema, type DprInput } from '@shared/schemas';
import type { Paginated } from '@shared/types';

interface Dpr {
  id: number;
  projectId: number;
  reportDate: string;
  weather: string;
  workCompleted: string;
  labourCount: number;
  machinery: string | null;
  siteIssues: string | null;
  safetyNotes: string | null;
  preparedBy: string | null;
  project?: { id: number; name: string } | null;
  materials: { id: number; materialId: number; quantity: number; material?: { name: string; unit: string } | null }[];
  photos: { id: number; filePath: string; caption: string | null }[];
}

const emptyDpr: DprInput = {
  projectId: 0,
  reportDate: today(),
  weather: 'CLEAR',
  workCompleted: '',
  labourCount: 0,
  machinery: '',
  siteIssues: '',
  safetyNotes: '',
  preparedBy: '',
  materials: [],
  deductStock: false,
};

export function DprPage(): JSX.Element {
  const [projectId, setProjectId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Dpr | null>(null);
  const [deleting, setDeleting] = useState<Dpr | null>(null);
  const [selected, setSelected] = useState<Dpr | null>(null);
  const [uploading, setUploading] = useState(false);

  const projects = useResource<{ id: number; name: string }[]>((signal) => api.get('/projects/options', undefined, signal));
  const materials = useResource<{ id: number; name: string; unit: string }[]>((signal) =>
    api.get('/materials/options', undefined, signal),
  );

  const reports = useResource<Paginated<Dpr>>(
    (signal) => api.list<Dpr>('/dpr', { projectId, from, to, page, pageSize: 20 }, signal),
    [projectId, from, to, page],
  );

  const form = useForm<DprInput>({ resolver: zodResolver(dprSchema), defaultValues: emptyDpr });
  const materialLines = useFieldArray({ control: form.control, name: 'materials' });

  const openCreate = (): void => {
    setEditing(null);
    form.reset({ ...emptyDpr, projectId: Number(projectId) || projects.data?.[0]?.id || 0 });
    setFormOpen(true);
  };

  const openEdit = (report: Dpr): void => {
    setEditing(report);
    form.reset({
      projectId: report.projectId,
      reportDate: dateInput(report.reportDate),
      weather: report.weather as DprInput['weather'],
      workCompleted: report.workCompleted,
      labourCount: report.labourCount,
      machinery: report.machinery ?? '',
      siteIssues: report.siteIssues ?? '',
      safetyNotes: report.safetyNotes ?? '',
      preparedBy: report.preparedBy ?? '',
      materials: report.materials.map((item) => ({ materialId: item.materialId, quantity: item.quantity })),
      deductStock: false,
    });
    setFormOpen(true);
  };

  const save = form.handleSubmit(async (values) => {
    try {
      if (editing) await api.put(`/dpr/${editing.id}`, values);
      else await api.post('/dpr', values);
      toast.success(editing ? 'Report updated.' : 'Daily progress report filed.');
      setFormOpen(false);
      reports.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'The report could not be saved.');
    }
  });

  const uploadPhotos = async (report: Dpr, files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return;
    const body = new FormData();
    for (const file of Array.from(files)) body.append('photos', file);

    setUploading(true);
    try {
      await api.upload(`/dpr/${report.id}/photos`, body);
      toast.success('Photos attached.');
      reports.refresh();
      setSelected(null);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'The photos could not be attached.');
    } finally {
      setUploading(false);
    }
  };

  const rows = reports.data?.rows ?? [];
  const projectOptions = (projects.data ?? []).map((project) => ({ value: String(project.id), label: project.name }));

  return (
    <>
      <PageHeader
        title="Daily Progress Reports"
        description="What happened on site, day by day."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() =>
                downloadFile('/reports/dpr/export', { projectId, from, to }).catch(() =>
                  toast.error('The export could not be generated.'),
                )
              }
            >
              <Download className="h-4 w-4" />
              Export
            </Button>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              File report
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-5">
          <Field label="Site" className="w-56">
            <SimpleSelect
              value={projectId}
              onChange={(value) => {
                setProjectId(value);
                setPage(1);
              }}
              options={projectOptions}
              allowAll
              allLabel="All sites"
              placeholder="Site"
            />
          </Field>
          <Field label="From" className="w-40">
            <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </Field>
          <Field label="To" className="w-40">
            <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </Field>
          <Button
            variant="ghost"
            size="sm"
            className="mb-0.5 text-muted-foreground"
            onClick={() => {
              setFrom('');
              setTo('');
              setProjectId('');
              setPage(1);
            }}
          >
            Clear
          </Button>
        </CardContent>
      </Card>

      {reports.loading && rows.length === 0 ? (
        <div className="space-y-3">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-32" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CalendarDays className="h-5 w-5" />}
            title="No reports for this filter"
            description="File a daily report to record work done, labour on site, materials used and any issues."
            action={
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" />
                File report
              </Button>
            }
          />
        </Card>
      ) : (
        <ol className="relative space-y-4 border-l border-border pl-6">
          {rows.map((report) => (
            <li key={report.id} className="relative">
              <span className="absolute -left-[1.72rem] top-6 flex h-3 w-3 rounded-full border-2 border-background bg-primary" />
              <Card>
                <CardContent className="space-y-3 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">
                        {formatDate(report.reportDate, 'dddd, DD MMM YYYY')}
                        <span className="ml-2 text-sm font-normal text-muted-foreground">{report.project?.name}</span>
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="secondary">
                          <CloudRain className="mr-1 h-3 w-3" />
                          {humanize(report.weather)}
                        </Badge>
                        <Badge variant="secondary">
                          <HardHat className="mr-1 h-3 w-3" />
                          {number(report.labourCount)} labour
                        </Badge>
                        {report.photos.length > 0 ? (
                          <Badge variant="secondary">
                            <ImageIcon className="mr-1 h-3 w-3" />
                            {report.photos.length} photo(s)
                          </Badge>
                        ) : null}
                        {report.preparedBy ? <span>By {report.preparedBy}</span> : null}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => setSelected(report)}>
                        <Upload className="h-4 w-4" />
                        Photos
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openEdit(report)}>
                        Edit
                      </Button>
                      <Button size="icon" variant="ghost" className="text-destructive" onClick={() => setDeleting(report)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <p className="text-sm">{report.workCompleted}</p>

                  <div className="grid gap-3 text-xs sm:grid-cols-3">
                    {report.materials.length > 0 ? (
                      <div>
                        <p className="font-semibold uppercase tracking-wide text-muted-foreground">Materials used</p>
                        <p className="mt-1">
                          {report.materials
                            .map((item) => `${item.material?.name ?? ''} ${number(item.quantity, 2)} ${item.material?.unit ?? ''}`)
                            .join(', ')}
                        </p>
                      </div>
                    ) : null}
                    {report.machinery ? (
                      <div>
                        <p className="font-semibold uppercase tracking-wide text-muted-foreground">Machinery</p>
                        <p className="mt-1">{report.machinery}</p>
                      </div>
                    ) : null}
                    {report.safetyNotes ? (
                      <div>
                        <p className="font-semibold uppercase tracking-wide text-muted-foreground">Safety</p>
                        <p className="mt-1">{report.safetyNotes}</p>
                      </div>
                    ) : null}
                  </div>

                  {report.siteIssues ? (
                    <p className="flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
                      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {report.siteIssues}
                    </p>
                  ) : null}

                  {report.photos.length > 0 ? (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {report.photos.map((photo) => (
                        <a
                          key={photo.id}
                          href={fileUrl(photo.filePath)}
                          target="_blank"
                          rel="noreferrer"
                          className="block h-20 w-24 overflow-hidden rounded-md border border-border"
                        >
                          <img
                            src={fileUrl(photo.filePath)}
                            alt={photo.caption ?? 'Site photo'}
                            className="h-full w-full object-cover transition-transform hover:scale-105"
                          />
                        </a>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      )}

      {(reports.data?.pageCount ?? 1) > 1 ? (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {page} of {reports.data?.pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= (reports.data?.pageCount ?? 1)}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      ) : null}

      <FormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editing ? 'Edit daily report' : 'File daily progress report'}
        onSubmit={save}
        submitting={form.formState.isSubmitting}
        submitLabel={editing ? 'Save changes' : 'File report'}
        size="lg"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Site" required error={form.formState.errors.projectId?.message}>
            <SimpleSelect
              value={form.watch('projectId') ? String(form.watch('projectId')) : ''}
              onChange={(value) => form.setValue('projectId', Number(value))}
              options={projectOptions}
              placeholder="Select site"
            />
          </Field>
          <Field label="Date" required error={form.formState.errors.reportDate?.message}>
            <Input type="date" {...form.register('reportDate')} />
          </Field>
          <Field label="Weather">
            <SimpleSelect
              value={form.watch('weather') ?? 'CLEAR'}
              onChange={(value) => form.setValue('weather', value as DprInput['weather'])}
              options={WEATHER_OPTIONS.map((option) => ({ value: option, label: humanize(option) }))}
            />
          </Field>
          <Field label="Labour on site" error={form.formState.errors.labourCount?.message}>
            <Input type="number" min={0} {...form.register('labourCount')} />
          </Field>
          <Field label="Work completed" required className="sm:col-span-2" error={form.formState.errors.workCompleted?.message}>
            <Textarea rows={3} {...form.register('workCompleted')} placeholder="Describe the work finished today…" />
          </Field>

          <div className="space-y-2 sm:col-span-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Materials used</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => materialLines.append({ materialId: materials.data?.[0]?.id ?? 0, quantity: 0 })}
              >
                <Plus className="h-4 w-4" />
                Add material
              </Button>
            </div>
            {materialLines.fields.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                No materials recorded for this day.
              </p>
            ) : (
              materialLines.fields.map((field, index) => (
                <div key={field.id} className="flex items-end gap-2">
                  <div className="flex-1">
                    <SimpleSelect
                      value={String(form.watch(`materials.${index}.materialId`) ?? '')}
                      onChange={(value) => form.setValue(`materials.${index}.materialId`, Number(value))}
                      options={(materials.data ?? []).map((material) => ({
                        value: String(material.id),
                        label: `${material.name} (${material.unit})`,
                      }))}
                      placeholder="Material"
                    />
                  </div>
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    className="w-32"
                    placeholder="Quantity"
                    {...form.register(`materials.${index}.quantity`)}
                  />
                  <Button type="button" size="icon" variant="ghost" onClick={() => materialLines.remove(index)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))
            )}
            {!editing && materialLines.fields.length > 0 ? (
              <label className="flex items-center gap-3 rounded-md border border-border p-3 text-sm">
                <Switch
                  checked={Boolean(form.watch('deductStock'))}
                  onCheckedChange={(checked) => form.setValue('deductStock', checked)}
                />
                <span>
                  Also issue these materials from stock
                  <span className="block text-xs text-muted-foreground">
                    Saves entering the same quantities again on the Inventory screen.
                  </span>
                </span>
              </label>
            ) : null}
          </div>

          <Field label="Machinery used">
            <Input {...form.register('machinery')} placeholder="1 mixer, 1 hoist" />
          </Field>
          <Field label="Prepared by">
            <Input {...form.register('preparedBy')} placeholder="Site engineer" />
          </Field>
          <Field label="Site issues" className="sm:col-span-2">
            <Textarea rows={2} {...form.register('siteIssues')} placeholder="Delays, shortages, stoppages…" />
          </Field>
          <Field label="Safety notes" className="sm:col-span-2">
            <Textarea rows={2} {...form.register('safetyNotes')} />
          </Field>
        </div>
      </FormDialog>

      <FormDialog
        open={Boolean(selected)}
        onOpenChange={(open) => !open && setSelected(null)}
        title="Attach site photos"
        description="Photos are copied into this machine's uploads folder — nothing is sent anywhere."
        onSubmit={() => setSelected(null)}
        submitLabel="Done"
        size="sm"
        submitting={uploading}
      >
        <div className="space-y-3">
          <Input
            type="file"
            accept="image/*"
            multiple
            disabled={uploading}
            onChange={(event) => selected && uploadPhotos(selected, event.target.files)}
          />
          <p className="text-xs text-muted-foreground">JPG, PNG, WEBP or GIF. Up to 10 files, 12 MB each.</p>
          {selected && selected.photos.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {selected.photos.map((photo) => (
                <img
                  key={photo.id}
                  src={fileUrl(photo.filePath)}
                  alt={photo.caption ?? ''}
                  className="h-16 w-20 rounded-md border border-border object-cover"
                />
              ))}
            </div>
          ) : null}
        </div>
      </FormDialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this report?"
        description="The report and its photos will be removed from this machine."
        confirmLabel="Delete report"
        destructive
        successMessage="Report deleted."
        onConfirm={async () => {
          if (deleting) await api.delete(`/dpr/${deleting.id}`);
          reports.refresh();
        }}
      />
    </>
  );
}
