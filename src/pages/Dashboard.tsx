import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  BadgeDollarSign,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Cloud,
  CloudDownload,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  FileCheck2,
  FileText,
  Globe2,
  Headphones,
  Mail,
  MapPin,
  MessageCircleMore,
  PackageCheck,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Smartphone,
  Sun,
  Truck,
  UserCog,
  UserRound,
  UsersRound,
  Wrench
} from 'lucide-react';
import { StatusBadge } from '../components/StatusBadge';
import { MeetingsCard } from '../components/MeetingsCard';
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

function WeatherIcon({ code, size = 34 }: { code: number; size?: number }) {
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

const serviceJourney = [
  {
    step: '01',
    title: 'Klient przychodzi do punktu',
    description: 'Pracownik wyszukuje klienta albo zakłada jego kartę i zapisuje urządzenie, usterkę oraz dane kontaktowe.',
    icon: UserRound
  },
  {
    step: '02',
    title: 'Powstaje zlecenie i karta serwisowa',
    description: 'System nadaje numer zlecenia, zapisuje termin i przygotowuje czytelną kartę z danymi urządzenia oraz warunkami przyjęcia.',
    icon: ClipboardList
  },
  {
    step: '03',
    title: 'Urządzenie trafia do właściwej osoby',
    description: 'Zlecenie może zostać przypisane serwisantowi albo przekazane do innego punktu, jeżeli naprawa ma odbyć się gdzie indziej.',
    icon: Truck
  },
  {
    step: '04',
    title: 'Serwis prowadzi naprawę krok po kroku',
    description: 'Diagnoza, części, naprawa, notatki i kolejne etapy są w jednym miejscu. Każda zmiana zostaje w historii zlecenia.',
    icon: Wrench
  },
  {
    step: '05',
    title: 'Koszty i dokumenty są przy zleceniu',
    description: 'Można zapisać koszt części, cenę dla klienta, faktury, opis wykonanej naprawy i przygotować kartę gwarancyjną.',
    icon: FileText
  },
  {
    step: '06',
    title: 'Klient dostaje informacje',
    description: 'Wiadomości o ważnych zmianach mogą być wysyłane z konta pracownika, który obsługuje sprawę. Klient widzi też swój panel i historię.',
    icon: Mail
  },
  {
    step: '07',
    title: 'Telefon wraca do punktu i czeka na odbiór',
    description: 'Przekazanie powrotne jest widoczne po obu stronach. Punkt wie, kiedy urządzenie jest w drodze, kiedy dotarło i kiedy można je wydać.',
    icon: PackageCheck
  },
  {
    step: '08',
    title: 'Zlecenie kończy się pełną historią',
    description: 'Po odbiorze zostaje komplet informacji: kto obsługiwał urządzenie, co wykonano, jakie były koszty, dokumenty i gwarancja.',
    icon: FileCheck2
  }
] as const;

const roleShowcase = [
  { role: 'Właściciel', scope: 'Cała firma', description: 'Widok wszystkich punktów, pracowników, dostępu, rozliczeń, klientów, wsparcia i ustawień systemu.' },
  { role: 'Szef', scope: 'Wszystkie punkty', description: 'Nadzór nad pracą serwisu, przekazaniami, rozliczeniami oraz spotkaniami zespołu.' },
  { role: 'Koordynator', scope: 'Przypisane punkty', description: 'Organizuje pracę swoich punktów, obsługuje zlecenia, przekazania i może prowadzić spotkania.' },
  { role: 'Serwisant', scope: 'Przypisane punkty', description: 'Ma własną kolejkę pracy, kalendarz, notatki, zlecenia, części, dokumenty i swoje rozliczenia.' },
  { role: 'Pracownik punktu', scope: 'Swój punkt', description: 'Przyjmuje klienta, tworzy zlecenie, drukuje kartę, przekazuje urządzenie i wydaje je po naprawie.' },
  { role: 'Wsparcie', scope: 'Wybrany zakres', description: 'Pomaga pracownikom, widzi zgłoszenia o pomoc i dołącza do rozmowy dopiero wtedy, gdy użytkownik o to poprosi.' }
] as const;

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
  const canOpenService = roleDefinition.navigation.includes('service');
  const canOpenCustomers = roleDefinition.navigation.includes('customers');
  const canOpenEarnings = roleDefinition.navigation.includes('earnings');
  const canOpenAdministration = roleDefinition.navigation.includes('administration');

  const shortcutPool: Shortcut[] = [
    ...(canOpenService ? [{
      key: 'service',
      title: 'Serwis',
      description: 'Przyjęcia, zlecenia, przekazania, naprawy i dokumenty.',
      icon: Wrench,
      action: () => onNavigate('service')
    }] : []),
    ...(canOpenCustomers ? [{
      key: 'customers',
      title: 'Klienci',
      description: 'Karty klientów, urządzenia, historia i dostęp do panelu klienta.',
      icon: UsersRound,
      action: () => onNavigate('customers')
    }] : []),
    ...(canOpenAdministration ? [{
      key: 'administration',
      title: 'Zespół i punkty',
      description: 'Pracownicy, role, punkty i zakresy dostępu.',
      icon: UserCog,
      action: () => onNavigate('administration')
    }] : []),
    ...(canOpenEarnings ? [{
      key: 'earnings',
      title: 'Rozliczenia',
      description: role === 'TECHNICIAN' ? 'Twoje rozliczenia i historia pracy.' : 'Przychody i rozliczenia zespołu.',
      icon: BadgeDollarSign,
      action: () => onNavigate('earnings')
    }] : []),
    {
      key: 'browser',
      title: 'Przeglądarka',
      description: 'Potrzebne strony i wyszukiwanie bez wychodzenia z ServiceOS.',
      icon: Globe2,
      action: () => onNavigate('browser')
    },
    {
      key: 'help',
      title: 'Pomoc',
      description: 'Pomoc automatyczna i możliwość poproszenia konsultanta.',
      icon: Headphones,
      action: onOpenHelp
    },
    {
      key: 'settings',
      title: 'Ustawienia',
      description: 'Wygląd aplikacji, konto i informacje o połączeniu wiadomości.',
      icon: Settings2,
      action: () => onNavigate('settings')
    }
  ];

  const shortcuts = shortcutPool.slice(0, 6);
  const hasRoleStats = role !== 'USER';
  const showUpdateCard = roleDefinition.canManageUpdates && ['available', 'downloaded', 'error'].includes(update.status);
  const scrollToGuide = () => document.getElementById('jak-dziala-serviceos')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="dashboard dashboard-showcase page-enter">
      <section className="showcase-hero">
        <div className="showcase-hero-glow" />
        <div className="showcase-hero-main">
          <div className="showcase-context"><span className="live-dot" /> {pointName}</div>
          <p className="showcase-kicker">{greeting()}, {firstName}</p>
          <h1>Cały serwis w jednym miejscu.<br/><span>Od przyjęcia klienta do odbioru urządzenia.</span></h1>
          <p className="showcase-lead">
            ServiceOS prowadzi pracownika przez całą obsługę: klienta, zlecenie, kartę serwisową, przekazanie między punktami,
            naprawę, dokumenty, wiadomości, spotkania i rozliczenia.
          </p>
          <div className="showcase-actions">
            {canOpenService && <button className="button primary" onClick={() => onNavigate('service')}><Wrench size={17}/> Otwórz serwis <ArrowRight size={16}/></button>}
            <button className="button secondary" onClick={scrollToGuide}><ArrowDown size={17}/> Zobacz jak działa całość</button>
          </div>
          <div className="showcase-proof-row">
            <span><CheckCircle2 size={14}/> jedna historia zlecenia</span>
            <span><CheckCircle2 size={14}/> jasne role pracowników</span>
            <span><CheckCircle2 size={14}/> przekazania między punktami</span>
            <span><CheckCircle2 size={14}/> dokumenty i kontakt z klientem</span>
          </div>
        </div>

        <aside className="showcase-today-card">
          <div className="showcase-today-head">
            <div><CalendarDays size={16}/><span>{dateText}</span></div>
            <strong>{timeText}</strong>
          </div>
          <div className="showcase-today-divider"/>
          <div className="showcase-weather-line">
            {weatherLoading && !weather ? <RefreshCw size={28} className="spin"/> : weather ? <WeatherIcon code={weather.weatherCode}/> : <CloudSun size={34}/>}
            <div>
              <span><MapPin size={12}/> {weather?.city || weatherCity || 'Twój punkt'}</span>
              <strong>{weather ? Math.round(weather.temperature) + '° · ' + weather.condition : (weatherError || 'Twój dzień pracy')}</strong>
            </div>
          </div>
          <div className="showcase-role-summary">
            <ShieldCheck size={17}/>
            <div><span>Twój widok</span><strong>{roleDefinition.label}</strong><small>{roleDefinition.scope === 'GLOBAL' ? 'Zakres: wszystkie punkty' : 'Zakres: przypisane punkty'}</small></div>
          </div>
        </aside>
      </section>

      {hasRoleStats && (
        <section className="showcase-stats" aria-label="Podsumowanie">
          <article><Building2 size={18}/><div><span>Punkty w Twoim widoku</span><strong>{dashboardData?.pointCount ?? 0}</strong></div></article>
          <article><UsersRound size={18}/><div><span>Aktywne konta</span><strong>{dashboardData?.activeUsers ?? 0}</strong></div></article>
          <article><BadgeDollarSign size={18}/><div><span>{role === 'TECHNICIAN' ? 'Moje rozliczenie' : 'Zatwierdzony przychód'}</span><strong>{money(role === 'TECHNICIAN' ? (dashboardData?.technicianShare ?? 0) : (dashboardData?.approvedRevenue ?? 0))}</strong></div></article>
          <article><ShieldCheck size={18}/><div><span>Rola</span><strong>{roleDefinition.shortLabel}</strong></div></article>
        </section>
      )}

      <section className="showcase-section" id="jak-dziala-serviceos">
        <div className="showcase-section-heading">
          <div><span>PROSTY PRZEWODNIK</span><h2>Tak wygląda pełna wizyta klienta</h2><p>Każdy etap ma swoje miejsce, dlatego pracownik nie musi pamiętać, gdzie szukać informacji.</p></div>
          {canOpenService && <button className="button secondary" onClick={() => onNavigate('service')}>Przejdź do serwisu <ArrowRight size={15}/></button>}
        </div>

        <div className="service-journey">
          {serviceJourney.map(({ step, title, description, icon: Icon }, index) => (
            <article className="service-journey-step" key={step}>
              <div className="service-journey-number">{step}</div>
              <div className="service-journey-icon"><Icon size={22}/></div>
              <div className="service-journey-copy"><strong>{title}</strong><p>{description}</p></div>
              {index < serviceJourney.length - 1 && <div className="service-journey-line" aria-hidden="true"/>}
            </article>
          ))}
        </div>
      </section>

      <section className="showcase-section">
        <div className="showcase-section-heading">
          <div><span>CO JEST W SERVICEOS</span><h2>Najważniejsze obszary pracy</h2><p>Nie tylko zlecenia — system łączy obsługę klienta, zespół i codzienną organizację pracy.</p></div>
        </div>

        <div className="capability-grid">
          <article className="capability-card">
            <div className="capability-icon"><Smartphone size={22}/></div>
            <span>OBSŁUGA KLIENTA</span><h3>Klient i urządzenie od pierwszej wizyty</h3>
            <p>Karta klienta, urządzenia, historia napraw, wyceny i informacje potrzebne przy kolejnej wizycie.</p>
            {canOpenCustomers && <button onClick={() => onNavigate('customers')}>Otwórz klientów <ArrowRight size={14}/></button>}
          </article>
          <article className="capability-card">
            <div className="capability-icon"><Truck size={22}/></div>
            <span>PRZEKAZANIA</span><h3>Wiadomo, gdzie jest urządzenie</h3>
            <p>Pracownik widzi wysyłkę do serwisu, drogę urządzenia, przyjęcie w drugim punkcie i powrót do miejsca odbioru.</p>
            {canOpenService && <button onClick={() => onNavigate('service')}>Zobacz pracę serwisu <ArrowRight size={14}/></button>}
          </article>
          <article className="capability-card">
            <div className="capability-icon"><FileCheck2 size={22}/></div>
            <span>DOKUMENTY</span><h3>Karty serwisowe, gwarancje i faktury</h3>
            <p>Dokumenty powstają przy zleceniu i zostają z nim razem. Łatwo je otworzyć ponownie, wydrukować albo sprawdzić później.</p>
            {canOpenService && <button onClick={() => onNavigate('service')}>Otwórz dokumenty <ArrowRight size={14}/></button>}
          </article>
          <article className="capability-card">
            <div className="capability-icon"><CalendarDays size={22}/></div>
            <span>SPOTKANIA I SZKOLENIA</span><h3>Spotkania zespołu w tym samym systemie</h3>
            <p>Szef, właściciel i koordynator mogą planować spotkania. Uczestnicy zapisują się i dołączają dopiero po rozpoczęciu przez prowadzącego.</p>
          </article>
          <article className="capability-card">
            <div className="capability-icon"><MessageCircleMore size={22}/></div>
            <span>POMOC I WIADOMOŚCI</span><h3>Wsparcie pracownika bez szukania kontaktu</h3>
            <p>Pracownik może zapytać pomoc w aplikacji, a gdy potrzebuje człowieka, sam prosi konsultanta o dołączenie do rozmowy.</p>
            <button onClick={onOpenHelp}>Otwórz pomoc <ArrowRight size={14}/></button>
          </article>
          <article className="capability-card">
            <div className="capability-icon"><BadgeDollarSign size={22}/></div>
            <span>ROZLICZENIA</span><h3>Praca i pieniądze są połączone</h3>
            <p>Szef widzi rozliczenia, a serwisant swoją część. Informacje są powiązane z rzeczywistą pracą wykonaną w serwisie.</p>
            {canOpenEarnings && <button onClick={() => onNavigate('earnings')}>Otwórz rozliczenia <ArrowRight size={14}/></button>}
          </article>
        </div>
      </section>

      <MeetingsCard role={role} />

      <section className="showcase-section role-showcase-section">
        <div className="showcase-section-heading">
          <div><span>ROLE W ZESPOLE</span><h2>Każdy widzi to, czego potrzebuje do swojej pracy</h2><p>Pracownik punktu nie dostaje widoku właściciela, a koordynator działa tylko w swoim zakresie.</p></div>
          {canOpenAdministration && <button className="button secondary" onClick={() => onNavigate('administration')}>Zespół i dostępy <ArrowRight size={15}/></button>}
        </div>
        <div className="role-showcase-grid">
          {roleShowcase.map((item) => (
            <article key={item.role} className={item.role === roleDefinition.shortLabel || (role === 'USER' && item.role === 'Pracownik punktu') ? 'current' : ''}>
              <ShieldCheck size={17}/>
              <div><strong>{item.role}</strong><span>{item.scope}</span><p>{item.description}</p></div>
            </article>
          ))}
        </div>
      </section>

      <section className="boss-showcase">
        <div className="boss-showcase-heading">
          <span>DLA SZEFA</span>
          <h2>Co daje ServiceOS w codziennej pracy?</h2>
          <p>Najważniejsze informacje są w jednym miejscu i wynikają z tego, co pracownicy faktycznie robią przy zleceniu.</p>
        </div>
        <div className="boss-benefits">
          <article><ClipboardCheck size={20}/><strong>Pełna historia</strong><span>Od przyjęcia urządzenia aż do wydania klientowi.</span></article>
          <article><Building2 size={20}/><strong>Praca wielu punktów</strong><span>Przekazania nie znikają między sklepem a serwisem.</span></article>
          <article><UsersRound size={20}/><strong>Jasne odpowiedzialności</strong><span>Wiadomo, kto prowadzi zlecenie i kto wykonał zmianę.</span></article>
          <article><FileText size={20}/><strong>Mniej szukania dokumentów</strong><span>Karty, faktury, gwarancje i notatki są przy sprawie.</span></article>
        </div>
      </section>

      <section className="showcase-section">
        <div className="showcase-section-heading">
          <div><span>SZYBKI DOSTĘP</span><h2>Przejdź od razu do pracy</h2><p>Widoczne skróty są dopasowane do Twojej roli.</p></div>
        </div>
        <div className="start-shortcut-grid">
          {shortcuts.map(({ key, title, description, icon: Icon, action }) => (
            <button className="start-shortcut-card" key={key} onClick={action}>
              <div className="start-shortcut-icon"><Icon size={24}/></div>
              <div className="start-shortcut-copy"><strong>{title}</strong><span>{description}</span></div>
              <ArrowRight size={18} className="start-shortcut-arrow"/>
            </button>
          ))}
        </div>
      </section>

      {showUpdateCard && (
        <section className="start-update-strip">
          <div className="start-update-icon"><RefreshCw className={busy ? 'spin' : ''} size={18}/></div>
          <div>
            <strong>{update.status === 'error' ? 'Aktualizacja wymaga uwagi' : 'Dostępna jest nowa wersja LockOn'}</strong>
            <span>{update.message}</span>
          </div>
          <StatusBadge tone={updateTone}>{update.status}</StatusBadge>
          {updateActionError && <span className="start-update-error">{updateActionError}</span>}
          <div className="start-update-actions">
            {update.status === 'available' && (
              <button className="button primary" disabled={busy} onClick={() => void runUpdateAction(() => window.lockOn.updater.download())}>
                <CloudDownload size={15}/> Pobierz
              </button>
            )}
            {update.status === 'downloaded' && (
              <button className="button primary" disabled={busy} onClick={() => void runUpdateAction(() => window.lockOn.updater.install())}>
                Zainstaluj
              </button>
            )}
            {update.status === 'error' && (
              <button className="button secondary" disabled={busy} onClick={() => void runUpdateAction(() => window.lockOn.updater.check())}>
                <RefreshCw size={15}/> Sprawdź ponownie
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
