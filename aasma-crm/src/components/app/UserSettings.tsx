import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Pencil, Plus, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { Switch, Skeleton } from '@/components/ui/misc';
import { FormDialog } from './FormDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { useResource } from '@/hooks/useResource';
import { ApiError, api } from '@/lib/api';
import { formatDate, fromNow } from '@/lib/format';
import { useAuth } from '@/store/auth.store';
import { USER_ROLES } from '@shared/constants';
import { roleLabel } from '@shared/permissions';
import { userSchema } from '@shared/schemas';

interface Account {
  id: number;
  username: string;
  fullName: string;
  role: string;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

type AccountForm = {
  username: string;
  fullName: string;
  role: string;
  password?: string;
  active: boolean;
};

/**
 * Accounts and what each one may open.
 *
 * An administrator runs the property book and its prices; a user account works
 * the site — leads, clients, projects, stock, labour and daily reports — and
 * never sees unit listings or prices.
 */
export function UserSettings(): JSX.Element {
  const me = useAuth((state) => state.user);
  const accounts = useResource<Account[]>((signal) => api.get('/users', undefined, signal));
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [removing, setRemoving] = useState<Account | null>(null);

  const form = useForm<AccountForm>({
    resolver: zodResolver(userSchema),
    defaultValues: { username: '', fullName: '', role: 'USER', password: '', active: true },
  });

  const openCreate = (): void => {
    setEditing(null);
    form.reset({ username: '', fullName: '', role: 'USER', password: '', active: true });
    setOpen(true);
  };

  const openEdit = (account: Account): void => {
    setEditing(account);
    form.reset({
      username: account.username,
      fullName: account.fullName,
      role: account.role,
      password: '',
      active: account.active,
    });
    setOpen(true);
  };

  const save = form.handleSubmit(async (values) => {
    try {
      const payload = { ...values, password: values.password ? values.password : undefined };
      if (editing) await api.put(`/users/${editing.id}`, payload);
      else await api.post('/users', payload);
      toast.success(editing ? 'Account updated.' : 'Account created.');
      setOpen(false);
      accounts.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'The account could not be saved.');
    }
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>Accounts</CardTitle>
            <CardDescription>Who can sign in on the computers sharing this data.</CardDescription>
          </div>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Add account
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {accounts.loading && !accounts.data ? (
            <div className="space-y-2">
              {[0, 1].map((index) => (
                <Skeleton key={index} className="h-14" />
              ))}
            </div>
          ) : (
            (accounts.data ?? []).map((account) => (
              <div
                key={account.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-full ${
                      account.role === 'ADMIN' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {account.role === 'ADMIN' ? <ShieldCheck className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {account.fullName}
                      {account.id === me?.id ? <span className="ml-2 text-xs text-muted-foreground">(you)</span> : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      @{account.username} • added {formatDate(account.createdAt)}
                      {account.lastLoginAt ? ` • last signed in ${fromNow(account.lastLoginAt)}` : ' • never signed in'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={account.role === 'ADMIN' ? 'default' : 'secondary'}>{roleLabel(account.role)}</Badge>
                  {!account.active ? <Badge variant="muted">Disabled</Badge> : null}
                  <Button size="icon" variant="ghost" onClick={() => openEdit(account)} aria-label="Edit account">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-destructive"
                    disabled={account.id === me?.id}
                    onClick={() => setRemoving(account)}
                    aria-label="Delete account"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What each role can open</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-4 font-semibold">Area</th>
                  <th className="py-2 pr-4 font-semibold">Administrator</th>
                  <th className="py-2 font-semibold">User</th>
                </tr>
              </thead>
              <tbody className="[&_td]:py-2 [&_td]:pr-4">
                {[
                  ['Dashboard, leads, clients', 'Yes', 'Yes'],
                  ['Projects, inventory, labour, DPR', 'Yes', 'Yes'],
                  ['Properties: unit listing and map', 'Yes', 'No'],
                  ['Property prices and inventory value', 'Yes', 'No'],
                  ['Property report', 'Yes', 'No'],
                  ['Accounts and GitHub sync settings', 'Yes', 'No'],
                ].map(([area, admin, user]) => (
                  <tr key={area} className="border-b border-border last:border-0">
                    <td>{area}</td>
                    <td className="font-medium text-success">{admin}</td>
                    <td className={user === 'Yes' ? 'font-medium text-success' : 'font-medium text-muted-foreground'}>
                      {user}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={editing ? 'Edit account' : 'Add account'}
        description={editing ? undefined : 'The person signs in with this username on their own computer.'}
        onSubmit={save}
        submitting={form.formState.isSubmitting}
        submitLabel={editing ? 'Save changes' : 'Create account'}
        size="sm"
      >
        <div className="space-y-4">
          <Field label="Full name" required error={form.formState.errors.fullName?.message}>
            <Input {...form.register('fullName')} placeholder="Sunita Rane" />
          </Field>
          <Field label="Username" required error={form.formState.errors.username?.message}>
            <Input {...form.register('username')} placeholder="sunita" autoComplete="off" />
          </Field>
          <Field label="Role">
            <SimpleSelect
              value={form.watch('role')}
              onChange={(value) => form.setValue('role', value)}
              options={USER_ROLES.map((role) => ({ value: role, label: roleLabel(role) }))}
            />
          </Field>
          <Field
            label={editing ? 'New password' : 'Password'}
            required={!editing}
            hint={editing ? 'Leave blank to keep the current password.' : 'At least 8 characters.'}
            error={form.formState.errors.password?.message}
          >
            <Input type="password" autoComplete="new-password" {...form.register('password')} />
          </Field>
          <label className="flex items-center gap-3 rounded-md border border-border p-3 text-sm">
            <Switch
              checked={Boolean(form.watch('active'))}
              onCheckedChange={(checked) => form.setValue('active', checked)}
            />
            <span>
              Account is active
              <span className="block text-xs text-muted-foreground">Turn off to block sign-in without deleting.</span>
            </span>
          </label>
        </div>
      </FormDialog>

      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(value) => !value && setRemoving(null)}
        title="Delete this account?"
        description={
          <>
            <strong className="text-foreground">{removing?.fullName}</strong> will no longer be able to sign in. Records
            they entered stay exactly as they are.
          </>
        }
        confirmLabel="Delete account"
        destructive
        successMessage="Account deleted."
        onConfirm={async () => {
          if (removing) await api.delete(`/users/${removing.id}`);
          accounts.refresh();
        }}
      />
    </div>
  );
}
