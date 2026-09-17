import { useEffect, useMemo, useState } from 'react';
import {
  BriefcaseBusiness,
  Building2,
  Check,
  Clock3,
  LogOut,
  RefreshCw,
  Send,
  ShieldCheck,
  UserRoundCheck
} from 'lucide-react';
import logo from '../assets/logo.svg';
import { ROLE_DEFINITIONS, type UserRole } from '../config/roles';
import type { AuthState } from '../types/electron';

interface Props {
  auth: AuthState;
  onAuthChange: (state: AuthState) => void;
  onLogout: () => void | Promise<void>;
}

const REQUESTABLE_ROLES: UserRole[] = ['BOSS', 'COORDINATOR', 'SUPPORT', 'TECHNICIAN', 'USER'];

export function PendingAccessPage({ auth, onAuthChange, onLogout }: Props) {
  const requestedRole = auth.requestedPoint?.requestedRole;
  const [pointName, setPointName] = useState(auth.requestedPoint?.pointName ?? '');
  const [city, setCity] = useState(auth.requestedPoint?.city ?? '');
  const [role, setRole] = useState<UserRole>(requestedRole && requestedRole !== 'OWNER' ? requestedRole : 'TECHNICIAN');
  const [editing, setEditing] = useState(!auth.requestedPoint);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const refresh = async (silent = false) => {
    if (!silent) setBusy(true);
    try {
      const next = await window.lockOn.auth.getState();
      onAuthChange(next);
      setLastChecked(new Date());
      if (!silent && next.status === 'PENDING') setNotice('Status odświeżony. Zgłoszenie nadal czeka na akceptację.');
    } catch (error) {
      if (!silent) setNotice(error instanceof Error ? error.message : 'Nie udało się odświeżyć statusu.');
    } finally {
      if (!silent) setBusy(false);
    }
  };

  useEffect(() => {
    if (!auth.requestedPoint || auth.status !== 'PENDING') return;
    const timer = window.setInterval(() => void refresh(true), 8_000);
    return () => window.clearInterval(timer);
  }, [auth.requestedPoint, auth.status]);

  useEffect(() => {
    if (!auth.requestedPoint) return;
    setPointName(auth.requestedPoint.pointName);
    setCity(auth.requestedPoint.city);
    if (auth.requestedPoint.requestedRole && auth.requestedPoint.requestedRole !== 'OWNER') {
      setRole(auth.requestedPoint.requestedRole);
    }
  }, [auth.requestedPoint]);

  const submit = async () => {
    if (!pointName.trim() || !city.trim()) {
      setNotice('Wpisz nazwę punktu oraz miasto.');
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      const next = await window.lockOn.access.requestPoint({
        pointName: pointName.trim(),
        city: city.trim(),
        requestedRole: role
      });
      onAuthChange(next);
      setEditing(false);
      setNotice('Zgłoszenie wysłane. Gdy właściciel je zaakceptuje, aplikacja przejdzie dalej automatycznie.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Nie udało się wysłać zgłoszenia.');
    } finally {
      setBusy(false);
    }
  };

  const rejected = auth.status === 'REJECTED';
  const requested = Boolean(auth.requestedPoint);
  const currentRequestedRole = auth.requestedPoint?.requestedRole ?? role;
  const currentRoleDefinition = useMemo(() => ROLE_DEFINITIONS[currentRequestedRole], [currentRequestedRole]);

  return (
    <div className="pending-page page-enter">
      <div className="pending-orb pending-orb-one" /><div className="pending-orb pending-orb-two" />
      <section className="pending-card access-card-v2">
        <div className="pending-brand">
          <div className="pending-logo"><img src={logo} alt="LockOn ServiceOS" /></div>
          <div>
            <div className="eyebrow light">LOCKON SERVICEOS • DOSTĘP DO PUNKTU</div>
            <h1>{rejected ? 'Dostęp nie został przyznany' : requested && !editing ? 'Zgłoszenie czeka na akceptację' : 'Dokończ konfigurację konta'}</h1>
            <p>Zalogowano jako <strong>{auth.user?.email}</strong>. Ty wskazujesz punkt i rolę, a Właściciel aplikacji zatwierdza dostęp.</p>
          </div>
        </div>

        <div className="access-steps" aria-label="Etapy konfiguracji dostępu">
          <div className="done"><span><Check size={14}/></span><div><strong>1. Google</strong><small>Konto potwierdzone</small></div></div>
          <div className={requested ? 'done' : 'active'}><span>{requested ? <Check size={14}/> : '2'}</span><div><strong>2. Zgłoszenie</strong><small>Punkt i rola</small></div></div>
          <div className={requested ? 'active' : ''}><span>3</span><div><strong>3. Akceptacja</strong><small>Właściciel LockOnOS</small></div></div>
        </div>

        {rejected && !editing ? (
          <>
            <div className="pending-status rejected"><ShieldCheck size={22} /><div><strong>Konto zostało odrzucone</strong><span>Możesz poprawić dane i wysłać zgłoszenie ponownie.</span></div></div>
            <button className="button secondary wide" onClick={() => setEditing(true)}>Popraw i wyślij ponownie</button>
          </>
        ) : requested && !editing ? (
          <>
            <div className="pending-status waiting">
              <Clock3 size={22} />
              <div><strong>Oczekuje na akceptację</strong><span>Nie musisz nic odświeżać. LockOnOS sprawdza status automatycznie co kilka sekund.</span></div>
              <span className="live-dot">AUTO</span>
            </div>

            <div className="request-summary request-summary-v2">
              <div><span>Punkt</span><strong>{auth.requestedPoint?.pointName}</strong><small>{auth.requestedPoint?.city}</small></div>
              <div><span>Wybrana rola</span><strong>{currentRoleDefinition.label}</strong><small>{currentRoleDefinition.description}</small></div>
            </div>

            <div className="pending-actions-row">
              <button className="button secondary" disabled={busy} onClick={() => void refresh()}><RefreshCw className={busy ? 'spin' : ''} size={17}/> Sprawdź teraz</button>
              <button className="button ghost-dark" disabled={busy} onClick={() => setEditing(true)}>Edytuj zgłoszenie</button>
            </div>
            {lastChecked && <div className="auto-check-note">Automatyczne sprawdzanie aktywne • ostatnio: {lastChecked.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>}
          </>
        ) : (
          <div className="request-form access-request-form">
            <div className="form-section-title wide"><Building2 size={17}/><div><strong>Gdzie pracujesz?</strong><span>Wpisz punkt tak, jak go znasz. Właściciel dopasuje go do właściwego punktu w systemie.</span></div></div>
            <label><span>Nazwa punktu</span><div className="input-with-icon"><Building2 size={17}/><input value={pointName} onChange={(e)=>setPointName(e.target.value)} placeholder="np. LockOn Nowogard" autoFocus /></div></label>
            <label><span>Miasto</span><input value={city} onChange={(e)=>setCity(e.target.value)} placeholder="np. Nowogard" /></label>

            <div className="form-section-title wide role-section-title"><BriefcaseBusiness size={17}/><div><strong>O jaką rolę prosisz?</strong><span>To tylko prośba. Właściciel może zatwierdzić inną rolę.</span></div></div>
            <div className="role-request-grid wide">
              {REQUESTABLE_ROLES.map((roleKey) => {
                const definition = ROLE_DEFINITIONS[roleKey];
                const selected = role === roleKey;
                return (
                  <button key={roleKey} type="button" className={`role-request-option ${selected ? 'selected' : ''}`} onClick={() => setRole(roleKey)}>
                    <span className="role-request-radio">{selected ? <Check size={13}/> : null}</span>
                    <div><strong>{definition.label}</strong><small>{definition.description}</small></div>
                  </button>
                );
              })}
            </div>

            <div className="access-confirmation wide"><UserRoundCheck size={18}/><span>Po wysłaniu zgłoszenia Twoje konto pozostanie bez dostępu do danych punktu do czasu akceptacji przez Właściciela aplikacji.</span></div>
            <button className="button primary wide" disabled={busy} onClick={() => void submit()}><Send size={17}/>{busy ? 'Wysyłam…' : requested ? 'Zapisz zmiany i wyślij ponownie' : 'Wyślij zgłoszenie do akceptacji'}</button>
            {requested && <button className="button ghost-dark wide" disabled={busy} onClick={() => setEditing(false)}>Anuluj edycję</button>}
          </div>
        )}

        {notice && <div className="pending-notice">{notice}</div>}
        <div className="session-hint"><ShieldCheck size={14}/><span>Autologowanie jest włączone. Po ponownym uruchomieniu aplikacji wrócisz do tego miejsca bez ponownego logowania Google, dopóki sesja jest ważna.</span></div>
        <button className="pending-logout" onClick={() => void onLogout()}><LogOut size={15}/> Wyloguj konto Google</button>
      </section>
    </div>
  );
}
