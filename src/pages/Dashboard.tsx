import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BadgeDollarSign,
  Building2,
  CheckCircle2,
  CloudDownload,
  Globe2,
  Headphones,
  RefreshCw,
  Settings2,
  ShieldCheck,
  UsersRound
} from 'lucide-react';
import { StatusBadge } from '../components/StatusBadge';
import type { NavigationKey } from '../components/Sidebar';
import type { AppInfo, DashboardData, UpdateState } from '../types/electron';
import { ROLE_DEFINITIONS, type UserRole } from '../config/roles';

interface DashboardProps {
  onNavigate: (key: NavigationKey) => void;
  onOpenHelp: () => void;
  pointName: string;
  role: UserRole;
  userName: string;
}

const initialUpdate: UpdateState = {
  status: 'idle',
  message: 'Aktualizator jest gotowy.'
};

const money = (value: number) =>
  new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }).format(value || 0);

const greeting = () => {
  const hour = new Date().getHours();
  if (hour < 11) return 'Dzień dobry';
  if (hour < 18) return 'Miłego dnia';
  return 'Dobry wieczór';
};

export function Dashboard({ onNavigate, onOpenHelp, pointName, role, userName }: DashboardProps) {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [update, setUpdate] = useState<UpdateState>(initialUpdate);
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);

  useEffect(() => {
    void window.lockOn.app.getInfo().then(setAppInfo);
    void window.lockOn.updater.getState().then(setUpdate);
    void window.lockOn.data.getDashboard().then(setDashboardData).catch(() => undefined);
    return window.lockOn.updater.onStatus(setUpdate);
  }, []);

  const updateTone = useMemo(() => {
    if (update.status === 'error') return 'danger' as const;
    if (update.status === 'available' || update.status === 'downloaded') return 'warning' as const;
    if (update.status === 'not-available') return 'success' as const;
    return 'neutral' as const;
  }, [update.status]);

  const busy = update.status === 'checking' || update.status === 'downloading';
  const roleDefinition = ROLE_DEFINITIONS[role];
  const firstName = userName.split(' ').filter(Boolean)[0] ?? userName;

  const shortcuts = [
    {
      key: 'browser',
      title: 'Przeglądarka',
      description: 'Otwórz strony i narzędzia bez wychodzenia z ServiceOS.',
      icon: Globe2,
      action: () => onNavigate('browser')
    },
    ...(roleDefinition.navigation.includes('earnings') ? [{
      key: 'earnings',
      title: 'Rozliczenia',
      description: role === 'TECHNICIAN' ? 'Zgłoś przychód i sprawdź historię.' : 'Sprawdź przychody i weryfikację.',
      icon: BadgeDollarSign,
      action: () => onNavigate('earnings')
    }] : []),
    ...(roleDefinition.navigation.includes('administration') ? [{
      key: 'administration',
      title: 'Administracja',
      description: 'Konta, zgłoszenia dostępu i punkty w jednym miejscu.',
      icon: UsersRound,
      action: () => onNavigate('administration')
    }] : []),
    {
      key: 'help',
      title: 'Pomoc',
      description: 'Otwórz kompaktowy panel pomocy z prawej strony.',
      icon: Headphones,
      action: onOpenHelp
    }
  ];

  return (
    <div className="dashboard page-enter">
      <section className="hero-panel">
        <div className="hero-orb hero-orb-one" />
        <div className="hero-orb hero-orb-two" />
        <div className="hero-content">
          <div className="eyebrow light"><span className="live-dot" /> {pointName}</div>
          <h1>{greeting()}, {firstName}.<br /><span>Wszystko jest gotowe.</span></h1>
          <p>Najważniejsze rzeczy masz pod ręką. Bez pustych modułów i bez przełączania się między przypadkowymi ekranami.</p>
          <div className="hero-actions">
            <button className="button primary" onClick={() => onNavigate('browser')}>
              <Globe2 size={17} /> Otwórz przeglądarkę <ArrowRight size={16} />
            </button>
            <button className="button ghost" onClick={onOpenHelp}>
              <Headphones size={17} /> Pomoc
            </button>
          </div>
        </div>

        <div className="hero-system-card">
          <div className="system-icon"><ShieldCheck size={25} /></div>
          <div>
            <span>ServiceOS</span>
            <strong>v{appInfo?.version ?? '—'}</strong>
            <small>{update.status === 'available' || update.status === 'downloaded' ? update.message : 'System połączony i gotowy'}</small>
          </div>
          <StatusBadge tone={updateTone}>
            {update.status === 'available' || update.status === 'downloaded' ? 'UPDATE' : <><CheckCircle2 size={12} /> ONLINE</>}
          </StatusBadge>
        </div>
      </section>

      <section className="stats-grid compact-stats">
        <article className="stat-card">
          <div className="stat-icon orange"><Building2 size={19} /></div>
          <div><span>Punkty w zasięgu</span><strong>{dashboardData?.pointCount ?? 0}</strong></div>
          <small>{roleDefinition.scope === 'GLOBAL' ? 'Widok wszystkich punktów' : 'Zakres przypisany do konta'}</small>
        </article>

        <article className="stat-card">
          <div className="stat-icon"><UsersRound size={19} /></div>
          <div><span>Aktywne konta</span><strong>{dashboardData?.activeUsers ?? 0}</strong></div>
          <small>{role === 'OWNER' ? String(dashboardData?.pendingUsers ?? 0) + ' czeka na akceptację' : 'W Twoim zakresie dostępu'}</small>
        </article>

        <article className="stat-card">
          <div className="stat-icon orange"><BadgeDollarSign size={19} /></div>
          <div>
            <span>{role === 'TECHNICIAN' ? 'Moja zatwierdzona część' : 'Zatwierdzony przychód'}</span>
            <strong>{money(role === 'TECHNICIAN' ? (dashboardData?.technicianShare ?? 0) : (dashboardData?.approvedRevenue ?? 0))}</strong>
          </div>
          <small>Tylko zatwierdzone wpisy</small>
        </article>
      </section>

      <section className="shortcut-grid">
        {shortcuts.map(({ key, title, description, icon: Icon, action }) => (
          <button className="shortcut-card" key={key} onClick={action}>
            <div className="shortcut-icon"><Icon size={21} /></div>
            <div><strong>{title}</strong><span>{description}</span></div>
            <ArrowRight size={16} className="shortcut-arrow" />
          </button>
        ))}
      </section>

      {roleDefinition.canManageUpdates && (
        <section className="panel-card update-card">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">AKTUALIZACJE</span>
              <h2>LockOn aktualizuje się z GitHuba</h2>
              <p>Sprawdź nową wersję i zainstaluj ją bez szukania plików ręcznie.</p>
            </div>
            <div className="github-icon"><Settings2 size={22} /></div>
          </div>

          <div className="version-row">
            <div><span>Zainstalowana wersja</span><strong>v{appInfo?.version ?? '—'}</strong></div>
            <StatusBadge tone={updateTone}>{update.status}</StatusBadge>
          </div>

          <div className="update-message">
            <RefreshCw className={busy ? 'spin' : ''} size={17} />
            <span>{update.message}</span>
          </div>

          {update.status === 'downloading' && (
            <div className="download-progress"><div style={{ width: update.percent + '%' }} /></div>
          )}

          <div className="button-row">
            <button className="button secondary" disabled={busy} onClick={() => void window.lockOn.updater.check()}>
              <RefreshCw size={16} /> Sprawdź
            </button>
            {update.status === 'available' && (
              <button className="button primary" onClick={() => void window.lockOn.updater.download()}>
                <CloudDownload size={16} /> Pobierz aktualizację
              </button>
            )}
            {update.status === 'downloaded' && (
              <button className="button primary" onClick={() => void window.lockOn.updater.install()}>
                Zainstaluj i uruchom ponownie
              </button>
            )}
          </div>
        </section>
      )}

      <footer className="dashboard-footer">
        <span>LockOn ServiceOS</span><span>•</span><span>{pointName}</span>
        <span className="footer-version">v{appInfo?.version ?? '—'}</span>
      </footer>
    </div>
  );
}
