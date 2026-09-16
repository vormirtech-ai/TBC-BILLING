import { useEffect } from 'react';
import { LOCAL_MODE } from '@/lib/api';
import { useAuth } from '@/store/auth.store';
import { useSync } from '@/store/sync.store';

const INTERVAL_MS = 5 * 60 * 1000;
/** Never more than one automatic exchange a minute, however often the window is reopened. */
const MIN_GAP_MS = 60 * 1000;

/**
 * Keeps this device level with GitHub in the background: once after signing in,
 * whenever the window is brought back to the front, when the connection returns,
 * and every five minutes in between. Failures stay quiet — the header shows the
 * last outcome, and the work is safe on this device either way.
 */
export function useAutoSync(): void {
  const signedIn = useAuth((state) => state.status === 'authenticated');
  const refresh = useSync((state) => state.refresh);
  const run = useSync((state) => state.run);

  useEffect(() => {
    if (!LOCAL_MODE || !signedIn) return;
    void refresh();
  }, [LOCAL_MODE, signedIn, refresh]);

  useEffect(() => {
    if (!LOCAL_MODE || !signedIn) return;

    let lastRun = 0;
    const maybeSync = (): void => {
      const status = useSync.getState().status;
      if (!status?.configured || !status.autoSync) return;
      if (document.hidden) return;
      if (Date.now() - lastRun < MIN_GAP_MS) return;
      lastRun = Date.now();
      void run('now', { quiet: true });
    };

    const onVisible = (): void => {
      if (document.visibilityState === 'visible') maybeSync();
    };

    const timer = window.setInterval(maybeSync, INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', maybeSync);
    // Give the first screen a moment to settle before reaching out.
    const initial = window.setTimeout(maybeSync, 2500);

    return () => {
      window.clearInterval(timer);
      window.clearTimeout(initial);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', maybeSync);
    };
  }, [signedIn, run]);
}
