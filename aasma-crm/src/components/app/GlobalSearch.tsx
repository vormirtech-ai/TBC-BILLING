import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, FileSpreadsheet, HardHat, Package, Search, UserCheck, Users, HardHat as WorkerIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useDebounced } from '@/hooks/useResource';
import type { GlobalSearchHit } from '@shared/types';

const ICONS = {
  lead: Users,
  client: UserCheck,
  property: HardHat,
  project: Building2,
  worker: WorkerIcon,
  material: Package,
  dpr: FileSpreadsheet,
} as const;

/**
 * Ctrl+K search across every module. Results come from a single endpoint so the
 * lookup stays fast even with tens of thousands of rows.
 */
export function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }): JSX.Element {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState<GlobalSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const debounced = useDebounced(term, 220);

  useEffect(() => {
    if (!open) {
      setTerm('');
      setHits([]);
      return;
    }
  }, [open]);

  useEffect(() => {
    if (!open || debounced.trim().length < 2) {
      setHits([]);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    api
      .get<GlobalSearchHit[]>('/search', { q: debounced }, controller.signal)
      .then(setHits)
      .catch(() => setHits([]))
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [debounced, open]);

  const go = (hit: GlobalSearchHit): void => {
    onOpenChange(false);
    navigate(hit.href);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" className="gap-3 p-0">
        <DialogHeader className="border-b border-border p-4 pb-3">
          <DialogTitle className="sr-only">Search everything</DialogTitle>
          <div className="flex items-center gap-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Input
              autoFocus
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Search leads, clients, units, projects, workers, materials…"
              className="h-9 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            />
          </div>
        </DialogHeader>

        <div className="max-h-[22rem] overflow-y-auto px-2 pb-3">
          {loading ? (
            <div className="space-y-2 p-2">
              {[0, 1, 2].map((row) => (
                <Skeleton key={row} className="h-10" />
              ))}
            </div>
          ) : hits.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {term.trim().length < 2 ? 'Type at least two characters to search.' : 'Nothing matched that search.'}
            </p>
          ) : (
            hits.map((hit) => {
              const Icon = ICONS[hit.type];
              return (
                <button
                  key={`${hit.type}-${hit.id}`}
                  type="button"
                  onClick={() => go(hit)}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-muted"
                >
                  <span className="rounded-md bg-muted p-1.5 text-muted-foreground">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{hit.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{hit.subtitle}</span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
