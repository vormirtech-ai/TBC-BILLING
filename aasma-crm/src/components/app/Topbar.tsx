import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, KeyRound, LogOut, Moon, Search, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { GlobalSearch } from './GlobalSearch';
import { useAuth } from '@/store/auth.store';
import { useUi } from '@/store/ui.store';
import { api } from '@/lib/api';
import { initials } from '@/lib/utils';
import { formatDate } from '@/lib/format';
import type { StockRow } from '@shared/types';

interface Alerts {
  followUps: { id: number; name: string; followUpDate: string | null }[];
  lowStock: StockRow[];
  milestones: { id: number; title: string; dueDate: string; project?: { name: string } | null }[];
  missingDpr: { id: number; name: string }[];
}

export function Topbar(): JSX.Element {
  const navigate = useNavigate();
  const user = useAuth((state) => state.user);
  const logout = useAuth((state) => state.logout);
  const theme = useUi((state) => state.theme);
  const toggleTheme = useUi((state) => state.toggleTheme);

  const [searchOpen, setSearchOpen] = useState(false);
  const [alerts, setAlerts] = useState<Alerts | null>(null);

  // Ctrl+K / Cmd+K opens search from anywhere in the app.
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    let active = true;
    api
      .get<Alerts>('/dashboard/alerts')
      .then((result) => {
        if (active) setAlerts(result);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const alertCount =
    (alerts?.followUps.length ?? 0) +
    (alerts?.lowStock.length ?? 0) +
    (alerts?.milestones.length ?? 0);

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-card/80 px-5 backdrop-blur">
      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className="group flex h-9 w-full max-w-md items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">Search anything…</span>
        <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[0.65rem] font-semibold sm:inline-block">
          Ctrl K
        </kbd>
      </button>

      <div className="flex items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative" aria-label="Alerts">
              <Bell className="h-[1.15rem] w-[1.15rem]" />
              {alertCount > 0 ? (
                <span className="absolute right-1.5 top-1.5 flex h-2 w-2 rounded-full bg-primary ring-2 ring-card" />
              ) : null}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel>Needs attention</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {alertCount === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">Everything is up to date.</p>
            ) : (
              <div className="max-h-80 overflow-y-auto">
                {alerts?.followUps.slice(0, 5).map((lead) => (
                  <DropdownMenuItem key={`lead-${lead.id}`} onClick={() => navigate('/leads')}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">Follow up with {lead.name}</span>
                      <span className="block text-xs text-muted-foreground">Due {formatDate(lead.followUpDate)}</span>
                    </span>
                  </DropdownMenuItem>
                ))}
                {alerts?.lowStock.slice(0, 5).map((row) => (
                  <DropdownMenuItem key={`stock-${row.id}`} onClick={() => navigate('/inventory')}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{row.name} is low</span>
                      <span className="block text-xs text-muted-foreground">
                        {row.inStock} {row.unit} left • reorder at {row.reorderLevel}
                      </span>
                    </span>
                  </DropdownMenuItem>
                ))}
                {alerts?.milestones.slice(0, 5).map((milestone) => (
                  <DropdownMenuItem key={`milestone-${milestone.id}`} onClick={() => navigate('/projects')}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{milestone.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {milestone.project?.name} • due {formatDate(milestone.dueDate)}
                      </span>
                    </span>
                  </DropdownMenuItem>
                ))}
              </div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Switch theme">
          {theme === 'dark' ? <Sun className="h-[1.15rem] w-[1.15rem]" /> : <Moon className="h-[1.15rem] w-[1.15rem]" />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 rounded-md py-1 pl-1 pr-2 transition-colors hover:bg-muted"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                {initials(user?.fullName ?? 'A')}
              </span>
              <span className="hidden text-left leading-tight sm:block">
                <span className="block text-sm font-semibold">{user?.fullName}</span>
                <span className="block text-[0.7rem] text-muted-foreground">{user?.role}</span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <span className="block text-sm font-semibold text-foreground">{user?.fullName}</span>
              <span className="block text-xs font-normal text-muted-foreground">@{user?.username}</span>
              <Badge variant="secondary" className="mt-2">
                {user?.role}
              </Badge>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/settings?tab=security')}>
              <KeyRound className="h-4 w-4" />
              Change password
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onClick={logout}>
              <LogOut className="h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </header>
  );
}
