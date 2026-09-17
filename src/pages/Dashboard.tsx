import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  CloudDownload,
  BadgeDollarSign,
  Building2,
  UsersRound,
  Github,
  Globe2,
  PackageSearch,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wrench
} from 'lucide-react';
import { StatusBadge } from '../components/StatusBadge';
import type { NavigationKey } from '../components/Sidebar';
import type { AppInfo, UpdateState, DashboardData } from '../types/electron';
import { ROLE_DEFINITIONS, type UserRole } from '../config/roles';

interface DashboardProps {
  onNavigate: (key: NavigationKey) => void;
  pointName: string;
  role: UserRole;
}

const initialUpdate: UpdateState = {
  status: 'idle',
  message: 'Aktualizator jest gotowy.'
};

export function Dashboard({ onNavigate, pointName, role }: DashboardProps) {
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

  return (
    <div className="dashboard page-enter">
      <section className="hero-panel">
        <div className="hero-orb hero-orb-one" />
        <div className="hero-orb hero-orb-two" />
        <div className="hero-content">
          <div className="eyebrow light">LOCKON SERVICEOS • {pointName.toUpperCase()} • {roleDefinition.shortLabel.toUpperCase()}</div>
          <h1>Dobry wieczór.<br /><span>System jest gotowy do pracy.</span></h1>
          <p>
            Interfejs jest dopasowany do roli {roleDefinition.label}. Widoczne są tylko moduły,
            które należą do tego poziomu dostępu.
          </p>
          <div className="hero-actions">
            {roleDefinition.navigation.includes('repairs') && (
              <button className="button primary" onClick={() => onNavigate('repairs')}>
                <Wrench size={17} /> Przejdź do zleceń <ArrowRight size={16} />
              </button>
            )}
            {roleDefinition.navigation.includes('ai') && (
              <button className="button ghost" onClick={() => onNavigate('ai')}>
                <Sparkles size={17} /> LockOn AI
              </button>
            )}
          </div>
        </div>
        <div className="hero-system-card">
          <div className="system-icon"><ShieldCheck size={28} /></div>
          <div>
            <span>Stan aplikacji</span>
            <strong>Wszystkie podstawowe usługi aktywne</strong>
          </div>
          <StatusBadge tone="success"><CheckCircle2 size={13} /> ONLINE</StatusBadge>
        </div>
      </section>

      <section className="stats-grid">
        <article className="stat-card">
          <div className="stat-icon orange"><Building2 size={20} /></div>
          <div><span>Widoczne punkty</span><strong>{dashboardData?.pointCount ?? 0}</strong></div>
          <small>{roleDefinition.scope === 'GLOBAL' ? 'Zakres globalny' : 'Punkty przypisane do konta'}</small>
        </article>
        <article className="stat-card">
          <div className="stat-icon"><UsersRound size={20} /></div>
          <div><span>Aktywne konta</span><strong>{dashboardData?.activeUsers ?? 0}</strong></div>
          <small>{role === 'OWNER' ? `Oczekuje na weryfikację: ${dashboardData?.pendingUsers ?? 0}` : 'W zakresie Twojego dostępu'}</small>
        </article>
        <article className="stat-card">
          <div className="stat-icon orange"><BadgeDollarSign size={20} /></div>
          <div><span>{role === 'TECHNICIAN' ? 'Moja zatwierdzona część' : 'Zatwierdzony przychód'}</span><strong>{new Intl.NumberFormat('pl-PL',{style:'currency',currency:'PLN',maximumFractionDigits:0}).format(role === 'TECHNICIAN' ? (dashboardData?.technicianShare ?? 0) : (dashboardData?.approvedRevenue ?? 0))}</strong></div>
          <small>Rozliczenia zatwierdzone w systemie</small>
        </article>
        <article className="stat-card">
          <div className="stat-icon"><Globe2 size={20} /></div>
          <div><span>Przeglądarka</span><strong>ONLINE</strong></div>
          <small>Chromium WebContentsView aktywny</small>
        </article>
      </section>

      <section className="dashboard-grid">
        {roleDefinition.canManageUpdates && (
          <article className="panel-card update-card">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">SYSTEM AKTUALIZACJI</span>
                <h2>Aktualizacje przez GitHub</h2>
              </div>
              <div className="github-icon"><Github size={23} /></div>
            </div>

            <div className="version-row">
              <div>
                <span>Zainstalowana wersja</span>
                <strong>v{appInfo?.version ?? '0.4.0'}</strong>
              </div>
              <StatusBadge tone={updateTone}>{update.status}</StatusBadge>
            </div>

            <div className="update-message">
              <RefreshCw className={busy ? 'spin' : ''} size={18} />
              <span>{update.message}</span>
            </div>

            {update.status === 'downloading' && (
              <div className="download-progress"><div style={{ width: `${update.percent}%` }} /></div>
            )}

            <div className="button-row">
              <button className="button secondary" disabled={busy} onClick={() => void window.lockOn.updater.check()}>
                <RefreshCw size={16} /> Sprawdź aktualizacje
              </button>
              {update.status === 'available' && (
                <button className="button primary" onClick={() => void window.lockOn.updater.download()}>
                  <CloudDownload size={16} /> Pobierz
                </button>
              )}
              {update.status === 'downloaded' && (
                <button className="button primary" onClick={() => void window.lockOn.updater.install()}>
                  Zainstaluj i uruchom ponownie
                </button>
              )}
            </div>

            <div className="update-note">
              Panel aktualizacji jest dostępny tylko dla Właściciela aplikacji. Podgląd innej roli ukrywa ten moduł.
            </div>
          </article>
        )}

        <article className="panel-card roadmap-card">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">DOSTĘP ROLI</span>
              <h2>Widoczne moduły</h2>
            </div>
            <div className="roadmap-count">{roleDefinition.navigation.length}</div>
          </div>

          <div className="roadmap-list">
            {[
              ['Zlecenia serwisowe', 'repairs'],
              ['Klienci i urządzenia', 'customers'],
              ['Magazyn części', 'parts'],
              ['Porównywarka ofert', 'offers'],
              ['Przeglądarka w aplikacji', 'browser'],
              ['LockOn AI', 'ai'],
              ['Centrum wsparcia', 'support']
            ]
              .filter(([, key]) => roleDefinition.navigation.includes(key as NavigationKey))
              .map(([name, key], index) => (
                <button key={key} onClick={() => onNavigate(key as NavigationKey)}>
                  <span className="roadmap-index">{String(index + 1).padStart(2, '0')}</span>
                  <span>{name}</span>
                  <ArrowRight size={15} />
                </button>
              ))}
          </div>
        </article>
      </section>

      <footer className="dashboard-footer">
        <span>LockOn ServiceOS</span>
        <span>•</span>
        <span>Bartłomiej Motłoch — Punkt Nowogard</span>
        <span className="footer-version">v{appInfo?.version ?? '0.4.0'} • Electron + React + TypeScript</span>
      </footer>
    </div>
  );
}
