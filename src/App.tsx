import { useEffect, useMemo, useState } from 'react';
import { Eye } from 'lucide-react';
import { SplashScreen } from './components/SplashScreen';
import { TitleBar } from './components/TitleBar';
import { Sidebar, type NavigationKey } from './components/Sidebar';
import { HelpChat } from './components/HelpChat';
import { UpdatePrompt } from './components/UpdatePrompt';
import { Dashboard } from './pages/Dashboard';
import { BrowserPage } from './pages/BrowserPage';
import { LoginScreen } from './pages/LoginScreen';
import { PendingAccessPage } from './pages/PendingAccessPage';
import { SupportDesk } from './pages/SupportDesk';
import { SettingsPage } from './pages/SettingsPage';
import { AdministrationPage } from './pages/AdministrationPage';
import { EarningsPage } from './pages/EarningsPage';
import { ServicePage } from './pages/ServicePage';
import type { AuthState } from './types/electron';
import { ROLE_DEFINITIONS, roleCanNavigate, type UserRole } from './config/roles';
import { applyStoredUiPreferences } from './uiPreferences';

const view = new URLSearchParams(window.location.search).get('view');

export default function App() {
  const [active, setActive] = useState<NavigationKey>('dashboard');
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [previewRole, setPreviewRole] = useState<UserRole | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    if (view === 'splash') return;
    void applyStoredUiPreferences().catch(() => undefined);
    void window.lockOn.auth.getState().then(setAuth);
  }, []);

  const actualRole = auth?.role as UserRole | null;
  const effectiveRole = useMemo<UserRole | null>(() => {
    if (!actualRole) return null;
    if (actualRole !== 'OWNER') return actualRole;
    return previewRole ?? actualRole;
  }, [actualRole, previewRole]);

  useEffect(() => {
    if (!auth?.authenticated || !effectiveRole || auth.status !== 'ACTIVE') return;
    if (!roleCanNavigate(effectiveRole, active)) setActive('dashboard');
  }, [active, auth?.authenticated, auth?.status, effectiveRole]);

  useEffect(() => {
    if (active !== 'browser') return;
    void window.lockOn.browser.setVisible(!helpOpen);
  }, [active, helpOpen]);

  if (view === 'splash') return <SplashScreen />;

  if (!auth) {
    return (
      <div className="app-shell">
        <TitleBar pointName="LockOn ServiceOS" />
        <div className="boot-loading"><span className="boot-spinner" /> Przywracam sesję…</div>
        <UpdatePrompt />
      </div>
    );
  }

  if (!auth.authenticated) {
    return (
      <div className="app-shell auth-shell">
        <TitleBar pointName="Logowanie" />
        <LoginScreen auth={auth} onAuthenticated={setAuth} />
        <UpdatePrompt />
      </div>
    );
  }

  const doLogout = async () => {
    const next = await window.lockOn.auth.logout();
    setAuth(next);
    setActive('dashboard');
    setPreviewRole(null);
    setHelpOpen(false);
  };

  if (auth.status !== 'ACTIVE' || !auth.role) {
    return (
      <div className="app-shell auth-shell">
        <TitleBar pointName="Weryfikacja konta" />
        <PendingAccessPage auth={auth} onAuthChange={setAuth} onLogout={doLogout} />
        <UpdatePrompt />
      </div>
    );
  }

  const pointName = effectiveRole && ROLE_DEFINITIONS[effectiveRole].scope === 'GLOBAL'
    ? 'Wszystkie punkty'
    : auth.point?.name ?? 'Punkt nieprzypisany';

  return (
    <div className="app-shell">
      <TitleBar pointName={pointName} />
      <div className="app-body">
        <Sidebar
          active={active}
          onChange={setActive}
          auth={auth}
          effectiveRole={effectiveRole!}
          previewRole={previewRole}
          onPreviewRoleChange={setPreviewRole}
          onOpenHelp={() => setHelpOpen(true)}
          onLogout={doLogout}
        />

        <main className={`content-shell ${active === 'browser' ? 'browser-content-shell' : ''}`}>
          {actualRole === 'OWNER' && previewRole && (
            <div className="role-preview-banner">
              <Eye size={15} />
              <span>Podgląd jako <strong>{ROLE_DEFINITIONS[effectiveRole!].label}</strong></span>
              <button onClick={() => setPreviewRole(null)}>Wróć do mojego widoku</button>
            </div>
          )}

          {active === 'dashboard' && (
            <Dashboard
              onNavigate={setActive}
              onOpenHelp={() => setHelpOpen(true)}
              pointName={pointName}
              role={effectiveRole!}
              userName={auth.user?.name ?? 'Użytkownik'}
            />
          )}
          {active === 'administration' && <AdministrationPage />}
          {active === 'service' && <ServicePage auth={auth} effectiveRole={effectiveRole!} />}
          {active === 'earnings' && <EarningsPage auth={auth} effectiveRole={effectiveRole!} />}
          {active === 'browser' && <BrowserPage />}
          {active === 'support' && <SupportDesk role={effectiveRole!} onOpenChat={() => setHelpOpen(true)} />}
          {active === 'settings' && (
            <SettingsPage
              auth={auth}
              effectiveRole={effectiveRole!}
              previewRole={previewRole}
              onPreviewRoleChange={setPreviewRole}
            />
          )}
        </main>

        <HelpChat open={helpOpen} onClose={() => setHelpOpen(false)} auth={auth} effectiveRole={effectiveRole!} />
        <UpdatePrompt />
      </div>
    </div>
  );
}
