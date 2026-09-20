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
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState('');

  useEffect(() => {
    void window.lockOn.app.getInfo().then(setAppInfo).catch(() => undefined);
    void window.lockOn.updater.getState().then(setUpdate).catch(() => undefined);
    return window.lockOn.updater.onStatus((state) => {
      setUpdate(state);
      if (state.status === 'downloaded') setDismissedVersion(null);
      if (state.status !== 'downloaded') {
        setInstalling(false);
        setInstallError('');
      }
    });
  }, []);

  const installNow = async () => {
    if (installing || update.status !== 'downloaded') return;
    setInstalling(true);
    setInstallError('');
    try {
      await window.lockOn.updater.install();
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : 'Nie udało się uruchomić instalacji aktualizacji.');
      setInstalling(false);
    }
  };

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
          <span>ServiceOS spróbuje ponownie automatycznie. Możesz dalej pracować.</span>
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
          <strong>Pobieram aktualizację ServiceOS</strong>
          <span>Pracuj normalnie — ServiceOS pobiera nową wersję w tle.</span>
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
      <aside className="global-update-toast update-ready" aria-live="polite">
        <div className="global-update-icon"><Rocket size={18} /></div>
        <div className="global-update-copy">
          <strong><CheckCircle2 size={14}/> Aktualizacja ServiceOS pobrana automatycznie</strong>
          <span>
            Masz teraz v{appInfo?.version ?? '—'}. Chcesz zaktualizować aplikację teraz?
            ServiceOS sam zamknie się na moment, zaktualizuje i uruchomi ponownie.
          </span>
          {installError && <small className="global-update-action-error">{installError}</small>}
          <div className="global-update-inline-actions">
            <button className="button primary small" disabled={installing} onClick={() => void installNow()}>{installing ? 'Uruchamiam…' : 'Tak, aktualizuj'}</button>
            <button className="button ghost small" disabled={installing} onClick={() => setDismissedVersion(update.version)}>Później</button>
          </div>
        </div>
        <button className="global-update-dismiss" disabled={installing} onClick={() => setDismissedVersion(update.version)} aria-label="Później"><X size={16}/></button>
      </aside>
    );
  }

  return null;
}
