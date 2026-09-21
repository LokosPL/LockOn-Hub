import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BadgeDollarSign,
  Building2,
  CalendarDays,
  CheckCircle2,
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
  ThermometerSun,
  UsersRound,
  Wind
} from 'lucide-react';
import { StatusBadge } from '../components/StatusBadge';
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

function WeatherIcon({ code }: { code: number }) {
  if (code === 0 || code === 1) return <Sun size={48} strokeWidth={1.6} />;
  if (code === 2) return <CloudSun size={48} strokeWidth={1.6} />;
  if (code === 3 || code === 45 || code === 48) return <Cloud size={48} strokeWidth={1.6} />;
  if ([71, 73, 75, 77, 85, 86].includes(code)) return <CloudSnow size={48} strokeWidth={1.6} />;
  if ([95, 96, 99].includes(code)) return <CloudLightning size={48} strokeWidth={1.6} />;
  return <CloudRain size={48} strokeWidth={1.6} />;
}

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
    const timer = window.setInterval(() => setClock(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const city = weatherCity.trim();
    if (!city) {
      setWeather(null);
      setWeatherError('');
      return;
    }

    let cancelled = false;
    let refreshTimer = 0;

    const loadWeather = async () => {
      setWeatherLoading(true);
      try {
        const next = await window.lockOn.data.getWeather(city);
        if (cancelled) return;
        setWeather(next);
        setWeatherError('');
      } catch (error) {
        if (cancelled) return;
        setWeatherError(error instanceof Error ? error.message : 'Pogoda jest chwilowo niedostępna.');
      } finally {
        if (!cancelled) setWeatherLoading(false);
      }
    };

    void loadWeather();
    refreshTimer = window.setInterval(() => void loadWeather(), 15 * 60 * 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
    };
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

  const shortcuts = [
    {
      key: 'browser',
      title: 'Przeglądarka',
      description: 'Internet bez wychodzenia z LockOn.',
      icon: Globe2,
      action: () => onNavigate('browser')
    },
    ...(roleDefinition.navigation.includes('earnings') ? [{
      key: 'earnings',
      title: 'Rozliczenia',
      description: role === 'TECHNICIAN' ? 'Twoje przychody, podział i historia.' : 'Przychody, podziały i rozliczenia w jednym miejscu.',
      icon: BadgeDollarSign,
      action: () => onNavigate('earnings')
    }] : []),
    ...(roleDefinition.navigation.includes('administration') ? [{
      key: 'administration',
      title: 'Administracja',
      description: 'Pracownicy, punkty i dostępy.',
      icon: UsersRound,
      action: () => onNavigate('administration')
    }] : []),
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

  return (
    <div className="dashboard dashboard-start page-enter">
      <section className="hero-panel start-hero">
        <div className="hero-orb hero-orb-one" />
        <div className="hero-orb hero-orb-two" />

        <div className="hero-content start-hero-copy">
          <div className="eyebrow light"><span className="live-dot" /> {pointName}</div>
          <div className="start-greeting">{greeting()}, {firstName}.</div>
          <h1 className="start-clock">{timeText}</h1>
          <div className="start-date"><CalendarDays size={18} /> {dateText}</div>
          <p className="start-intro">Tu zaczynasz dzień. Sprawdzisz najważniejsze informacje i jednym kliknięciem przejdziesz do pracy.</p>
          <div className="hero-actions">
            <button className="button primary" onClick={() => onNavigate('browser')}>
              <Globe2 size={17} /> Otwórz przeglądarkę <ArrowRight size={16} />
            </button>
            <button className="button ghost" onClick={onOpenHelp}>
              <Headphones size={17} /> Pomoc
            </button>
          </div>
        </div>

        <aside className="start-weather-card" aria-live="polite">
          <div className="weather-card-heading">
            <div>
              <span>Pogoda teraz</span>
              <strong><MapPin size={14} /> {weather?.city || weatherCity || 'Twoje miasto'}</strong>
            </div>
            <div className="weather-ready"><CheckCircle2 size={13} /> LockOn gotowy</div>
          </div>

          {weatherLoading && !weather ? (
            <div className="weather-loading"><RefreshCw className="spin" size={22} /><span>Sprawdzam pogodę…</span></div>
          ) : weather ? (
            <>
              <div className="weather-main">
                <div className="weather-icon"><WeatherIcon code={weather.weatherCode} /></div>
                <div>
                  <strong>{Math.round(weather.temperature)}°</strong>
                  <span>{weather.condition}</span>
                </div>
              </div>
              <div className="weather-details">
                <div><ThermometerSun size={16} /><span>Odczuwalna</span><strong>{Math.round(weather.apparentTemperature)}°</strong></div>
                <div><Sun size={16} /><span>Dzisiaj</span><strong>{Math.round(weather.minTemperature)}° / {Math.round(weather.maxTemperature)}°</strong></div>
                <div><Wind size={16} /><span>Wiatr</span><strong>{Math.round(weather.windSpeed)} km/h</strong></div>
              </div>
            </>
          ) : (
            <div className="weather-empty">
              <CloudSun size={38} />
              <strong>{weatherError ? 'Pogoda chwilowo niedostępna' : 'Brak miasta do pogody'}</strong>
              <span>{weatherError || 'Miasto ustawisz przy pierwszej konfiguracji konta.'}</span>
            </div>
          )}
        </aside>
      </section>

      {role !== 'USER' && (
        <section className="stats-grid compact-stats start-stats">
          <article className="stat-card">
            <div className="stat-icon orange"><Building2 size={19} /></div>
            <div><span>Punkty w zasięgu</span><strong>{dashboardData?.pointCount ?? 0}</strong></div>
            <small>{roleDefinition.scope === 'GLOBAL' ? 'Wszystkie miejsca, którymi możesz zarządzać' : 'Miejsca przypisane do Twojego konta'}</small>
          </article>

          <article className="stat-card">
            <div className="stat-icon"><UsersRound size={19} /></div>
            <div><span>Aktywne konta</span><strong>{dashboardData?.activeUsers ?? 0}</strong></div>
            <small>{role === 'OWNER' ? String(dashboardData?.pendingUsers ?? 0) + ' oczekuje na decyzję' : 'Osoby dostępne w Twoim zakresie'}</small>
          </article>

          <article className="stat-card">
            <div className="stat-icon orange"><BadgeDollarSign size={19} /></div>
            <div>
              <span>{role === 'TECHNICIAN' ? 'Moja zatwierdzona część' : 'Zatwierdzony przychód'}</span>
              <strong>{money(role === 'TECHNICIAN' ? (dashboardData?.technicianShare ?? 0) : (dashboardData?.approvedRevenue ?? 0))}</strong>
            </div>
            <small>Podsumowanie zaakceptowanych rozliczeń</small>
          </article>
        </section>
      )}

      <section className="shortcut-grid start-shortcuts">
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
              <h2>Nowa wersja LockOn</h2>
              <p>Sprawdź dostępność aktualizacji i zainstaluj ją bez szukania plików.</p>
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
          {updateActionError && <div className="service-error">{updateActionError}</div>}

          {update.status === 'downloading' && (
            <div className="download-progress"><div style={{ width: update.percent + '%' }} /></div>
          )}

          <div className="button-row">
            <button className="button secondary" disabled={busy} onClick={() => void runUpdateAction(() => window.lockOn.updater.check())}>
              <RefreshCw size={16} /> Sprawdź
            </button>
            {update.status === 'available' && (
              <button className="button primary" disabled={busy} onClick={() => void runUpdateAction(() => window.lockOn.updater.download())}>
                <CloudDownload size={16} /> Pobierz aktualizację
              </button>
            )}
            {update.status === 'downloaded' && (
              <button className="button primary" disabled={busy} onClick={() => void runUpdateAction(() => window.lockOn.updater.install())}>
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
