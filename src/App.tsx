import { useEffect, useMemo, useState } from 'react';
import { Eye } from 'lucide-react';
import { SplashScreen } from './components/SplashScreen';
import { TitleBar } from './components/TitleBar';
import { Sidebar, type NavigationKey } from './components/Sidebar';
import { HelpChat } from './components/HelpChat';
import { MeetingActivityDock } from './components/MeetingActivityDock';
import { UpdatePrompt } from './components/UpdatePrompt';
import { Dashboard } from './pages/Dashboard';
import { BrowserPage } from './pages/BrowserPage';
import { LoginScreen } from './pages/LoginScreen';
import { PendingAccessPage } from './pages/PendingAccessPage';
import { SupportDesk } from './pages/SupportDesk';
import { SettingsPage } from './pages/SettingsPage';
import { AdministrationPage } from './pages/AdministrationPage';
import { CustomerAccountsPage } from './pages/CustomerAccountsPage';
import { EarningsPage } from './pages/EarningsPage';
import { MeetingsPage } from './pages/MeetingsPage';
import { ServicePage } from './pages/ServicePage';
import type { AuthState, HelpAction } from './types/electron';
import { ROLE_DEFINITIONS, roleCanNavigate, type UserRole } from './config/roles';
import { applyStoredUiPreferences } from './uiPreferences';

const view = new URLSearchParams(window.location.search).get('view');

export default function App() {
  const [active, setActive] = useState<NavigationKey>('dashboard');
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [previewRole, setPreviewRole] = useState<UserRole | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [focusOrderId, setFocusOrderId] = useState<string | null>(null);
  const [focusUserId, setFocusUserId] = useState<string | null>(null);
  const [focusMeetingId, setFocusMeetingId] = useState<string | null>(null);

  useEffect(() => {
    if (view === 'splash') return;
    let cancelled = false;
    void (async () => {
      try {
        const [, nextAuth] = await Promise.all([
          applyStoredUiPreferences().catch(() => undefined),
          window.lockOn.auth.getState()
        ]);
        if (!cancelled) setAuth(nextAuth);
      } finally {
        if (!cancelled) void window.lockOn.app.markReady().catch(() => undefined);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (view === 'splash') return;
    return window.lockOn.auth.onState((nextAuth) => {
      setAuth(nextAuth);
    });
  }, []);

  useEffect(() => {
    if (view === 'splash') return;
    return window.lockOn.meetings.onOpenMeeting((meetingId) => {
      if (!/^mtg_[a-f0-9]{20}$/.test(meetingId)) return;
      setFocusMeetingId(meetingId);
      setActive('meetings');
    });
  }, []);

  const actualRole = auth?.role as UserRole | null;
  const effectiveRole = useMemo<UserRole | null>(() => {
    if (!actualRole) return null;
    if (actualRole !== 'OWNER') return actualRole;
    return previewRole ?? actualRole;
  }, [actualRole, previewRole]);

  useEffect(() => {
    if (!auth?.authenticated || !effectiveRole || auth.status !== 'ACTIVE') return;
    if (!roleCanNavigate(effectiveRole, active, auth.supportEnabled === true)) setActive('dashboard');
  }, [active, auth?.authenticated, auth?.status, effectiveRole]);

  useEffect(() => {
    if (view === 'splash') return;
    const shouldShowBrowser = active === 'browser' && !helpOpen;
    void window.lockOn.browser.setVisible(shouldShowBrowser).catch(() => undefined);
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

  const handleHelpAction = (action: HelpAction) => {
    if (action.type === 'OPEN_ORDER' && action.orderId) {
      setFocusOrderId(action.orderId);
      setActive('service');
    } else if (action.type === 'OPEN_USER' && action.userId && actualRole === 'OWNER') {
      setFocusUserId(action.userId);
      setActive('administration');
    } else if (action.type === 'NAVIGATE' && action.target) {
      const target = action.target as NavigationKey;
      if (effectiveRole && roleCanNavigate(effectiveRole, target, auth.supportEnabled === true)) setActive(target);
    } else if (action.type === 'BROWSER_SEARCH' && action.query) {
      const query = action.query.trim().slice(0, 180);
      const url = action.provider === 'YOUTUBE'
        ? 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query)
        : 'https://www.google.com/search?q=' + encodeURIComponent(query);
      setActive('browser');
      window.setTimeout(() => void window.lockOn.browser.navigate(url), 80);
    }
    setHelpOpen(false);
  };

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
  const weatherCity = auth.requestedPoint?.city?.trim()
    || auth.point?.city?.trim()
    || auth.points.find((point) => point.city?.trim())?.city?.trim()
    || '';

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
              onOpenMeeting={(meetingId) => {
                setFocusMeetingId(meetingId);
                setActive('meetings');
              }}
              pointName={pointName}
              role={effectiveRole!}
              userName={auth.user?.name ?? 'Użytkownik'}
              weatherCity={weatherCity}
            />
          )}
          {active === 'administration' && <AdministrationPage focusUserId={focusUserId} />}
          {active === 'customers' && <CustomerAccountsPage effectiveRole={effectiveRole!} />}
          {active === 'meetings' && <MeetingsPage role={effectiveRole!} focusMeetingId={focusMeetingId} />}

          {active === 'service' && <ServicePage auth={auth} effectiveRole={effectiveRole!} focusOrderId={focusOrderId} />}
          {active === 'earnings' && <EarningsPage auth={auth} effectiveRole={effectiveRole!} />}
          {active === 'browser' && <BrowserPage />}
          {active === 'support' && <SupportDesk role={effectiveRole!} supportEnabled={auth.supportEnabled} currentUserId={auth.user?.id} onOpenChat={() => setHelpOpen(true)} />}
          {active === 'settings' && (
            <SettingsPage
              auth={auth}
              effectiveRole={effectiveRole!}
              previewRole={previewRole}
              onPreviewRoleChange={setPreviewRole}
            />
          )}
        </main>

        <MeetingActivityDock
          activePage={active}
          onOpenMeeting={(meetingId) => {
            setFocusMeetingId(meetingId);
            setActive('meetings');
          }}
        />

        <HelpChat open={helpOpen} onClose={() => setHelpOpen(false)} auth={auth} effectiveRole={effectiveRole!} onAction={handleHelpAction} />
        <UpdatePrompt />
      </div>
    </div>
  );
}
