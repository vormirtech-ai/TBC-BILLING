import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Banknote,
  CalendarDays,
  FileText,
  Home,
  MessageSquarePlus,
  Phone,
  Plus,
  Mail,
} from 'lucide-react';
import { PageHeader } from '@/components/app/PageHeader';
import { FormDialog } from '@/components/app/FormDialog';
import { StatusBadge } from '@/components/app/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useResource } from '@/hooks/useResource';
import { ApiError, api } from '@/lib/api';
import { formatDate, formatDateTime, money, today } from '@/lib/format';
import { INTERACTION_TYPES, PAYMENT_MODES, humanize } from '@shared/constants';
import { interactionSchema, paymentSchema, type PaymentInput } from '@shared/schemas';

interface TimelineEntry {
  at: string;
  type: string;
  title: string;
  detail: string;
}

interface ClientFile {
  client: {
    id: number;
    name: string;
    phone: string;
    email: string | null;
    address: string | null;
    panNo: string | null;
    createdAt: string;
  };
  bookings: {
    id: number;
    bookingDate: string;
    agreementValue: number;
    bookingAmount: number;
    status: string;
    agreementNo: string | null;
    property?: { tower: string; unit: string } | null;
    project?: { name: string } | null;
  }[];
  payments: { id: number; amount: number; mode: string; paidOn: string; reference: string | null }[];
  documents: { id: number; title: string; category: string; uploadedAt: string }[];
  timeline: TimelineEntry[];
  totals: { agreementValue: number; collected: number; outstanding: number };
}

export function ClientDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const clientId = Number(id);

  const file = useResource<ClientFile>((signal) => api.get(`/clients/${clientId}/timeline`, undefined, signal), [clientId]);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);

  const paymentForm = useForm<PaymentInput>({
    resolver: zodResolver(paymentSchema),
    defaultValues: { clientId, amount: 0, mode: 'BANK', paidOn: today(), reference: '', notes: '' },
  });

  const noteForm = useForm<{ type: string; detail: string; happenedOn: string; clientId: number }>({
    resolver: zodResolver(interactionSchema),
    defaultValues: { clientId, type: 'NOTE', detail: '', happenedOn: today() },
  });

  const savePayment = paymentForm.handleSubmit(async (values) => {
    try {
      await api.post('/payments', { ...values, clientId });
      toast.success('Payment recorded.');
      setPaymentOpen(false);
      paymentForm.reset({ clientId, amount: 0, mode: 'BANK', paidOn: today(), reference: '', notes: '' });
      file.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'The payment could not be saved.');
    }
  });

  const saveNote = noteForm.handleSubmit(async (values) => {
    try {
      await api.post(`/clients/${clientId}/interactions`, values);
      toast.success('Interaction added.');
      setNoteOpen(false);
      noteForm.reset({ clientId, type: 'NOTE', detail: '', happenedOn: today() });
      file.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'The note could not be saved.');
    }
  });

  if (file.loading && !file.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  }

  if (file.error || !file.data) {
    return (
      <Card>
        <CardContent className="space-y-3 p-8 text-center">
          <p className="text-sm text-muted-foreground">{file.error ?? 'This client could not be found.'}</p>
          <Button variant="outline" onClick={() => navigate('/clients')}>
            Back to clients
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { client, bookings, payments, documents, timeline, totals } = file.data;

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => navigate('/clients')} className="-ml-2 text-muted-foreground">
        <ArrowLeft className="h-4 w-4" />
        All clients
      </Button>

      <PageHeader
        title={client.name}
        description={`Client since ${formatDate(client.createdAt)}`}
        actions={
          <>
            <Button variant="outline" onClick={() => setNoteOpen(true)}>
              <MessageSquarePlus className="h-4 w-4" />
              Log interaction
            </Button>
            <Button onClick={() => setPaymentOpen(true)}>
              <Plus className="h-4 w-4" />
              Record payment
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="space-y-2 p-5 text-sm">
            <p className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground" />
              {client.phone}
            </p>
            <p className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              {client.email ?? '—'}
            </p>
            <p className="flex items-start gap-2">
              <Home className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground">{client.address ?? 'No address on file'}</span>
            </p>
            {client.panNo ? <p className="text-xs text-muted-foreground">PAN {client.panNo}</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-1 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agreement value</p>
            <p className="tabular text-2xl font-bold">{money(totals.agreementValue, { compact: true })}</p>
            <p className="text-xs text-muted-foreground">{bookings.length} booking(s)</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-1 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Collected</p>
            <p className="tabular text-2xl font-bold text-success">{money(totals.collected, { compact: true })}</p>
            <p className="text-xs text-muted-foreground">{payments.length} payment(s)</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-1 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Outstanding</p>
            <p className={`tabular text-2xl font-bold ${totals.outstanding > 0 ? 'text-destructive' : ''}`}>
              {money(totals.outstanding, { compact: true })}
            </p>
            <p className="text-xs text-muted-foreground">
              {totals.agreementValue > 0
                ? `${Math.round((totals.collected / totals.agreementValue) * 100)}% received`
                : 'No booking yet'}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="timeline">
        <TabsList>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="bookings">Bookings</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        <TabsContent value="timeline">
          <Card>
            <CardContent className="p-5">
              {timeline.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Nothing recorded yet.</p>
              ) : (
                <ol className="relative space-y-5 border-l border-border pl-6">
                  {timeline.map((entry, index) => (
                    <li key={`${entry.at}-${index}`} className="relative">
                      <span className="absolute -left-[1.72rem] top-1.5 flex h-3 w-3 items-center justify-center rounded-full border-2 border-card bg-primary" />
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium">{entry.title}</p>
                        <span className="text-xs text-muted-foreground">{formatDateTime(entry.at)}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{entry.detail}</p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bookings">
          <Card>
            <CardHeader>
              <CardTitle>Bookings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {bookings.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No bookings yet.</p>
              ) : (
                bookings.map((booking) => (
                  <div
                    key={booking.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-4"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">
                        {booking.property ? `${booking.property.tower}-${booking.property.unit}` : 'Unit'}
                        <span className="ml-2 text-sm text-muted-foreground">{booking.project?.name}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <CalendarDays className="mr-1 inline h-3 w-3" />
                        Booked {formatDate(booking.bookingDate)}
                        {booking.agreementNo ? ` • ${booking.agreementNo}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="tabular font-semibold">{money(booking.agreementValue)}</p>
                        <p className="text-xs text-muted-foreground">
                          Booking amount {money(booking.bookingAmount, { compact: true })}
                        </p>
                      </div>
                      <StatusBadge status={booking.status} />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Payments</CardTitle>
              <Button size="sm" variant="outline" onClick={() => setPaymentOpen(true)}>
                <Banknote className="h-4 w-4" />
                Record payment
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {payments.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No payments recorded.</p>
              ) : (
                payments.map((payment) => (
                  <div
                    key={payment.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border px-4 py-3"
                  >
                    <div>
                      <p className="tabular font-semibold">{money(payment.amount)}</p>
                      <p className="text-xs text-muted-foreground">
                        {humanize(payment.mode)}
                        {payment.reference ? ` • ${payment.reference}` : ''}
                      </p>
                    </div>
                    <span className="text-sm text-muted-foreground">{formatDate(payment.paidOn)}</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents">
          <Card>
            <CardContent className="p-5">
              {documents.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No documents attached. Agreements and KYC copies stored on this machine will appear here.
                </p>
              ) : (
                <ul className="space-y-2">
                  {documents.map((document) => (
                    <li key={document.id} className="flex items-center gap-3 rounded-md border border-border px-4 py-3">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="flex-1 truncate text-sm">{document.title}</span>
                      <StatusBadge status={document.category} />
                      <span className="text-xs text-muted-foreground">{formatDate(document.uploadedAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <FormDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        title="Record payment"
        description={`Against ${client.name}'s account.`}
        onSubmit={savePayment}
        submitting={paymentForm.formState.isSubmitting}
        submitLabel="Save payment"
        size="sm"
      >
        <div className="space-y-4">
          <Field label="Amount" required error={paymentForm.formState.errors.amount?.message}>
            <Input type="number" min={1} step={1} {...paymentForm.register('amount')} />
          </Field>
          <Field label="Mode">
            <SimpleSelect
              value={paymentForm.watch('mode') ?? 'BANK'}
              onChange={(value) => paymentForm.setValue('mode', value as PaymentInput['mode'])}
              options={PAYMENT_MODES.map((mode) => ({ value: mode, label: humanize(mode) }))}
            />
          </Field>
          <Field label="Paid on" required error={paymentForm.formState.errors.paidOn?.message}>
            <Input type="date" {...paymentForm.register('paidOn')} />
          </Field>
          <Field label="Reference">
            <Input {...paymentForm.register('reference')} placeholder="Cheque or transaction number" />
          </Field>
          <Field label="Notes">
            <Textarea rows={2} {...paymentForm.register('notes')} />
          </Field>
        </div>
      </FormDialog>

      <FormDialog
        open={noteOpen}
        onOpenChange={setNoteOpen}
        title="Log an interaction"
        onSubmit={saveNote}
        submitting={noteForm.formState.isSubmitting}
        submitLabel="Add to timeline"
        size="sm"
      >
        <div className="space-y-4">
          <Field label="Type">
            <SimpleSelect
              value={noteForm.watch('type')}
              onChange={(value) => noteForm.setValue('type', value)}
              options={INTERACTION_TYPES.map((type) => ({ value: type, label: humanize(type) }))}
            />
          </Field>
          <Field label="Date">
            <Input type="date" {...noteForm.register('happenedOn')} />
          </Field>
          <Field label="Detail" required error={noteForm.formState.errors.detail?.message}>
            <Textarea rows={4} {...noteForm.register('detail')} placeholder="What was discussed or agreed?" />
          </Field>
        </div>
      </FormDialog>
    </>
  );
}
