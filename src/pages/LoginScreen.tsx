import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Building2, CheckCircle2, LoaderCircle, ShieldCheck } from 'lucide-react';
import logo from '../assets/logo.svg';
import type { AuthState } from '../types/electron';

interface LoginScreenProps {
  auth: AuthState;
  onAuthenticated: (state: AuthState) => void;
}

const GOOGLE_SESSION_RECOVERY_INTERVAL_MS = 1_500;

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
  const googleCompletedRef = useRef(false);

  useEffect(() => {
    if (busy !== 'google') return;
    let cancelled = false;
    let checking = false;

    const recoverPersistedSession = async () => {
      if (checking || googleCompletedRef.current) return;
      checking = true;
      try {
        const state = await window.lockOn.auth.getState();
        if (!cancelled && state.authenticated) {
          googleCompletedRef.current = true;
          setMessage('Sesja Google potwierdzona. Otwieram ServiceOS…');
          setBusy(null);
          onAuthenticated(state);
        }
      } catch {
        // Główne wywołanie loginGoogle nadal obsługuje błędy. Ten polling jest
        // wyłącznie awaryjnym odzyskaniem sesji zapisanej już przez proces główny.
      } finally {
        checking = false;
      }
    };

    const first = window.setTimeout(() => void recoverPersistedSession(), GOOGLE_SESSION_RECOVERY_INTERVAL_MS);
    const timer = window.setInterval(() => void recoverPersistedSession(), GOOGLE_SESSION_RECOVERY_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [busy, onAuthenticated]);

  const loginGoogle = async () => {
    googleCompletedRef.current = false;
    setBusy('google');
    setMessage('Otwieram bezpieczne logowanie Google. Dokończ je w przeglądarce — ServiceOS poczeka na Ciebie.');
    try {
      const state = await window.lockOn.auth.loginGoogle();
      if (googleCompletedRef.current) return;
      if (!state.authenticated) {
        setMessage(state.message ?? 'Nie udało się zalogować.');
        return;
      }

      googleCompletedRef.current = true;
      setMessage('Zalogowano. Otwieram ServiceOS…');
      onAuthenticated(state);
    } catch (error) {
      if (googleCompletedRef.current) return;
      // Zanim pokażemy błąd, robimy ostatnią próbę odczytu zapisanej sesji.
      // Chroni to przypadek, w którym OAuth zakończył się poprawnie, ale odpowiedź IPC zaginęła.
      try {
        const recovered = await window.lockOn.auth.getState();
        if (recovered.authenticated) {
          googleCompletedRef.current = true;
          setMessage('Sesja Google została odzyskana. Otwieram ServiceOS…');
          onAuthenticated(recovered);
          return;
        }
      } catch {}
      setMessage(friendlyError(error, 'Nie udało się zalogować przez Google.'));
    } finally {
      if (!googleCompletedRef.current) setBusy(null);
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
          <div><CheckCircle2 size={17} /><span>Jedno logowanie obejmuje wysyłkę Gmail przez ServiceOS</span></div>
          <div><Building2 size={17} /><span>Dostęp i punkty kontrolowane przez ServiceOS</span></div>
        </div>

        <button className="google-login-button" disabled={Boolean(busy)} onClick={() => void loginGoogle()}>
          <span className="google-g">G</span>
          <span>{busy === 'google' ? 'Kończę logowanie i potwierdzam sesję…' : 'Kontynuuj przez Google'}</span>
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
          Podczas tego samego logowania Google ServiceOS poprosi również o zakres gmail.send. Sesja ServiceOS kończy się niezależnie od opcjonalnego przygotowania Gmaila, więc nie trzeba restartować aplikacji, gdy Google odpowiada wolniej.
        </div>
      </section>
    </div>
  );
}
