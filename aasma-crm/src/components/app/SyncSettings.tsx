import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { CheckCircle2, Cloud, Copy, Database, Download, Github, Plug, RefreshCw, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/misc';
import { ConfirmDialog } from './ConfirmDialog';
import { ApiError, api } from '@/lib/api';
import { formatDateTime, fromNow } from '@/lib/format';
import { useSync } from '@/store/sync.store';
import { cn } from '@/lib/utils';
import { syncSettingsSchema, type SyncSettingsInput } from '@shared/schemas';

/** The table the Supabase option needs, ready to paste into the SQL editor. */
const SETUP_SQL = `create table if not exists crm_documents (
  id          text primary key,
  version     bigint not null default 1,
  document    jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

alter table crm_documents enable row level security;

create policy "crm_documents read"   on crm_documents for select using (true);
create policy "crm_documents insert" on crm_documents for insert with check (true);
create policy "crm_documents update" on crm_documents for update using (true) with check (true);`;

/**
 * The connection to the shared data.
 *
 * Every computer keeps working on its own copy; syncing merges that copy with a
 * single shared document, record by record. That document can live in Supabase
 * (one row in a table) or in a private GitHub repository (one JSON file).
 */
export function SyncSettings(): JSX.Element {
  const status = useSync((state) => state.status);
  const busy = useSync((state) => state.busy);
  const refresh = useSync((state) => state.refresh);
  const run = useSync((state) => state.run);
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const form = useForm<SyncSettingsInput>({
    resolver: zodResolver(syncSettingsSchema),
    defaultValues: {
      deviceName: '',
      provider: 'supabase',
      owner: '',
      repo: '',
      branch: 'main',
      path: 'crm-data.json',
      token: '',
      supabaseUrl: '',
      supabaseKey: '',
      supabaseTable: 'crm_documents',
      documentId: 'aasma-crm',
      autoSync: true,
      includePhotos: false,
    },
  });

  const provider = form.watch('provider') ?? 'supabase';

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!status) return;
    form.reset({
      deviceName: status.deviceName,
      provider: status.provider ?? 'supabase',
      owner: status.owner,
      repo: status.repo,
      branch: status.branch || 'main',
      path: status.path || 'crm-data.json',
      token: '',
      supabaseUrl: status.supabaseUrl ?? '',
      supabaseKey: '',
      supabaseTable: status.supabaseTable || 'crm_documents',
      documentId: status.documentId || 'aasma-crm',
      autoSync: status.autoSync,
      includePhotos: status.includePhotos,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.provider, status?.owner, status?.repo, status?.supabaseUrl, status?.supabaseTable, status?.autoSync]);

  const save = form.handleSubmit(async (values) => {
    try {
      await api.put('/sync/settings', values);
      toast.success('Connection saved.');
      form.setValue('token', '');
      form.setValue('supabaseKey', '');
      await refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'The connection could not be saved.');
    }
  });

  const test = async (): Promise<void> => {
    const values = form.getValues();
    const parsed = syncSettingsSchema.safeParse(values);
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message ?? 'Check the connection details.');
      return;
    }
    setTesting(true);
    try {
      const result = await api.post<{ ok: boolean; exists: boolean }>('/sync/test', values);
      toast.success(
        result.exists
          ? 'Connected. Shared data is already there — Sync now will merge it in.'
          : 'Connected. There is no shared data yet; the first sync will create it.',
      );
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'The service could not be reached.');
    } finally {
      setTesting(false);
    }
  };

  const copySql = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(SETUP_SQL);
      toast.success('SQL copied. Paste it into the Supabase SQL editor and run it.');
    } catch {
      toast.error('Could not copy — select the text and copy it by hand.');
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {provider === 'supabase' ? <Database className="h-4 w-4" /> : <Github className="h-4 w-4" />}
            Shared data
          </CardTitle>
          <CardDescription>
            Every computer keeps its own offline copy. Syncing merges them through one shared document.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="space-y-4" noValidate>
            {/* --- where the shared document lives --- */}
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  { value: 'supabase', label: 'Supabase', hint: 'A row in a table. Fastest, and a real database.' },
                  { value: 'github', label: 'GitHub', hint: 'A JSON file in a private repository.' },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => form.setValue('provider', option.value)}
                  className={cn(
                    'rounded-md border p-3 text-left transition-colors',
                    provider === option.value
                      ? 'border-primary bg-accent text-accent-foreground'
                      : 'border-border hover:bg-muted',
                  )}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    {option.value === 'supabase' ? <Database className="h-4 w-4" /> : <Github className="h-4 w-4" />}
                    {option.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{option.hint}</span>
                </button>
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="This computer"
                hint="Recorded with each change so you can tell devices apart."
                error={form.formState.errors.deviceName?.message}
              >
                <Input {...form.register('deviceName')} placeholder="Site office laptop" />
              </Field>

              {provider === 'supabase' ? (
                <>
                  <Field label="Record name" required error={form.formState.errors.documentId?.message}>
                    <Input {...form.register('documentId')} placeholder="aasma-crm" />
                  </Field>
                  <Field label="Project URL" required error={form.formState.errors.supabaseUrl?.message}>
                    <Input {...form.register('supabaseUrl')} placeholder="https://abcdefgh.supabase.co" />
                  </Field>
                  <Field label="Table" required error={form.formState.errors.supabaseTable?.message}>
                    <Input {...form.register('supabaseTable')} placeholder="crm_documents" />
                  </Field>
                  <Field
                    label="Anon key"
                    className="sm:col-span-2"
                    hint={
                      status?.hasKey
                        ? 'A key is saved on this computer. Leave blank to keep it, or paste a new one to replace it.'
                        : 'Project Settings → API → Project API keys → anon public.'
                    }
                    error={form.formState.errors.supabaseKey?.message}
                  >
                    <Input
                      type="password"
                      autoComplete="off"
                      {...form.register('supabaseKey')}
                      placeholder={status?.hasKey ? '•••••••••••••••• (saved)' : 'eyJhbGciOi…'}
                    />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="Branch" required error={form.formState.errors.branch?.message}>
                    <Input {...form.register('branch')} placeholder="main" />
                  </Field>
                  <Field label="Owner" required error={form.formState.errors.owner?.message}>
                    <Input {...form.register('owner')} placeholder="your-github-username" />
                  </Field>
                  <Field label="Repository" required error={form.formState.errors.repo?.message}>
                    <Input {...form.register('repo')} placeholder="aasma-crm-data" />
                  </Field>
                  <Field
                    label="File path"
                    required
                    className="sm:col-span-2"
                    hint="Created automatically on the first sync."
                    error={form.formState.errors.path?.message}
                  >
                    <Input {...form.register('path')} placeholder="crm-data.json" />
                  </Field>
                  <Field
                    label="Access token"
                    className="sm:col-span-2"
                    hint={
                      status?.hasToken
                        ? 'A token is saved on this computer. Leave blank to keep it, or paste a new one to replace it.'
                        : 'Fine-grained personal access token with Contents: read and write on this repository.'
                    }
                    error={form.formState.errors.token?.message}
                  >
                    <Input
                      type="password"
                      autoComplete="off"
                      {...form.register('token')}
                      placeholder={status?.hasToken ? '•••••••••••••••• (saved)' : 'github_pat_…'}
                    />
                  </Field>
                </>
              )}

              <label className="flex items-center gap-3 rounded-md border border-border p-3 text-sm">
                <Switch
                  checked={Boolean(form.watch('autoSync'))}
                  onCheckedChange={(checked) => form.setValue('autoSync', checked)}
                />
                <span>
                  Sync automatically
                  <span className="block text-xs text-muted-foreground">
                    On sign-in, when this window is reopened, and every five minutes.
                  </span>
                </span>
              </label>

              <label className="flex items-center gap-3 rounded-md border border-border p-3 text-sm">
                <Switch
                  checked={Boolean(form.watch('includePhotos'))}
                  onCheckedChange={(checked) => form.setValue('includePhotos', checked)}
                />
                <span>
                  Include site photos
                  <span className="block text-xs text-muted-foreground">
                    Shares DPR photos too. They make every sync slower.
                  </span>
                </span>
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={form.formState.isSubmitting}>
                Save connection
              </Button>
              <Button type="button" variant="outline" onClick={test} loading={testing}>
                <Plug className="h-4 w-4" />
                Test connection
              </Button>
              {status?.configured ? (
                <Button type="button" variant="ghost" className="text-destructive" onClick={() => setDisconnecting(true)}>
                  Disconnect
                </Button>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cloud className="h-4 w-4" />
              Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {status?.configured ? (
              <>
                <p className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                  <span className="break-all font-medium">{status.target}</span>
                </p>
                <p className="text-muted-foreground">{status.lastStatus}</p>
                {status.lastSyncedAt ? (
                  <p className="text-xs text-muted-foreground">
                    Last synced {fromNow(status.lastSyncedAt)} • {formatDateTime(status.lastSyncedAt)}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-muted-foreground">
                Not connected yet. Fill in the details on the left, save, then press Sync now.
              </p>
            )}

            <div className="grid gap-2 pt-1">
              <Button disabled={!status?.configured || busy} loading={busy} onClick={() => void run('now')}>
                <RefreshCw className="h-4 w-4" />
                Sync now
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" disabled={!status?.configured || busy} onClick={() => void run('pull')}>
                  <Download className="h-4 w-4" />
                  Pull
                </Button>
                <Button variant="outline" disabled={!status?.configured || busy} onClick={() => void run('push')}>
                  <Upload className="h-4 w-4" />
                  Push
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <CardTitle>Setting this up</CardTitle>
            {provider === 'supabase' ? (
              <Button size="sm" variant="outline" onClick={copySql}>
                <Copy className="h-4 w-4" />
                Copy SQL
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            {provider === 'supabase' ? (
              <>
                <p>
                  1. Create a project at <strong className="text-foreground">supabase.com</strong> (the free tier is
                  plenty).
                </p>
                <p>
                  2. Open the <strong className="text-foreground">SQL editor</strong>, paste the SQL from the button
                  above and run it. That creates the table this uses.
                </p>
                <p>
                  3. In <strong className="text-foreground">Project Settings → API</strong>, copy the Project URL and
                  the <strong className="text-foreground">anon public</strong> key into the form.
                </p>
                <p>4. Press Test connection, then Save, then Sync now. Repeat on each computer.</p>
                <p className="border-t border-border pt-2">
                  Treat that key like a password: with the policies above, anyone holding it can read and write this
                  table. It is stored on this computer only. Rotate it in Supabase if a laptop is lost.
                </p>
              </>
            ) : (
              <>
                <p>
                  1. Create a <strong className="text-foreground">private</strong> repository, for example{' '}
                  <code>aasma-crm-data</code>. Ticking “Add a README file” is the easiest start.
                </p>
                <p>
                  2. On GitHub, open Settings → Developer settings → Personal access tokens → Fine-grained tokens, and
                  create one for that repository with <strong className="text-foreground">Contents: Read and write</strong>.
                </p>
                <p>3. Paste it above on each computer, then press Sync now.</p>
                <p className="border-t border-border pt-2">
                  The token is stored on this computer only and is sent nowhere except github.com. Use a token limited
                  to the one data repository — never one with access to everything.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={disconnecting}
        onOpenChange={setDisconnecting}
        title="Disconnect this computer?"
        description="The saved credential is removed from this computer and syncing stops. The data already here stays exactly as it is."
        confirmLabel="Disconnect"
        destructive
        successMessage="Disconnected."
        onConfirm={async () => {
          await api.delete('/sync');
          await refresh();
        }}
      />
    </div>
  );
}
