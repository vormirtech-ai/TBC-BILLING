import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, Pencil, Plus, Trash2, Eye } from 'lucide-react';
import { PageHeader } from '@/components/app/PageHeader';
import { FilterBar } from '@/components/app/FilterBar';
import { DataTable } from '@/components/app/DataTable';
import { FormDialog } from '@/components/app/FormDialog';
import { ConfirmDialog } from '@/components/app/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
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
import { formatDate, money } from '@/lib/format';
import { clientSchema, type ClientInput } from '@shared/schemas';
import type { Paginated } from '@shared/types';

interface Client {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  panNo: string | null;
  aadhaarNo: string | null;
  notes: string | null;
  createdAt: string;
  bookings: { agreementValue: number; status: string; property?: { tower: string; unit: string } | null }[];
  payments: { amount: number }[];
}

const emptyClient: ClientInput = {
  name: '',
  phone: '',
  email: '',
  address: '',
  panNo: '',
  aadhaarNo: '',
  notes: '',
};

export function ClientsPage(): JSX.Element {
  const navigate = useNavigate();
  const list = useListState({ sortBy: 'createdAt', sortDir: 'desc' });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [deleting, setDeleting] = useState<Client | null>(null);

  const clients = useResource<Paginated<Client>>(
    (signal) => api.list<Client>('/clients', list.query, signal),
    [JSON.stringify(list.query)],
  );

  const form = useForm<ClientInput>({ resolver: zodResolver(clientSchema), defaultValues: emptyClient });

  const openCreate = (): void => {
    setEditing(null);
    form.reset(emptyClient);
    setFormOpen(true);
  };

  const openEdit = (client: Client): void => {
    setEditing(client);
    form.reset({
      name: client.name,
      phone: client.phone,
      email: client.email ?? '',
      address: client.address ?? '',
      panNo: client.panNo ?? '',
      aadhaarNo: client.aadhaarNo ?? '',
      notes: client.notes ?? '',
    });
    setFormOpen(true);
  };

  const save = form.handleSubmit(async (values) => {
    try {
      if (editing) await api.put(`/clients/${editing.id}`, values);
      else await api.post('/clients', values);
      toast.success(editing ? 'Client updated.' : 'Client added.');
      setFormOpen(false);
      clients.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'The client could not be saved.');
    }
  });

  const columns = useMemo<ColumnDef<Client, unknown>[]>(
    () => [
      {
        id: 'name',
        header: 'Client',
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium">{row.original.name}</p>
            <p className="text-xs text-muted-foreground">{row.original.phone}</p>
          </div>
        ),
      },
      {
        id: 'units',
        header: 'Units',
        cell: ({ row }) => {
          const active = row.original.bookings.filter((booking) => booking.status !== 'CANCELLED');
          if (active.length === 0) return <span className="text-muted-foreground">—</span>;
          return (
            <span className="text-sm">
              {active
                .map((booking) => (booking.property ? `${booking.property.tower}-${booking.property.unit}` : '—'))
                .join(', ')}
            </span>
          );
        },
      },
      {
        id: 'agreement',
        header: 'Agreement value',
        cell: ({ row }) => {
          const total = row.original.bookings
            .filter((booking) => booking.status !== 'CANCELLED')
            .reduce((acc, booking) => acc + booking.agreementValue, 0);
          return <span className="tabular">{money(total, { compact: true })}</span>;
        },
      },
      {
        id: 'collected',
        header: 'Collected',
        cell: ({ row }) => {
          const paid = row.original.payments.reduce((acc, payment) => acc + payment.amount, 0);
          return <span className="tabular text-success">{money(paid, { compact: true })}</span>;
        },
      },
      {
        id: 'outstanding',
        header: 'Outstanding',
        cell: ({ row }) => {
          const total = row.original.bookings
            .filter((booking) => booking.status !== 'CANCELLED')
            .reduce((acc, booking) => acc + booking.agreementValue, 0);
          const paid = row.original.payments.reduce((acc, payment) => acc + payment.amount, 0);
          const due = total - paid;
          return (
            <span className={`tabular ${due > 0 ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
              {money(due, { compact: true })}
            </span>
          );
        },
      },
      { id: 'createdAt', header: 'Client since', cell: ({ row }) => formatDate(row.original.createdAt) },
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
              <DropdownMenuItem onClick={() => navigate(`/clients/${row.original.id}`)}>
                <Eye className="h-4 w-4" />
                Open file
              </DropdownMenuItem>
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

  return (
    <>
      <PageHeader
        title="Clients"
        description="Bookings, payments, documents and every interaction."
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Add client
          </Button>
        }
      />

      <FilterBar
        search={list.search}
        onSearchChange={list.setSearch}
        placeholder="Search by name, phone or PAN…"
        onReset={list.reset}
      />

      <DataTable
        columns={columns}
        data={clients.data?.rows ?? []}
        loading={clients.loading}
        page={clients.data?.page}
        pageCount={clients.data?.pageCount}
        total={clients.data?.total}
        onPageChange={list.setPage}
        sortBy={list.sortBy}
        sortDir={list.sortDir}
        onSortChange={list.toggleSort}
        sortableColumns={['name', 'createdAt']}
        onRowClick={(client) => navigate(`/clients/${client.id}`)}
        emptyTitle="No clients yet"
        emptyDescription="Convert a won lead, or add a client directly."
      />

      <FormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editing ? 'Edit client' : 'Add client'}
        onSubmit={save}
        submitting={form.formState.isSubmitting}
        submitLabel={editing ? 'Save changes' : 'Add client'}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required error={form.formState.errors.name?.message}>
            <Input {...form.register('name')} />
          </Field>
          <Field label="Phone" required error={form.formState.errors.phone?.message}>
            <Input {...form.register('phone')} />
          </Field>
          <Field label="Email" error={form.formState.errors.email?.message}>
            <Input type="email" {...form.register('email')} />
          </Field>
          <Field label="PAN">
            <Input {...form.register('panNo')} placeholder="ABCDE1234F" />
          </Field>
          <Field label="Aadhaar">
            <Input {...form.register('aadhaarNo')} />
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <Textarea rows={2} {...form.register('address')} />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea rows={2} {...form.register('notes')} />
          </Field>
        </div>
      </FormDialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this client?"
        description={
          <>
            Bookings, payments and documents for <strong className="text-foreground">{deleting?.name}</strong> will be
            deleted too. This cannot be undone.
          </>
        }
        confirmLabel="Delete client"
        destructive
        successMessage="Client deleted."
        onConfirm={async () => {
          if (deleting) await api.delete(`/clients/${deleting.id}`);
          clients.refresh();
        }}
      />
    </>
  );
}
