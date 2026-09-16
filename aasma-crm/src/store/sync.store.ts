import { create } from 'zustand';
import { toast } from 'sonner';
import { ApiError, LOCAL_MODE, api } from '@/lib/api';
import { useAuth } from './auth.store';

export interface SyncStatus {
  configured: boolean;
  deviceId: string;
  deviceName: string;
  owner: string;
  repo: string;
  branch: string;
  path: string;
  autoSync: boolean;
  includePhotos: boolean;
  hasToken: boolean;
  lastSyncedAt: string | null;
  lastPushedAt: string | null;
  lastStatus: string;
  remoteSha: string | null;
}

interface SyncState {
  status: SyncStatus | null;
  busy: boolean;
  refresh: () => Promise<void>;
  /** Exchange data with GitHub. `quiet` is used by the background timer. */
  run: (action: 'now' | 'pull' | 'push', options?: { quiet?: boolean }) => Promise<boolean>;
}

/**
 * Shared state for the GitHub exchange, so the header button and the Settings
 * screen always show the same thing and cannot run two syncs at once.
 */
export const useSync = create<SyncState>((set, get) => ({
  status: null,
  busy: false,

  refresh: async () => {
    if (!LOCAL_MODE) return;
    try {
      set({ status: await api.get<SyncStatus>('/sync/status') });
    } catch {
      // Not signed in yet, or storage is unavailable; the header simply hides.
    }
  },

  run: async (action, options) => {
    if (!LOCAL_MODE || get().busy) return false;
    set({ busy: true });
    try {
      const result = await api.post<{
        added?: number;
        updated?: number;
        removed?: number;
        signOutRequired?: boolean;
      }>(`/sync/${action}`);
      await get().refresh();

      if (result.signOutRequired) {
        // This device dropped its sample data and took the shared records, so the
        // account it was signed in with no longer exists here.
        toast.success('This device now uses the shared data. Sign in with your account to continue.');
        set({ busy: false });
        useAuth.getState().logout();
        return true;
      }

      if (!options?.quiet) {
        const added = result.added ?? 0;
        const updated = result.updated ?? 0;
        const removed = result.removed ?? 0;
        toast.success(
          action === 'push'
            ? 'This device sent its data to GitHub.'
            : `Synced — ${added} added, ${updated} updated, ${removed} removed.`,
        );
      }
      return true;
    } catch (error) {
      if (!options?.quiet) {
        toast.error(error instanceof ApiError ? error.message : 'The sync could not be completed.');
      }
      await get().refresh();
      return false;
    } finally {
      set({ busy: false });
    }
  },
}));
