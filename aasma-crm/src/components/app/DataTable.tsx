import { useMemo, type ReactNode } from 'react';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/misc';
import { EmptyState } from './PageHeader';
import { cn } from '@/lib/utils';

export interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  loading?: boolean;
  /** Server-side paging state; omit for a plain table. */
  page?: number;
  pageCount?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  onSortChange?: (column: string) => void;
  /** Column ids that can be sorted by clicking the header. */
  sortableColumns?: string[];
  onRowClick?: (row: T) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  dense?: boolean;
}

/**
 * The table every list screen uses. Sorting and paging are server-driven, so
 * the browser only ever holds one page of rows at a time.
 */
export function DataTable<T>({
  columns,
  data,
  loading,
  page = 1,
  pageCount = 1,
  total,
  onPageChange,
  sortBy,
  sortDir = 'desc',
  onSortChange,
  sortableColumns = [],
  onRowClick,
  emptyTitle = 'Nothing to show yet',
  emptyDescription,
  emptyAction,
  dense,
}: DataTableProps<T>): JSX.Element {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
  });

  const skeletonRows = useMemo(() => Array.from({ length: 6 }, (_, index) => index), []);

  return (
    <div className="card-surface overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/60">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const id = header.column.id;
                  const sortable = sortableColumns.includes(id) && Boolean(onSortChange);
                  const active = sortBy === id;
                  return (
                    <th
                      key={header.id}
                      className={cn(
                        'whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground',
                        sortable && 'cursor-pointer select-none hover:text-foreground',
                      )}
                      onClick={sortable ? () => onSortChange?.(id) : undefined}
                    >
                      <span className="inline-flex items-center gap-1">
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                        {active ? (
                          sortDir === 'asc' ? (
                            <ArrowUp className="h-3 w-3 text-primary" />
                          ) : (
                            <ArrowDown className="h-3 w-3 text-primary" />
                          )
                        ) : null}
                      </span>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading
              ? skeletonRows.map((row) => (
                  <tr key={row} className="border-t border-border">
                    {columns.map((_column, index) => (
                      <td key={index} className="px-4 py-3">
                        <Skeleton className="h-4" />
                      </td>
                    ))}
                  </tr>
                ))
              : table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                    className={cn(
                      'border-t border-border transition-colors',
                      onRowClick && 'cursor-pointer hover:bg-muted/60',
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className={cn('px-4 align-middle', dense ? 'py-2' : 'py-3')}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {!loading && data.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-5 w-5" />}
          title={emptyTitle}
          description={emptyDescription}
          action={emptyAction}
        />
      ) : null}

      {onPageChange && pageCount > 1 ? (
        <div className="flex items-center justify-between gap-4 border-t border-border px-4 py-3">
          <p className="text-xs text-muted-foreground">
            Page {page} of {pageCount}
            {typeof total === 'number' ? ` • ${total.toLocaleString('en-IN')} record(s)` : ''}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
