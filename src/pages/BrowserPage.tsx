import { FormEvent, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe2,
  Home,
  LockKeyhole,
  RefreshCw,
  Search
} from 'lucide-react';
import type { BrowserState } from '../types/electron';

const initialState: BrowserState = {
  url: 'https://www.google.com/',
  title: 'Przeglądarka',
  canGoBack: false,
  canGoForward: false,
  loading: false
};

export function BrowserPage({ meetingDockExpanded = false }: { meetingDockExpanded?: boolean }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [browser, setBrowser] = useState<BrowserState>(initialState);
  const [input, setInput] = useState(initialState.url);
  const [actionBusy, setActionBusy] = useState(false);
  const actionBusyRef = useRef(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let resizeObserver: ResizeObserver | null = null;

    const syncBounds = () => {
      const host = hostRef.current;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      void window.lockOn.browser.setBounds({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height
      });
    };

    void window.lockOn.browser.getState().then((state) => {
      setBrowser(state);
      setInput(state.url || initialState.url);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Nie udało się odczytać stanu przeglądarki.'));

    const unsubscribe = window.lockOn.browser.onState((state) => {
      setBrowser(state);
      if (state.url) setInput(state.url);
    });

    if (hostRef.current) {
      resizeObserver = new ResizeObserver(syncBounds);
      resizeObserver.observe(hostRef.current);
    }

    window.addEventListener('resize', syncBounds);
    requestAnimationFrame(syncBounds);
    const secondSync = window.setTimeout(syncBounds, 120);

    return () => {
      window.clearTimeout(secondSync);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', syncBounds);
      unsubscribe();
      void window.lockOn.browser.setVisible(false);
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const host = hostRef.current;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      void window.lockOn.browser.setBounds({
        x:rect.left,
        y:rect.top,
        width:rect.width,
        height:rect.height
      });
    }, 40);
    return () => window.clearTimeout(timer);
  }, [meetingDockExpanded]);

  const runAction = async (action: () => Promise<unknown>, fallback: string) => {
    if (actionBusyRef.current) return;
    actionBusyRef.current = true;
    setActionBusy(true);
    setError('');
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : fallback);
    } finally {
      actionBusyRef.current = false;
      setActionBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!input.trim()) return;
    void runAction(() => window.lockOn.browser.navigate(input), 'Nie udało się otworzyć tego adresu.');
  };

  return (
    <div className={'browser-page page-enter ' + (meetingDockExpanded ? 'meeting-dock-open' : '')}>
      <div className="browser-topline">
        <div>
          <span className="eyebrow"><span className="live-dot" /> PRZEGLĄDARKA</span>
          <h1>{browser.title || 'Nowa karta'}</h1>
        </div>
        <div className="browser-security"><LockKeyhole size={13} /> Bezpieczna karta</div>
      </div>

      <div className="browser-toolbar">
        <div className="browser-nav-actions">
          <button disabled={actionBusy || !browser.canGoBack} onClick={() => void runAction(() => window.lockOn.browser.back(), 'Nie udało się wrócić do poprzedniej strony.')} title="Wstecz"><ArrowLeft size={17} /></button>
          <button disabled={actionBusy || !browser.canGoForward} onClick={() => void runAction(() => window.lockOn.browser.forward(), 'Nie udało się przejść dalej.')} title="Dalej"><ArrowRight size={17} /></button>
          <button disabled={actionBusy} onClick={() => void runAction(() => window.lockOn.browser.reload(), 'Nie udało się odświeżyć strony.')} title="Odśwież"><RefreshCw className={browser.loading || actionBusy ? 'spin' : ''} size={17} /></button>
          <button disabled={actionBusy} onClick={() => void runAction(() => window.lockOn.browser.home(), 'Nie udało się otworzyć strony głównej.')} title="Strona główna"><Home size={17} /></button>
        </div>

        <form className="browser-address" onSubmit={submit}>
          <Globe2 size={14} />
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Wpisz adres lub wyszukaj…"
            spellCheck={false}
            maxLength={4096}
            disabled={actionBusy}
          />
          <button type="submit" disabled={actionBusy || !input.trim()} title="Przejdź"><Search size={16} /></button>
        </form>

        <button className="browser-external" disabled={actionBusy} onClick={() => void runAction(() => window.lockOn.browser.openExternal(), 'Nie udało się otworzyć strony w przeglądarce systemowej.')} title="Otwórz poza ServiceOS">
          <ExternalLink size={17} />
        </button>
      </div>

      <div className={'browser-loading ' + (browser.loading ? 'active' : '')}><span /></div>
      {error && <div className="browser-action-error" role="alert">{error}</div>}
      <div className="browser-host-frame">
        <div ref={hostRef} className="browser-host" />
      </div>
    </div>
  );
}
