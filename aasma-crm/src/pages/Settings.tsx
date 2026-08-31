import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  Building2,
  DatabaseBackup,
  Download,
  FolderOpen,
  HardDrive,
  KeyRound,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { PageHeader } from '@/components/app/PageHeader';
import { ConfirmDialog } from '@/components/app/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useResource } from '@/hooks/useResource';
import { ApiError, LOCAL_MODE, api, downloadFile } from '@/lib/api';
import { bytes, formatDateTime } from '@/lib/format';
import { setCurrencySymbol } from '@/lib/format';
import { useAuth } from '@/store/auth.store';
import { changePasswordSchema, settingsSchema, type ChangePasswordInput, type SettingsInput } from '@shared/schemas';
import type { BackupFile } from '@shared/types';

/** The desktop bridge exposed by Electron's preload script, when running there. */
interface AasmaBridge {
  isDesktop: boolean;
  info: () => Promise<{ version: string; platform: string; dataFolder: string; apiUrl: string }>;
  openFolder: (kind: 'data' | 'backups' | 'reports' | 'uploads') => Promise<{ ok: boolean; error: string }>;
  restart: () => Promise<void>;
}

declare global {
  interface Window {
    aasma?: AasmaBridge;
  }
}

export function SettingsPage(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const user = useAuth((state) => state.user);
  const tab = params.get('tab') ?? 'company';

  const settings = useResource<SettingsInput>((signal) => api.get('/settings', undefined, signal));
  const backups = useResource<{ folder: string; files: BackupFile[] }>((signal) =>
    api.get('/backups', undefined, signal),
  );

  const [desktop, setDesktop] = useState<{ version: string; platform: string; dataFolder: string } | null>(null);
  const [restoring, setRestoring] = useState<BackupFile | null>(null);
  const [removing, setRemoving] = useState<BackupFile | null>(null);
  const [backingUp, setBackingUp] = useState(false);

  useEffect(() => {
    window.aasma?.info().then(setDesktop).catch(() => undefined);
  }, []);

  const companyForm = useForm<SettingsInput>({ resolver: zodResolver(settingsSchema) });
  const passwordForm = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  useEffect(() => {
    if (settings.data) companyForm.reset(settings.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.data]);

  const saveCompany = companyForm.handleSubmit(async (values) => {
    try {
      const saved = await api.put<SettingsInput>('/settings', values);
      setCurrencySymbol(String(saved.currency ?? '₹'));
      toast.success('Company details saved.');
      settings.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Settings could not be saved.');
    }
  });

  const changePassword = passwordForm.handleSubmit(async (values) => {
    try {
      await api.post('/auth/change-password', values);
      toast.success('Password changed.');
      passwordForm.reset({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'The password could not be changed.');
    }
  });

  const createBackup = async (): Promise<void> => {
    setBackingUp(true);
    try {
      const file = await api.post<BackupFile>('/backups');
      toast.success(`Backup created: ${file.name}`);
      backups.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'The backup could not be created.');
    } finally {
      setBackingUp(false);
    }
  };

  const uploadBackup = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return;
    const body = new FormData();
    body.append('backup', files[0]);
    try {
      await api.upload('/backups/upload', body);
      toast.success('Backup file added. Choose Restore to load it.');
      backups.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'The file could not be uploaded.');
    }
  };

  return (
    <>
      <PageHeader title="Settings" description="Company details, security and your local database." />

      <Tabs value={tab} onValueChange={(value) => setParams({ tab: value })}>
        <TabsList>
          <TabsTrigger value="company">
            <Building2 className="h-4 w-4" />
            Company
          </TabsTrigger>
          <TabsTrigger value="security">
            <KeyRound className="h-4 w-4" />
            Security
          </TabsTrigger>
          <TabsTrigger value="backup">
            <DatabaseBackup className="h-4 w-4" />
            Backup &amp; restore
          </TabsTrigger>
          <TabsTrigger value="about">
            <HardDrive className="h-4 w-4" />
            About
          </TabsTrigger>
        </TabsList>

        <TabsContent value="company">
          <Card>
            <CardHeader>
              <CardTitle>Company details</CardTitle>
              <CardDescription>These appear on every exported report.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={saveCompany} className="grid gap-4 sm:grid-cols-2" noValidate>
                <Field label="Company name" required error={companyForm.formState.errors.companyName?.message}>
                  <Input {...companyForm.register('companyName')} />
                </Field>
                <Field label="GST number">
                  <Input {...companyForm.register('gstNo')} />
                </Field>
                <Field label="Phone">
                  <Input {...companyForm.register('companyPhone')} />
                </Field>
                <Field label="Email" error={companyForm.formState.errors.companyEmail?.message}>
                  <Input type="email" {...companyForm.register('companyEmail')} />
                </Field>
                <Field label="Address" className="sm:col-span-2">
                  <Input {...companyForm.register('companyAddress')} />
                </Field>
                <Field label="Currency symbol" error={companyForm.formState.errors.currency?.message}>
                  <Input {...companyForm.register('currency')} className="w-24" />
                </Field>
                <Field
                  label="Follow-up reminder (days)"
                  hint="How far ahead the dashboard flags an upcoming follow-up."
                  error={companyForm.formState.errors.followUpReminderDays?.message}
                >
                  <Input type="number" min={0} max={30} {...companyForm.register('followUpReminderDays')} />
                </Field>

                <label className="flex items-center gap-3 rounded-md border border-border p-3 text-sm sm:col-span-2">
                  <Switch
                    checked={Boolean(companyForm.watch('lowStockAlerts'))}
                    onCheckedChange={(checked) => companyForm.setValue('lowStockAlerts', checked)}
                  />
                  <span>
                    Low stock alerts
                    <span className="block text-xs text-muted-foreground">
                      Warn on the dashboard when a material drops to its reorder level.
                    </span>
                  </span>
                </label>

                <div className="sm:col-span-2">
                  <Button type="submit" loading={companyForm.formState.isSubmitting}>
                    Save details
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Change password</CardTitle>
                <CardDescription>
                  Signed in as {user?.fullName} (@{user?.username}).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={changePassword} className="space-y-4" noValidate>
                  <Field label="Current password" required error={passwordForm.formState.errors.currentPassword?.message}>
                    <Input type="password" autoComplete="current-password" {...passwordForm.register('currentPassword')} />
                  </Field>
                  <Field
                    label="New password"
                    required
                    hint="At least 8 characters, with a letter and a number."
                    error={passwordForm.formState.errors.newPassword?.message}
                  >
                    <Input type="password" autoComplete="new-password" {...passwordForm.register('newPassword')} />
                  </Field>
                  <Field label="Confirm new password" required error={passwordForm.formState.errors.confirmPassword?.message}>
                    <Input type="password" autoComplete="new-password" {...passwordForm.register('confirmPassword')} />
                  </Field>
                  <Button type="submit" loading={passwordForm.formState.isSubmitting}>
                    Update password
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>How your data is protected</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>
                  Passwords are stored as bcrypt hashes — the password itself is never written to the database and cannot
                  be read back out of it.
                </p>
                <p>
                  {LOCAL_MODE
                    ? 'This build runs entirely inside your browser, so no data ever leaves this computer. With no server involved, the sign-in screen is a convenience lock on a shared desktop rather than a security boundary — anyone with access to this computer profile can reach the stored data.'
                    : "The application listens only on this machine's loopback address, so nothing on the office network or the internet can reach it."}
                </p>
                <p>
                  Every value entered is validated before it is saved, and all database access is parameterised, so a
                  pasted value can never be executed as a query.
                </p>
                <p>Take a backup before month end, and keep a copy on a separate drive.</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="backup">
          <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle>Backups</CardTitle>
                  <CardDescription className="break-all">{backups.data?.folder}</CardDescription>
                </div>
                <Button onClick={createBackup} loading={backingUp}>
                  <DatabaseBackup className="h-4 w-4" />
                  Back up now
                </Button>
              </CardHeader>
              <CardContent className="space-y-2">
                {(backups.data?.files ?? []).length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No backups yet. One click above creates a complete copy of the database.
                  </p>
                ) : (
                  (backups.data?.files ?? []).map((file) => (
                    <div
                      key={file.name}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{file.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDateTime(file.createdAt)} • {bytes(file.size)}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            downloadFile(`/backups/${file.name}/download`).catch(() =>
                              toast.error('The backup could not be downloaded.'),
                            )
                          }
                        >
                          <Download className="h-4 w-4" />
                          Save copy
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setRestoring(file)}>
                          <RotateCcw className="h-4 w-4" />
                          Restore
                        </Button>
                        <Button size="icon" variant="ghost" className="text-destructive" onClick={() => setRemoving(file)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Restore from a file</CardTitle>
                  <CardDescription>
                    {LOCAL_MODE
                      ? 'Bring in a CRM_Backup_*.json file exported from another browser or computer.'
                      : 'Bring in a CRM_Backup_*.db file from another machine or a pen drive.'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Input
                    type="file"
                    accept={LOCAL_MODE ? '.json' : '.db'}
                    onChange={(event) => uploadBackup(event.target.files)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Uploading only adds the file to the backup folder. Choose Restore next to it when you are ready.
                  </p>
                </CardContent>
              </Card>

              {window.aasma?.isDesktop ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Folders</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-2">
                    {(['data', 'backups', 'reports', 'uploads'] as const).map((kind) => (
                      <Button
                        key={kind}
                        variant="outline"
                        className="justify-start"
                        onClick={() => window.aasma?.openFolder(kind)}
                      >
                        <FolderOpen className="h-4 w-4" />
                        Open {kind} folder
                      </Button>
                    ))}
                  </CardContent>
                </Card>
              ) : null}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="about">
          <Card>
            <CardHeader>
              <CardTitle>Aasma Buildcon CRM</CardTitle>
              <CardDescription>Offline CRM and construction ERP for Aasma Construction.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Version</dt>
                  <dd>{desktop?.version ?? '1.0.0'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Running as</dt>
                  <dd>
                    {desktop
                      ? `Desktop application (${desktop.platform})`
                      : LOCAL_MODE
                        ? 'Hosted web app — data stored in this browser'
                        : 'Browser'}
                  </dd>
                </div>
                {desktop ? (
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Data folder</dt>
                    <dd className="break-all">{desktop.dataFolder}</dd>
                  </div>
                ) : null}
              </dl>
              <p className="border-t border-border pt-3 text-muted-foreground">
                {LOCAL_MODE
                  ? 'Everything — leads, clients, units, stock, attendance, daily reports and forecasts — is stored in this browser on this computer. Nothing is sent to a server, and the app keeps working with no connection once it has been opened. Take a backup and keep the file somewhere safe.'
                  : 'Everything — leads, clients, units, stock, attendance, daily reports and forecasts — is stored in a single SQLite file on this machine. No internet connection is required at any point.'}
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={Boolean(restoring)}
        onOpenChange={(open) => !open && setRestoring(null)}
        title="Restore this backup?"
        description={
          <>
            The current database will be replaced with <strong className="text-foreground">{restoring?.name}</strong>. A
            safety copy of today's data is taken first, and the application will restart.
          </>
        }
        confirmLabel="Restore and restart"
        destructive
        onConfirm={async () => {
          if (!restoring) return;
          await api.post(`/backups/${restoring.name}/restore`);
          toast.success('Backup restored. Restarting…');
          setTimeout(() => {
            if (window.aasma?.restart) void window.aasma.restart();
            else window.location.reload();
          }, 1200);
        }}
      />

      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Delete this backup file?"
        description={`${removing?.name} will be permanently removed from the backups folder.`}
        confirmLabel="Delete backup"
        destructive
        successMessage="Backup deleted."
        onConfirm={async () => {
          if (removing) await api.delete(`/backups/${removing.name}`);
          backups.refresh();
        }}
      />
    </>
  );
}
