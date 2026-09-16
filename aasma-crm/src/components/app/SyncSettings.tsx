import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { CheckCircle2, Cloud, Download, Github, Plug, RefreshCw, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/misc';
import { ConfirmDialog } from './ConfirmDialog';
import { ApiError, api } from '@/lib/api';
import { formatDateTime, fromNow } from '@/lib/format';
import { useSync } from '@/store/sync.store';
import { syncSettingsSchema, type SyncSettingsInput } from '@shared/schemas';

/**
 * The GitHub connection.
 *
 * Both the office and the site machines point at one JSON file in a repository.
 * Each keeps working on its own copy; syncing merges the two, record by record,
 * so nobody's entries are lost when two people work at the same time.
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
      owner: '',
      repo: '',
      branch: 'main',
      path: 'crm-data.json',
      token: '',
      autoSync: true,
      includePhotos: false,
    },
  });

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!status) return;
    form.reset({
      deviceName: status.deviceName,
      owner: status.owner,
      repo: status.repo,
      branch: status.branch || 'main',
      path: status.path || 'crm-data.json',
      token: '',
      autoSync: status.autoSync,
      includePhotos: status.includePhotos,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.owner, status?.repo, status?.branch, status?.path, status?.autoSync, status?.includePhotos]);

  const save = form.handleSubmit(async (values) => {
    try {
      await api.put('/sync/settings', values);
      toast.success('Connection saved.');
      form.setValue('token', '');
      await refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'The connection could not be saved.');
    }
  });

  const test = async (): Promise<void> => {
    const values = form.getValues();
    const parsed = syncSettingsSchema.safeParse(values);
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message ?? 'Check the repository details.');
      return;
    }
    setTesting(true);
    try {
      const result = await api.post<{ ok: boolean; exists: boolean }>('/sync/test', values);
      toast.success(
        result.exists
          ? 'Connected. A data file is already there — Sync now will merge it in.'
          : 'Connected. There is no data file yet; the first sync will create it.',
      );
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'GitHub could not be reached.');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Github className="h-4 w-4" />
            GitHub repository
          </CardTitle>
          <CardDescription>
            The office and site computers share one file in this repository. Use a private repository.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
            <Field
              label="This computer"
              hint="Shown in the GitHub history so you can tell devices apart."
              error={form.formState.errors.deviceName?.message}
            >
              <Input {...form.register('deviceName')} placeholder="Site office laptop" />
            </Field>
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
                  Shares DPR photos too. They make the file much larger and every sync slower.
                </span>
              </span>
            </label>

            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button type="submit" loading={form.formState.isSubmitting}>
                Save connection
              </Button>
              <Button type="button" variant="outline" onClick={test} loading={testing}>
                <Plug className="h-4 w-4" />
                Test connection
              </Button>
              {status?.configured ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => setDisconnecting(true)}
                >
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
            <p className="flex items-center gap-2">
              {status?.configured ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  <span className="font-medium">
                    {status.owner}/{status.repo}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">Not connected yet.</span>
              )}
            </p>
            <p className="text-muted-foreground">{status?.lastStatus}</p>
            {status?.lastSyncedAt ? (
              <p className="text-xs text-muted-foreground">
                Last synced {fromNow(status.lastSyncedAt)} • {formatDateTime(status.lastSyncedAt)}
              </p>
            ) : null}

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
          <CardHeader>
            <CardTitle>Setting this up</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            <p>1. Create a <strong className="text-foreground">private</strong> repository, for example <code>aasma-crm-data</code>.</p>
            <p>
              2. On GitHub, open Settings → Developer settings → Personal access tokens → Fine-grained tokens, and
              create one for that repository with <strong className="text-foreground">Contents: Read and write</strong>.
            </p>
            <p>3. Paste it above on each computer, then press Sync now.</p>
            <p className="border-t border-border pt-2">
              The token is stored on this computer only and is sent nowhere except github.com. Anyone who can use this
              computer profile can reach it, so use a token limited to the one data repository — never one with access
              to everything.
            </p>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={disconnecting}
        onOpenChange={setDisconnecting}
        title="Disconnect from GitHub?"
        description="The saved token is removed from this computer and syncing stops. The data already on this computer stays exactly as it is."
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
