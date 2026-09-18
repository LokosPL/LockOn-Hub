import { useState } from 'react';
import { ArrowRight, Building2, CheckCircle2, LoaderCircle, ShieldCheck } from 'lucide-react';
import logo from '../assets/logo.svg';
import type { AuthState } from '../types/electron';

interface LoginScreenProps {
  auth: AuthState;
  onAuthenticated: (state: AuthState) => void;
}

const friendlyError = (error: unknown, fallback: string) => {
  if (!(error instanceof Error) || !error.message) return fallback;
  return error.message
    .replace(/^Error invoking remote method '[^']+':\s*Error:\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim() || fallback;
};

export function LoginScreen({ auth, onAuthenticated }: LoginScreenProps) {
  const [busy, setBusy] = useState<'google' | 'local' | null>(null);
  const [message, setMessage] = useState(auth.message ?? '');

  const loginGoogle = async () => {
    setBusy('google');
    setMessage('Otwieram logowanie Google…');
    try {
      const state = await window.lockOn.auth.loginGoogle();
      if (state.authenticated) onAuthenticated(state);
      else setMessage(state.message ?? 'Nie udało się zalogować.');
    } catch (error) {
      setMessage(friendlyError(error, 'Nie udało się zalogować przez Google.'));
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
      setMessage(friendlyError(error, 'Nie udało się uruchomić trybu lokalnego.'));
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
          <div className="login-logo-wrap"><img src={logo} alt="" /></div>
          <div>
            <div className="eyebrow light">LOCKON SERVICEOS</div>
            <h1>Wróć do swojego serwisu.</h1>
            <p>Zaloguj się kontem Google. ServiceOS zapamięta sesję, więc przy kolejnym uruchomieniu wrócisz prosto do pracy.</p>
          </div>
        </div>

        <div className="login-features">
          <div><ShieldCheck size={17} /><span>Bezpieczne logowanie Google</span></div>
          <div><CheckCircle2 size={17} /><span>Autologowanie po pierwszym wejściu</span></div>
          <div><Building2 size={17} /><span>Dostęp po akceptacji konta</span></div>
        </div>

        <button className="google-login-button" disabled={Boolean(busy)} onClick={() => void loginGoogle()}>
          <span className="google-g">G</span>
          <span>{busy === 'google' ? 'Czekam na Google…' : 'Kontynuuj przez Google'}</span>
          {busy === 'google' ? <LoaderCircle className="spin" size={18} /> : <ArrowRight size={18} />}
        </button>

        {!auth.configured && (
          <div className="auth-config-note">
            Logowanie Google nie jest jeszcze poprawnie skonfigurowane w tej kompilacji.
          </div>
        )}

        {auth.localStarterLoginAllowed && (
          <button className="local-login-button" disabled={Boolean(busy)} onClick={() => void loginLocal()}>
            {busy === 'local' ? <LoaderCircle className="spin" size={16} /> : <Building2 size={16} />}
            Tryb lokalny właściciela (DEV)
          </button>
        )}

        {message && <div className="login-message">{message}</div>}

        <div className="login-help">
          Pierwsze konto bez nadanego dostępu przejdzie przez prostą weryfikację punktu i roli.
        </div>
      </section>
    </div>
  );
}
