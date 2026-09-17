import { useState } from 'react';
import { ArrowRight, Building2, CheckCircle2, LoaderCircle, ShieldCheck } from 'lucide-react';
import logo from '../assets/logo.svg';
import type { AuthState } from '../types/electron';

interface LoginScreenProps {
  auth: AuthState;
  onAuthenticated: (state: AuthState) => void;
}

export function LoginScreen({ auth, onAuthenticated }: LoginScreenProps) {
  const [busy, setBusy] = useState<'google' | 'local' | null>(null);
  const [message, setMessage] = useState(auth.message ?? '');

  const loginGoogle = async () => {
    setBusy('google');
    setMessage('Otwieram bezpieczne logowanie Google w przeglądarce systemowej…');
    try {
      const state = await window.lockOn.auth.loginGoogle();
      if (state.authenticated) onAuthenticated(state);
      else setMessage(state.message ?? 'Nie udało się zalogować.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Nie udało się zalogować przez Google.');
    } finally {
      setBusy(null);
    }
  };

  const loginLocal = async () => {
    setBusy('local');
    try {
      const state = await window.lockOn.auth.loginLocal();
      onAuthenticated(state);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Nie udało się uruchomić trybu lokalnego.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="login-page page-enter">
      <div className="login-bg-orb login-bg-orb-one" />
      <div className="login-bg-orb login-bg-orb-two" />

      <section className="login-card">
        <div className="login-brand">
          <div className="login-logo-wrap"><img src={logo} alt="LockOn ServiceOS" /></div>
          <div>
            <div className="eyebrow light">LOCKON SERVICEOS</div>
            <h1>Zaloguj się do LockOnOS</h1>
            <p>Po pierwszym logowaniu podasz swój punkt i wybierzesz rolę, o którą prosisz. Właściciel aplikacji zatwierdzi lub zmieni dostęp.</p>
          </div>
        </div>

        <div className="login-features">
          <div><ShieldCheck size={18} /><span>Google OAuth 2.0 + PKCE</span></div>
          <div><Building2 size={18} /><span>Punkt + rola do akceptacji</span></div>
          <div><CheckCircle2 size={18} /><span>Autologowanie po pierwszym logowaniu</span></div>
        </div>

        <button className="google-login-button" disabled={Boolean(busy)} onClick={() => void loginGoogle()}>
          <span className="google-g">G</span>
          <span>{busy === 'google' ? 'Czekam na Google…' : 'Kontynuuj przez Google'}</span>
          {busy === 'google' ? <LoaderCircle className="spin" size={18} /> : <ArrowRight size={18} />}
        </button>

        {!auth.configured && (
          <div className="auth-config-note">
            Google nie jest jeszcze skonfigurowany. Wklej Client ID w <code>electron/appConfig.ts</code>.
          </div>
        )}

        {auth.localStarterLoginAllowed && (
          <button className="local-login-button" disabled={Boolean(busy)} onClick={() => void loginLocal()}>
            {busy === 'local' ? <LoaderCircle className="spin" size={16} /> : <Building2 size={16} />}
            Wejdź lokalnie jako Właściciel (DEV)
          </button>
        )}

        {message && <div className="login-message">{message}</div>}

        <div className="login-help">
          Nowe konto nie dostaje dostępu automatycznie. Wskazujesz punkt i rolę, a po akceptacji aplikacja odblokuje się bez ponownego logowania Google.
        </div>
      </section>
    </div>
  );
}
