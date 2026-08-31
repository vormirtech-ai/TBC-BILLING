import { useEffect } from 'react';
import { HashRouter, BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/misc';
import { AppShell } from '@/components/app/AppShell';
import { ErrorBoundary } from '@/components/app/ErrorBoundary';
import { Logo } from '@/components/app/Logo';
import { LoginPage } from '@/pages/Login';
import { DashboardPage } from '@/pages/Dashboard';
import { LeadsPage } from '@/pages/Leads';
import { ClientsPage } from '@/pages/Clients';
import { ClientDetailPage } from '@/pages/ClientDetail';
import { ProjectsPage } from '@/pages/Projects';
import { ProjectDetailPage } from '@/pages/ProjectDetail';
import { PropertiesPage } from '@/pages/Properties';
import { InventoryPage } from '@/pages/Inventory';
import { LabourPage } from '@/pages/Labour';
import { DprPage } from '@/pages/Dpr';
import { ReportsPage } from '@/pages/Reports';
import { ForecastingPage } from '@/pages/Forecasting';
import { SettingsPage } from '@/pages/Settings';
import { useAuth } from '@/store/auth.store';
import { useUi } from '@/store/ui.store';
import { LOCAL_MODE, api, getToken, setUnauthorizedHandler } from '@/lib/api';
import { setCurrencySymbol } from '@/lib/format';

function BootScreen(): JSX.Element {
  return (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <Logo />
        <p className="text-sm text-muted-foreground">Opening your workspace…</p>
      </div>
    </div>
  );
}

/**
 * A static host serves no rewrites, so the hosted build routes through the hash
 * and deep links keep working on refresh. The desktop build uses clean paths.
 */
const Router = LOCAL_MODE ? HashRouter : BrowserRouter;

export default function App(): JSX.Element {
  const status = useAuth((state) => state.status);
  const restore = useAuth((state) => state.restore);
  const logout = useAuth((state) => state.logout);
  const theme = useUi((state) => state.theme);
  const setTheme = useUi((state) => state.setTheme);

  // Any 401 anywhere in the app drops straight back to the sign-in screen.
  useEffect(() => {
    setUnauthorizedHandler(() => logout());
  }, [logout]);

  useEffect(() => {
    setTheme(theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (getToken()) void restore();
    else useAuth.setState({ status: 'anonymous' });
  }, [restore]);

  // The currency symbol is a company setting, applied to every formatted figure.
  useEffect(() => {
    if (status !== 'authenticated') return;
    api
      .get<{ currency: string }>('/settings')
      .then((settings) => setCurrencySymbol(settings.currency))
      .catch(() => undefined);
  }, [status]);

  if (status === 'unknown') return <BootScreen />;

  return (
    <TooltipProvider delayDuration={200}>
      <Router>
        <ErrorBoundary>
          {status === 'authenticated' ? (
            <Routes>
              <Route element={<AppShell />}>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/leads" element={<LeadsPage />} />
                <Route path="/clients" element={<ClientsPage />} />
                <Route path="/clients/:id" element={<ClientDetailPage />} />
                <Route path="/projects" element={<ProjectsPage />} />
                <Route path="/projects/:id" element={<ProjectDetailPage />} />
                <Route path="/properties" element={<PropertiesPage />} />
                <Route path="/inventory" element={<InventoryPage />} />
                <Route path="/labour" element={<LabourPage />} />
                <Route path="/dpr" element={<DprPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/forecasting" element={<ForecastingPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          ) : (
            <Routes>
              <Route path="*" element={<LoginPage />} />
            </Routes>
          )}
        </ErrorBoundary>
      </Router>
      <Toaster
        position="bottom-right"
        richColors
        closeButton
        toastOptions={{ classNames: { toast: 'font-sans' } }}
      />
    </TooltipProvider>
  );
}
