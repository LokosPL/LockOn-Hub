import { useEffect, useState } from 'react';
import { CheckCircle2, Download, RefreshCw, Rocket, X } from 'lucide-react';
import type { AppInfo, UpdateState } from '../types/electron';

const initialState: UpdateState = {
  status: 'idle',
  message: 'Aktualizator jest gotowy.'
};

export function UpdatePrompt() {
  const [update, setUpdate] = useState<UpdateState>(initialState);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);

  useEffect(() => {
    void window.lockOn.app.getInfo().then(setAppInfo).catch(() => undefined);
    void window.lockOn.updater.getState().then(setUpdate).catch(() => undefined);
    return window.lockOn.updater.onStatus((state) => {
      setUpdate(state);
      if (state.status === 'downloaded') setDismissedVersion(null);
    });
  }, []);

  const version =
    update.status === 'available' || update.status === 'downloaded' || update.status === 'not-available'
      ? update.version
      : '';

  const hidden =
    update.status === 'idle' ||
    update.status === 'checking' ||
    update.status === 'not-available' ||
    update.status === 'development' ||
    (update.status === 'downloaded' && dismissedVersion === update.version);

  if (hidden) return null;

  if (update.status === 'error') {
    return (
      <aside className="global-update-toast update-error" aria-live="polite">
        <div className="global-update-icon"><RefreshCw size={18} /></div>
        <div className="global-update-copy">
          <strong>Nie udało się sprawdzić aktualizacji</strong>
          <span>Spróbujemy ponownie automatycznie. Możesz dalej korzystać z aplikacji.</span>
        </div>
      </aside>
    );
  }

  if (update.status === 'available' || update.status === 'downloading') {
    const percent = update.status === 'downloading' ? update.percent : 0;
    return (
      <aside className="global-update-toast" aria-live="polite">
        <div className="global-update-icon"><Download size={18} /></div>
        <div className="global-update-copy">
          <strong>Pobieram aktualizację {version ? 'v' + version : ''}</strong>
          <span>Możesz dalej pracować. Instalator pobiera się w tle.</span>
          {update.status === 'downloading' && (
            <div className="global-update-progress" aria-label={'Pobrano ' + percent + '%'}>
              <i style={{ width: percent + '%' }} />
            </div>
          )}
        </div>
        {update.status === 'downloading' && <b>{percent}%</b>}
      </aside>
    );
  }

  if (update.status === 'downloaded') {
    return (
      <div className="global-update-backdrop">
        <section className="global-update-modal" role="dialog" aria-modal="true" aria-label="Aktualizacja gotowa">
          <button
            className="global-update-close"
            onClick={() => setDismissedVersion(update.version)}
            aria-label="Zainstaluj później"
          >
            <X size={18} />
          </button>

          <div className="global-update-hero-icon"><Rocket size={25} /></div>
          <div className="eyebrow light"><CheckCircle2 size={13} /> AKTUALIZACJA GOTOWA</div>
          <h2>ServiceOS v{update.version}<br /><span>jest gotowy do instalacji.</span></h2>
          <p>
            Masz teraz v{appInfo?.version ?? '—'}. Nowa wersja została już pobrana w tle.
            ServiceOS zaktualizuje się po cichu w tym samym folderze i uruchomi ponownie.
          </p>

          <div className="global-update-actions">
            <button className="button primary" onClick={() => void window.lockOn.updater.install()}>
              Uruchom ponownie i zaktualizuj
            </button>
            <button className="button ghost" onClick={() => setDismissedVersion(update.version)}>
              Później
            </button>
          </div>

          <small>Bez kreatora instalacji i bez ponownego wyboru użytkownika lub katalogu.</small>
        </section>
      </div>
    );
  }

  return null;
}
