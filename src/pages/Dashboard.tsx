import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BadgeDollarSign,
  Building2,
  CalendarDays,
  Cloud,
  CloudDownload,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Globe2,
  Headphones,
  MapPin,
  RefreshCw,
  Settings2,
  Sun,
  UsersRound,
  Wrench
} from 'lucide-react';
import { StatusBadge } from '../components/StatusBadge';
import { NextMeetingCard } from '../components/NextMeetingCard';
import type { NavigationKey } from '../components/Sidebar';
import type { AppInfo, DashboardData, UpdateState, WeatherData } from '../types/electron';
import { ROLE_DEFINITIONS, type UserRole } from '../config/roles';

interface DashboardProps {
  onNavigate: (key: NavigationKey) => void;
  onOpenHelp: () => void;
  pointName: string;
  role: UserRole;
  userName: string;
  weatherCity: string;
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

const formatDate = (date: Date) => {
  const value = new Intl.DateTimeFormat('pl-PL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(date);
  return value.charAt(0).toUpperCase() + value.slice(1);
};

function WeatherIcon({ code, size = 38 }: { code: number; size?: number }) {
  if (code === 0 || code === 1) return <Sun size={size} strokeWidth={1.7} />;
  if (code === 2) return <CloudSun size={size} strokeWidth={1.7} />;
  if (code === 3 || code === 45 || code === 48) return <Cloud size={size} strokeWidth={1.7} />;
  if ([71, 73, 75, 77, 85, 86].includes(code)) return <CloudSnow size={size} strokeWidth={1.7} />;
  if ([95, 96, 99].includes(code)) return <CloudLightning size={size} strokeWidth={1.7} />;
  return <CloudRain size={size} strokeWidth={1.7} />;
}

type Shortcut = {
  key: string;
  title: string;
  description: string;
  icon: typeof Globe2;
  action: () => void;
};

export function Dashboard({ onNavigate, onOpenHelp, pointName, role, userName, weatherCity }: DashboardProps) {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [update, setUpdate] = useState<UpdateState>(initialUpdate);
  const [updateActionBusy, setUpdateActionBusy] = useState(false);
  const [updateActionError, setUpdateActionError] = useState('');
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState('');

  useEffect(() => {
    void window.lockOn.app.getInfo().then(setAppInfo);
    void window.lockOn.updater.getState().then(setUpdate);
    void window.lockOn.data.getDashboard().then(setDashboardData).catch(() => undefined);
    return window.lockOn.updater.onStatus(setUpdate);
  }, []);

  useEffect(() => {
    let interval: number | undefined;
    const syncClock = () => setClock(new Date());
    const untilNextMinute = 60_000 - (Date.now() % 60_000) + 40;
    const timeout = window.setTimeout(() => {
      syncClock();
      interval = window.setInterval(syncClock, 60_000);
    }, untilNextMinute);
    return () => {
      window.clearTimeout(timeout);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, []);

  const loadWeather = async () => {
    const city = weatherCity.trim();
    if (!city) {
      setWeather(null);
      setWeatherError('');
      return;
    }
    setWeatherLoading(true);
    try {
      const next = await window.lockOn.data.getWeather(city);
      setWeather(next);
      setWeatherError('');
    } catch {
      setWeatherError('Pogoda jest teraz niedostępna.');
    } finally {
      setWeatherLoading(false);
    }
  };

  useEffect(() => {
    void loadWeather();
    const refreshTimer = window.setInterval(() => void loadWeather(), 15 * 60 * 1_000);
    return () => window.clearInterval(refreshTimer);
  }, [weatherCity]);

  const updateTone = useMemo(() => {
    if (update.status === 'error') return 'danger' as const;
    if (update.status === 'available' || update.status === 'downloaded') return 'warning' as const;
    if (update.status === 'not-available') return 'success' as const;
    return 'neutral' as const;
  }, [update.status]);

  const busy = updateActionBusy || update.status === 'checking' || update.status === 'downloading';
  const runUpdateAction = async (action: () => Promise<unknown>) => {
    if (updateActionBusy) return;
    setUpdateActionBusy(true);
    setUpdateActionError('');
    try {
      await action();
    } catch (error) {
      setUpdateActionError(error instanceof Error ? error.message : 'Nie udało się wykonać akcji aktualizatora.');
    } finally {
      setUpdateActionBusy(false);
    }
  };

  const roleDefinition = ROLE_DEFINITIONS[role];
  const firstName = userName.split(' ').filter(Boolean)[0] ?? userName;
  const timeText = clock.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  const dateText = formatDate(clock);

  const shortcutPool: Shortcut[] = [
    ...(roleDefinition.navigation.includes('service') ? [{
      key: 'service',
      title: 'Serwis',
      description: 'Zlecenia, urządzenia i bieżąca praca serwisu.',
      icon: Wrench,
      action: () => onNavigate('service')
    }] : []),
    ...(roleDefinition.navigation.includes('administration') ? [{
      key: 'administration',
      title: 'Administracja',
      description: 'Pracownicy, punkty i dostępy.',
      icon: UsersRound,
      action: () => onNavigate('administration')
    }] : []),
    ...(roleDefinition.navigation.includes('earnings') ? [{
      key: 'earnings',
      title: 'Rozliczenia',
      description: role === 'TECHNICIAN' ? 'Twoje przychody i historia rozliczeń.' : 'Przychody i rozliczenia w jednym miejscu.',
      icon: BadgeDollarSign,
      action: () => onNavigate('earnings')
    }] : []),
    {
      key: 'browser',
      title: 'Przeglądarka',
      description: 'Internet bez wychodzenia z LockOn.',
      icon: Globe2,
      action: () => onNavigate('browser')
    },
    {
      key: 'help',
      title: 'Pomoc',
      description: 'Porozmawiaj z pomocą lub szybko znajdź odpowiedź.',
      icon: Headphones,
      action: onOpenHelp
    },
    {
      key: 'settings',
      title: 'Ustawienia',
      description: 'Wygląd aplikacji i ustawienia Twojego konta.',
      icon: Settings2,
      action: () => onNavigate('settings')
    }
  ];

  const shortcuts = role === 'USER'
    ? shortcutPool.filter((item) => ['browser', 'help', 'settings'].includes(item.key))
    : shortcutPool.slice(0, 3);

  const hasRoleStats = role !== 'USER';
  const showUpdateCard = roleDefinition.canManageUpdates && ['available', 'downloaded', 'error'].includes(update.status);

  return (
    <div className="dashboard dashboard-start page-enter">
      <section className="start-hero-premium">
        <div className="start-hero-glow" />
        <div className="start-hero-arc" />

        <div className="start-welcome-column">
          <div className="start-context"><span className="live-dot" /> {pointName}</div>
          <h1>{greeting()}, <span>{firstName}.</span></h1>
          <p>Wszystko gotowe do pracy. Wybierz, od czego chcesz zacząć lub skorzystaj z szybkich skrótów.</p>
          <div className="start-primary-actions">
            <button className="button primary start-browser-action" onClick={() => onNavigate('browser')}>
              <Globe2 size={17} /> Otwórz przeglądarkę <ArrowRight size={16} />
            </button>
            <button className="button start-help-action" onClick={onOpenHelp}>
              <Headphones size={17} /> Pomoc
            </button>
          </div>
        </div>

        <div className="start-time-column">
          <div className="start-date-line">{dateText}</div>
          <div className="start-clock start-clock-animated" aria-label={timeText}>
            {timeText.split('').map((character, index) => character === ':' ? (
              <span className="start-clock-separator" aria-hidden="true" key={'separator-'+index}>:</span>
            ) : (
              <span className="start-clock-slot" aria-hidden="true" key={'slot-'+index}>
                <span className="start-clock-digit" key={character}>{character}</span>
              </span>
            ))}
          </div>
          <div className="start-time-note">
            <CalendarDays size={18} />
            <div>
              <strong>Dobry moment na działanie.</strong>
              <span>Najważniejsze rzeczy masz pod ręką.</span>
            </div>
          </div>
        </div>

        <aside className="start-weather-card" aria-live="polite">
          <div className="start-weather-label">Pogoda teraz</div>
          <div className="start-weather-location"><MapPin size={14} /> {weather?.city || weatherCity || 'Twoje miasto'}</div>

          {weatherLoading && !weather ? (
            <div className="start-weather-state">
              <RefreshCw size={24} className="spin" />
              <span>Sprawdzam pogodę…</span>
            </div>
          ) : weather ? (
            <div className="start-weather-current">
              <div className="start-weather-icon"><WeatherIcon code={weather.weatherCode} /></div>
              <div className="start-weather-temperature">{Math.round(weather.temperature)}°</div>
              <div className="start-weather-condition">{weather.condition}</div>
            </div>
          ) : (
            <div className="start-weather-state start-weather-unavailable">
              <CloudSun size={30} />
              <strong>Pogoda niedostępna</strong>
              <span>{weatherError || 'Sprawdź miasto zapisane na koncie.'}</span>
              {weatherCity && <button onClick={() => void loadWeather()}>Spróbuj ponownie</button>}
            </div>
          )}
        </aside>
      </section>

      <NextMeetingCard onOpen={() => onNavigate('meetings')} />

      <section className="start-section">
        <div className="start-section-heading">
          <div>
            <h2>Szybki dostęp</h2>
            <p>Najważniejsze funkcje systemu w zasięgu ręki.</p>
          </div>
          <span>Wybierz moduł z menu lub użyj skrótu</span>
        </div>

        <div className="start-shortcut-grid">
          {shortcuts.map(({ key, title, description, icon: Icon, action }) => (
            <button className="start-shortcut-card" key={key} onClick={action}>
              <div className="start-shortcut-icon"><Icon size={24} /></div>
              <div className="start-shortcut-copy">
                <strong>{title}</strong>
                <span>{description}</span>
              </div>
              <ArrowRight size={18} className="start-shortcut-arrow" />
            </button>
          ))}
        </div>
      </section>

      {hasRoleStats && (
        <section className="start-mini-stats" aria-label="Podsumowanie">
          <article>
            <div className="start-mini-stat-icon"><Building2 size={17} /></div>
            <div><span>Punkty</span><strong>{dashboardData?.pointCount ?? 0}</strong></div>
            <small>{roleDefinition.scope === 'GLOBAL' ? 'Wszystkie dostępne lokalizacje' : 'Twój zakres dostępu'}</small>
          </article>
          <article>
            <div className="start-mini-stat-icon"><UsersRound size={17} /></div>
            <div><span>Aktywne konta</span><strong>{dashboardData?.activeUsers ?? 0}</strong></div>
            <small>{role === 'OWNER' ? String(dashboardData?.pendingUsers ?? 0) + ' oczekuje na decyzję' : 'W Twoim zakresie'}</small>
          </article>
          <article>
            <div className="start-mini-stat-icon"><BadgeDollarSign size={17} /></div>
            <div>
              <span>{role === 'TECHNICIAN' ? 'Moja część' : 'Przychód'}</span>
              <strong>{money(role === 'TECHNICIAN' ? (dashboardData?.technicianShare ?? 0) : (dashboardData?.approvedRevenue ?? 0))}</strong>
            </div>
            <small>Zatwierdzone rozliczenia</small>
          </article>
        </section>
      )}

      {showUpdateCard && (
        <section className="start-update-strip">
          <div className="start-update-icon"><RefreshCw className={busy ? 'spin' : ''} size={18} /></div>
          <div>
            <strong>{update.status === 'error' ? 'Aktualizacja wymaga uwagi' : 'Dostępna jest nowa wersja LockOn'}</strong>
            <span>{update.message}</span>
          </div>
          <StatusBadge tone={updateTone}>{update.status}</StatusBadge>
          {updateActionError && <span className="start-update-error">{updateActionError}</span>}
          <div className="start-update-actions">
            {update.status === 'available' && (
              <button className="button primary" disabled={busy} onClick={() => void runUpdateAction(() => window.lockOn.updater.download())}>
                <CloudDownload size={15} /> Pobierz
              </button>
            )}
            {update.status === 'downloaded' && (
              <button className="button primary" disabled={busy} onClick={() => void runUpdateAction(() => window.lockOn.updater.install())}>
                Zainstaluj
              </button>
            )}
            {update.status === 'error' && (
              <button className="button secondary" disabled={busy} onClick={() => void runUpdateAction(() => window.lockOn.updater.check())}>
                <RefreshCw size={15} /> Sprawdź ponownie
              </button>
            )}
          </div>
        </section>
      )}

      <footer className="dashboard-footer start-footer">
        <span>LockOn ServiceOS</span><span>•</span><span>{pointName}</span>
        <span className="footer-version">v{appInfo?.version ?? '—'}</span>
      </footer>
    </div>
  );
}
