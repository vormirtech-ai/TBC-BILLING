import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';

interface ResourceState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Re-runs the fetch, keeping the previous data visible while it loads. */
  refresh: () => void;
  setData: (value: T | null) => void;
}

/**
 * Minimal data-loading hook: run a fetcher, expose loading and error state, and
 * cancel in-flight requests when the inputs change or the screen unmounts.
 */
export function useResource<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: unknown[] = [],
  options?: { enabled?: boolean },
): ResourceState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(options?.enabled === false ? false : true);
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const enabled = options?.enabled !== false;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setLoading(true);

    fetcherRef
      .current(controller.signal)
      .then((result) => {
        if (!active) return;
        setData(result);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!active || (cause as Error).name === 'AbortError') return;
        setError(cause instanceof ApiError ? cause.message : 'Something went wrong loading this screen.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, enabled]);

  const refresh = useCallback(() => setTick((value) => value + 1), []);

  return { data, error, loading, refresh, setData };
}

/** Debounces a fast-changing value, typically search input. */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
