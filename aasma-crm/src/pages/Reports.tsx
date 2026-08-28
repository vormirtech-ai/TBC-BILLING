import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Download, FileSpreadsheet } from 'lucide-react';
import { PageHeader } from '@/components/app/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/misc';
import { useResource } from '@/hooks/useResource';
import { api, downloadFile } from '@/lib/api';
import { formatDate, money, number } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ReportDefinition } from '@shared/types';

interface ReportColumn {
  key: string;
  header: string;
  type?: 'text' | 'number' | 'money' | 'date' | 'percent';
}

interface ReportResult {
  key: string;
  title: string;
  subtitle: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  totals: Record<string, number>;
}

function renderCell(value: unknown, type?: ReportColumn['type']): string {
  if (value === null || value === undefined || value === '') return '—';
  if (type === 'money') return money(Number(value), { decimals: 2 });
  if (type === 'number') return number(Number(value), 2);
  if (type === 'percent') return `${Number(value).toFixed(1)}%`;
  if (type === 'date') return formatDate(String(value));
  return String(value);
}

const PAGE_SIZE = 50;

export function ReportsPage(): JSX.Element {
  const [selected, setSelected] = useState('leads');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [projectId, setProjectId] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const definitions = useResource<ReportDefinition[]>((signal) => api.get('/reports', undefined, signal));
  const projects = useResource<{ id: number; name: string }[]>((signal) => api.get('/projects/options', undefined, signal));

  const query = useMemo(
    () => ({ from, to, projectId, q: search, pageSize: 500 }),
    [from, to, projectId, search],
  );

  const report = useResource<ReportResult>(
    (signal) => api.get(`/reports/${selected}`, query, signal),
    [selected, JSON.stringify(query)],
  );

  const definition = definitions.data?.find((item) => item.key === selected);
  const rows = report.data?.rows ?? [];
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const exportExcel = async (): Promise<void> => {
    setExporting(true);
    try {
      await downloadFile(`/reports/${selected}/export`, query);
      toast.success('Workbook downloaded.');
    } catch {
      toast.error('The export could not be generated.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Reports"
        description="Filter, review and export any register as a formatted Excel workbook."
        actions={
          <Button onClick={exportExcel} loading={exporting} disabled={rows.length === 0}>
            <Download className="h-4 w-4" />
            Export to Excel
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <Card className="h-fit">
          <CardContent className="space-y-1 p-3">
            {definitions.loading ? (
              <div className="space-y-2 p-2">
                {[0, 1, 2, 3, 4].map((index) => (
                  <Skeleton key={index} className="h-10" />
                ))}
              </div>
            ) : (
              (definitions.data ?? []).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setSelected(item.key);
                    setPage(1);
                  }}
                  className={cn(
                    'w-full rounded-md px-3 py-2.5 text-left transition-colors',
                    selected === item.key ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
                  )}
                >
                  <span className="block text-sm font-medium">{item.label}</span>
                  <span className="block text-xs text-muted-foreground">{item.description}</span>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardContent className="flex flex-wrap items-end gap-3 p-5">
              {definition?.filters.includes('date') ? (
                <>
                  <Field label="From" className="w-40">
                    <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
                  </Field>
                  <Field label="To" className="w-40">
                    <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
                  </Field>
                </>
              ) : null}
              {definition?.filters.includes('project') ? (
                <Field label="Site" className="w-52">
                  <SimpleSelect
                    value={projectId}
                    onChange={setProjectId}
                    options={(projects.data ?? []).map((project) => ({ value: String(project.id), label: project.name }))}
                    allowAll
                    allLabel="All sites"
                    placeholder="Site"
                  />
                </Field>
              ) : null}
              {definition?.filters.includes('search') ? (
                <Field label="Search" className="min-w-[12rem] flex-1">
                  <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter rows…" />
                </Field>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                className="mb-0.5 text-muted-foreground"
                onClick={() => {
                  setFrom('');
                  setTo('');
                  setProjectId('');
                  setSearch('');
                  setPage(1);
                }}
              >
                Clear
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-4">
                <div>
                  <p className="font-semibold">{report.data?.title ?? definition?.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {report.data?.subtitle} • {number(rows.length)} row(s)
                  </p>
                </div>
                <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
              </div>

              {report.loading && rows.length === 0 ? (
                <div className="space-y-2 p-5">
                  {[0, 1, 2, 3, 4].map((index) => (
                    <Skeleton key={index} className="h-8" />
                  ))}
                </div>
              ) : rows.length === 0 ? (
                <p className="p-10 text-center text-sm text-muted-foreground">
                  No data for this report and filter combination.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead className="bg-muted/60">
                      <tr>
                        {(report.data?.columns ?? []).map((column) => (
                          <th
                            key={column.key}
                            className={cn(
                              'whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground',
                              column.type === 'money' || column.type === 'number' || column.type === 'percent'
                                ? 'text-right'
                                : 'text-left',
                            )}
                          >
                            {column.header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((row, index) => (
                        <tr key={index} className="border-t border-border">
                          {(report.data?.columns ?? []).map((column) => (
                            <td
                              key={column.key}
                              className={cn(
                                'px-3 py-2 align-top',
                                column.type === 'money' || column.type === 'number' || column.type === 'percent'
                                  ? 'tabular whitespace-nowrap text-right'
                                  : '',
                              )}
                            >
                              {renderCell(row[column.key], column.type)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                    {Object.keys(report.data?.totals ?? {}).length > 0 ? (
                      <tfoot>
                        <tr className="border-t-2 border-primary bg-muted/60 font-semibold">
                          {(report.data?.columns ?? []).map((column, index) => (
                            <td
                              key={column.key}
                              className={cn(
                                'px-3 py-2.5',
                                column.type === 'money' || column.type === 'number' || column.type === 'percent'
                                  ? 'tabular text-right'
                                  : '',
                              )}
                            >
                              {index === 0
                                ? 'Total'
                                : column.key in (report.data?.totals ?? {})
                                  ? renderCell(report.data?.totals[column.key], column.type ?? 'number')
                                  : ''}
                            </td>
                          ))}
                        </tr>
                      </tfoot>
                    ) : null}
                  </table>
                </div>
              )}

              {pageCount > 1 ? (
                <div className="flex items-center justify-between border-t border-border px-5 py-3">
                  <p className="text-xs text-muted-foreground">
                    Page {page} of {pageCount} • showing {pageRows.length} of {rows.length}
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                      Previous
                    </Button>
                    <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>
                      Next
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
