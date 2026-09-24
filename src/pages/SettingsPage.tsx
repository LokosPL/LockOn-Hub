import { useEffect, useRef, useState } from 'react';
import { Check, Eye, MonitorUp, Palette, ShieldCheck, Sparkles } from 'lucide-react';
import { ROLE_DEFINITIONS, ROLE_ORDER, type UserRole } from '../config/roles';
import type { AppInfo, AuthState } from '../types/electron';
import {
  applyScale,
  applyTheme,
  loadUiPreferences,
  type UiScale,
  type UiTheme
} from '../uiPreferences';

interface SettingsPageProps {
  auth: AuthState;
  effectiveRole: UserRole;
  previewRole: UserRole | null;
  onPreviewRoleChange: (role: UserRole | null) => void;
}

const themes: Array<{ id: UiTheme; name: string; description: string }> = [
  { id: 'graphite', name: 'Grafit', description: 'Domyślny ciemny wygląd ServiceOS.' },
  { id: 'carbon', name: 'Carbon', description: 'Głębsza czerń i mocniejszy kontrast.' },
  { id: 'midnight', name: 'Midnight', description: 'Chłodniejszy granatowy interfejs.' }
];

const scales: Array<{ id: UiScale; name: string; description: string }> = [
  { id: 'auto', name: 'Auto', description: 'Dopasowanie do Full HD, QHD i 4K.' },
  { id: 'compact', name: 'Kompakt', description: 'Więcej treści na ekranie.' },
  { id: 'comfortable', name: 'Wygodny', description: 'Większy interfejs do pracy z dystansu.' },
  { id: 'large', name: 'Duży', description: 'Największy tekst i elementy sterujące.' }
];

export function SettingsPage({ auth, effectiveRole, previewRole, onPreviewRoleChange }: SettingsPageProps) {
  const actualRole = auth.role as UserRole;
  const [preferences, setPreferences] = useState(loadUiPreferences);
  const [scaleBusy, setScaleBusy] = useState(false);
  const scaleBusyRef = useRef(false);
  const [settingsError, setSettingsError] = useState('');
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    void window.lockOn.app.getInfo().then(setAppInfo).catch(() => setAppInfo(null));
  }, []);

  const changeTheme = (theme: UiTheme) => {
    applyTheme(theme);
    setPreferences((current) => ({ ...current, theme }));
  };

  const changeScale = async (scale: UiScale) => {
    if (scaleBusyRef.current) return;
    scaleBusyRef.current = true;
    setScaleBusy(true);
    setSettingsError('');
    try {
      await applyScale(scale);
      setPreferences((current) => ({ ...current, scale }));
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : 'Nie udało się zmienić skali interfejsu.');
    } finally {
      scaleBusyRef.current = false;
      setScaleBusy(false);
    }
  };

  return (
    <div className="settings-page page-enter">
      <section className="settings-heading">
        <div>
          <div className="eyebrow">USTAWIENIA OSOBISTE</div>
          <h1>Dopasuj ServiceOS do siebie</h1>
          <p>Motyw i wielkość interfejsu są zapisywane lokalnie na tym komputerze. Każdy użytkownik może ustawić je po swojemu, niezależnie od roli.</p>
        </div>
        <section className="panel-card team-config-card">
        <div>
          <div className="eyebrow">O APLIKACJI</div>
          <h2>LockOn ServiceOS{appInfo ? ` v${appInfo.version}` : ''}</h2>
          <p>{appInfo
            ? `Wersja produktu ${appInfo.version} · build aktualizatora ${appInfo.buildVersion}.`
            : 'Pobieram informacje o wersji…'}</p>
        </div>
      </section>

      {actualRole === 'OWNER' && (
          <div className="settings-role-card">
            <ShieldCheck size={22}/>
            <div><span>Twoja faktyczna rola</span><strong>{ROLE_DEFINITIONS[actualRole].label}</strong></div>
          </div>
        )}
      </section>

      <section className="panel-card gmail-identity-card">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">GOOGLE I GMAIL</span>
            <h2>Nadawca wiadomości serwisowych</h2>
            {actualRole === 'OWNER' ? (
              <p>Konto właściciela nie jest używane jako nadawca zwykłych wiadomości serwisowych do klientów.</p>
            ) : auth.gmailConnected && auth.gmailEmail ? (
              <p><strong>Wiadomości będą wysyłane jako: {auth.gmailEmail}</strong></p>
            ) : (
              <p>Gmail tego konta wymaga ponownego połączenia. Wyloguj się i zaloguj ponownie przez Google, aby nadać zgodę na wysyłanie.</p>
            )}
          </div>
        </div>
        {actualRole !== 'OWNER' && <div className={'gmail-identity-status '+(auth.gmailConnected?'connected':'reconnect')}>
          <span>{auth.gmailConnected?'Połączenie aktywne':'Wymaga połączenia'}</span>
          {auth.gmailStatus && <small>{auth.gmailStatus}</small>}
        </div>}
      </section>

      <section className="panel-card appearance-card">
        <div className="panel-heading">
          <div>
            <span className="eyebrow"><Palette size={13}/> WYGLĄD</span>
            <h2>Motyw aplikacji</h2>
            <p>Zmiana działa od razu i nie wymaga restartu.</p>
          </div>
          <div className="appearance-live"><Sparkles size={18}/><span>Na żywo</span></div>
        </div>

        <div className="theme-choice-grid">
          {themes.map((theme) => (
            <button
              type="button"
              key={theme.id}
              className={'theme-choice ' + (preferences.theme === theme.id ? 'selected' : '')}
              onClick={() => changeTheme(theme.id)}
            >
              <span className={'theme-preview theme-preview-' + theme.id}><i/><i/><i/></span>
              <div><strong>{theme.name}</strong><small>{theme.description}</small></div>
              <span className="theme-choice-check">{preferences.theme === theme.id ? <Check size={14}/> : null}</span>
            </button>
          ))}
        </div>

        <div className="appearance-divider"/>

        <div className="panel-heading scale-heading">
          <div>
            <span className="eyebrow"><MonitorUp size={13}/> SKALA</span>
            <h2>Wielkość interfejsu</h2>
            <p>Tryb Auto rozpoznaje duże ekrany i dodatkowo powiększa ServiceOS na QHD i 4K.</p>
          </div>
        </div>

        {settingsError && <div className="settings-action-error" role="alert">{settingsError}</div>}
        <div className="scale-choice-grid">
          {scales.map((scale) => (
            <button
              type="button"
              key={scale.id}
              className={'scale-choice ' + (preferences.scale === scale.id ? 'selected' : '')}
              disabled={scaleBusy}
              onClick={() => void changeScale(scale.id)}
            >
              <strong>{scale.name}</strong>
              <small>{scale.description}</small>
              {preferences.scale === scale.id && <Check size={15}/>} 
            </button>
          ))}
        </div>
      </section>

      {actualRole === 'OWNER' && (
        <>
          {previewRole && (
            <div className="preview-info-card">
              <Eye size={18}/>
              <div>
                <strong>Tryb podglądu jest aktywny</strong>
                <span>Oglądasz aplikację jako {ROLE_DEFINITIONS[effectiveRole].label}. Uprawnienia konta nie zostały zmienione.</span>
              </div>
            </div>
          )}

          <section className="settings-access-heading">
            <div>
              <div className="eyebrow">KONTO I UPRAWNIENIA</div>
              <h2>Role i zakresy dostępu</h2>
              <p>Ta część jest widoczna wyłącznie dla właściciela aplikacji.</p>
            </div>
          </section>

          <section className="role-cards-grid">
            {ROLE_ORDER.map((role) => {
              const d = ROLE_DEFINITIONS[role];
              return (
                <article
                  key={role}
                  className={'role-card ' + (role === actualRole ? 'current ' : '') + 'preview-clickable'}
                  onClick={() => onPreviewRoleChange(role === actualRole ? null : role)}
                >
                  <div className="role-card-topline">
                    <div className="role-card-icon"><ShieldCheck size={19}/></div>
                    <span>{role}</span>
                  </div>
                  <h2>{d.label}</h2>
                  <p>{d.description}</p>
                  <div className="role-capabilities">
                    <span><Check size={13}/> Zakres: {d.scope === 'GLOBAL' ? 'wszystkie punkty' : 'przypisane punkty'}</span>
                    <span><Check size={13}/> Moduły: {d.navigation.length}</span>
                    <span><Check size={13}/> Ustawienia wyglądu</span>
                    {d.canManageUpdates && <span><Check size={13}/> Zarządzanie aktualizacjami</span>}
                    {d.canUseSupportDesk && <span><Check size={13}/> Obsługa wsparcia</span>}
                    {d.canPreviewRoles && <span><Check size={13}/> Podgląd ról</span>}
                  </div>
                  <button className="role-preview-action" type="button">
                    <Eye size={13}/>{role === actualRole ? 'Mój widok' : 'Podejrzyj tę rolę'}
                  </button>
                </article>
              );
            })}
          </section>

          <section className="panel-card team-config-card">
            <div>
              <div className="eyebrow">ZASADA DOSTĘPU</div>
              <h2>Google → zgłoszenie punktu → weryfikacja</h2>
              <p>Użytkownik loguje się Google, podaje nazwę punktu i miasto, a konto pojawia się w <strong>Administracja</strong>. Dopiero właściciel nadaje rolę i dostęp.</p>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
