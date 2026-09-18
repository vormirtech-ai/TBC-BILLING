import { useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, DatabaseBackup, Eraser } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ApiError, api } from '@/lib/api';
import { useSync } from '@/store/sync.store';
import { cn } from '@/lib/utils';

type Scope = 'device' | 'everywhere';

/**
 * Clearing out the sample data so real entries start on an empty database.
 *
 * Accounts, company details, the sync connection and saved backups survive —
 * this erases the work, not the setup. When the computers are synced, the
 * choice matters: clearing everywhere raises a marker the other devices notice,
 * so they drop their copy instead of merging the old records straight back in.
 */
export function ResetData(): JSX.Element {
  const status = useSync((state) => state.status);
  const refreshSync = useSync((state) => state.refresh);
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>('everywhere');
  const [confirmation, setConfirmation] = useState('');
  const [working, setWorking] = useState(false);
  const [backingUp, setBackingUp] = useState(false);

  const connected = Boolean(status?.configured);
  const ready = confirmation.trim().toUpperCase() === 'ERASE';

  const backupFirst = async (): Promise<void> => {
    setBackingUp(true);
    try {
      await api.post('/backups');
      toast.success('Backup saved. Find it under Backup & restore.');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'The backup could not be created.');
    } finally {
      setBackingUp(false);
    }
  };

  const erase = async (): Promise<void> => {
    setWorking(true);
    try {
      const report = await api.post<{ cleared: number; pushed: boolean }>('/sync/reset', {
        scope: connected ? scope : 'device',
      });
      toast.success(
        `${report.cleared.toLocaleString('en-IN')} record(s) erased.${
          report.pushed ? ' The other computers will clear on their next sync.' : ''
        }`,
      );
      await refreshSync();
      setOpen(false);
      // Every screen is holding rows that no longer exist; start clean.
      setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'The records could not be erased.');
      setWorking(false);
    }
  };

  return (
    <>
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <Eraser className="h-4 w-4" />
            Start fresh
          </CardTitle>
          <CardDescription>
            Erase the sample records so the team can begin entering real data on an empty database.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <div className="rounded-md border border-border p-3">
              <p className="font-medium">Erased</p>
              <p className="text-xs text-muted-foreground">
                Leads, clients, bookings, payments, projects, units, materials and their movements, workers,
                attendance, daily reports and forecasts.
              </p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="font-medium">Kept</p>
              <p className="text-xs text-muted-foreground">
                Sign-in accounts, company details, the sync connection and every backup already taken.
              </p>
            </div>
          </div>
          <Button variant="destructive" onClick={() => setOpen(true)}>
            <Eraser className="h-4 w-4" />
            Erase all records
          </Button>
        </CardContent>
      </Card>

      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (working) return;
          setOpen(value);
          if (!value) setConfirmation('');
        }}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Erase all records?
            </DialogTitle>
            <DialogDescription>
              This cannot be undone. Take a backup first if there is anything here worth keeping.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Button variant="outline" className="w-full" onClick={backupFirst} loading={backingUp}>
              <DatabaseBackup className="h-4 w-4" />
              Back up first
            </Button>

            {connected ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">How far</p>
                {(
                  [
                    {
                      value: 'everywhere' as const,
                      label: 'Every computer',
                      hint: 'Clears here and marks the shared data as reset, so the other computers clear on their next sync.',
                    },
                    {
                      value: 'device' as const,
                      label: 'This computer only',
                      hint: 'Clears here. The shared records come back on the next sync.',
                    },
                  ]
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setScope(option.value)}
                    className={cn(
                      'w-full rounded-md border p-3 text-left transition-colors',
                      scope === option.value ? 'border-destructive bg-destructive/5' : 'border-border hover:bg-muted',
                    )}
                  >
                    <span className="block text-sm font-medium">{option.label}</span>
                    <span className="block text-xs text-muted-foreground">{option.hint}</span>
                  </button>
                ))}
              </div>
            ) : null}

            <Field label="Type ERASE to confirm" required>
              <Input
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder="ERASE"
                autoComplete="off"
              />
            </Field>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={working}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={erase} disabled={!ready} loading={working}>
              Erase everything
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
