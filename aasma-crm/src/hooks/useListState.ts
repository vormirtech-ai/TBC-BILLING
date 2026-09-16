import { useCallback, useMemo, useState } from 'react';
import { useDebounced } from './useResource';

export interface ListState {
  search: string;
  setSearch: (value: string) => void;
  debouncedSearch: string;
  page: number;
  setPage: (page: number) => void;
  sortBy: string;
  sortDir: 'asc' | 'desc';
  toggleSort: (column: string) => void;
  filters: Record<string, string>;
  setFilter: (key: string, value: string) => void;
  reset: () => void;
  /** Query object ready to hand to the API. */
  query: Record<string, string | number>;
  pageSize: number;
}

/**
 * Shared state for a list screen: search, paging, sorting and arbitrary filters,
 * collapsed into a single query object. Changing a filter always returns to the
 * first page, which is what people expect.
 */
export function useListState(options?: {
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  pageSize?: number;
  filters?: Record<string, string>;
}): ListState {
  const defaults = useMemo(() => options?.filters ?? {}, [options?.filters]);
  const [search, setSearchValue] = useState('');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState(options?.sortBy ?? 'createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(options?.sortDir ?? 'desc');
  const [filters, setFilters] = useState<Record<string, string>>(defaults);
  const pageSize = options?.pageSize ?? 25;
  const debouncedSearch = useDebounced(search, 280);

  const setSearch = useCallback((value: string) => {
    setSearchValue(value);
    setPage(1);
  }, []);

  const setFilter = useCallback((key: string, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }, []);

  const toggleSort = useCallback(
    (column: string) => {
      if (column === sortBy) {
        setSortDir((direction) => (direction === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortBy(column);
        setSortDir('asc');
      }
      setPage(1);
    },
    [sortBy],
  );

  const reset = useCallback(() => {
    setSearchValue('');
    setFilters(defaults);
    setPage(1);
  }, [defaults]);

  const query = useMemo(() => {
    const result: Record<string, string | number> = { page, pageSize, sortBy, sortDir };
    if (debouncedSearch.trim()) result.q = debouncedSearch.trim();
    for (const [key, value] of Object.entries(filters)) {
      if (value) result[key] = value;
    }
    return result;
  }, [page, pageSize, sortBy, sortDir, debouncedSearch, filters]);

  return {
    search,
    setSearch,
    debouncedSearch,
    page,
    setPage,
    sortBy,
    sortDir,
    toggleSort,
    filters,
    setFilter,
    reset,
    query,
    pageSize,
  };
}
