import { NavLink } from 'react-router-dom';
import {
  BarChart3,
  Building2,
  ClipboardList,
  FileSpreadsheet,
  HardHat,
  LayoutDashboard,
  type LucideIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Package,
  Settings as SettingsIcon,
  TrendingUp,
  UserCheck,
  Users,
} from 'lucide-react';
import { Logo } from './Logo';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/misc';
import { useUi } from '@/store/ui.store';
import { cn } from '@/lib/utils';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Overview',
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    title: 'CRM',
    items: [
      { to: '/leads', label: 'Leads', icon: Users },
      { to: '/clients', label: 'Clients', icon: UserCheck },
    ],
  },
  {
    title: 'Construction',
    items: [
      { to: '/projects', label: 'Projects', icon: Building2 },
      { to: '/properties', label: 'Properties', icon: HardHat },
      { to: '/inventory', label: 'Inventory', icon: Package },
      { to: '/labour', label: 'Labour', icon: ClipboardList },
      { to: '/dpr', label: 'DPR', icon: FileSpreadsheet },
    ],
  },
  {
    title: 'Insights',
    items: [
      { to: '/reports', label: 'Reports', icon: BarChart3 },
      { to: '/forecasting', label: 'Forecasting', icon: TrendingUp },
    ],
  },
  {
    title: 'System',
    items: [{ to: '/settings', label: 'Settings', icon: SettingsIcon }],
  },
];

export function Sidebar(): JSX.Element {
  const collapsed = useUi((state) => state.sidebarCollapsed);
  const toggleSidebar = useUi((state) => state.toggleSidebar);

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200',
        collapsed ? 'w-[4.5rem]' : 'w-64',
      )}
    >
      <div className={cn('flex h-16 items-center border-b border-sidebar-border px-4', collapsed && 'justify-center px-2')}>
        <Logo compact={collapsed} />
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {SECTIONS.map((section) => (
          <div key={section.title} className="space-y-1">
            {!collapsed ? (
              <p className="px-3 pb-1 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-sidebar-muted">
                {section.title}
              </p>
            ) : (
              <div className="mx-auto h-px w-6 bg-sidebar-border" />
            )}
            {section.items.map((item) => {
              const Icon = item.icon;
              const link = (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      collapsed && 'justify-center px-2',
                      isActive
                        ? 'bg-sidebar-active text-primary'
                        : 'text-sidebar-foreground/80 hover:bg-muted hover:text-sidebar-foreground',
                    )
                  }
                >
                  <Icon className="h-[1.15rem] w-[1.15rem] shrink-0" />
                  {!collapsed ? <span className="truncate">{item.label}</span> : null}
                </NavLink>
              );

              return collapsed ? (
                <Tooltip key={item.to} label={item.label}>
                  <div>{link}</div>
                </Tooltip>
              ) : (
                link
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <Button
          variant="ghost"
          size={collapsed ? 'icon' : 'sm'}
          onClick={toggleSidebar}
          className={cn('w-full text-muted-foreground', collapsed && 'w-9')}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          {!collapsed ? <span>Collapse</span> : null}
        </Button>
      </div>
    </aside>
  );
}
