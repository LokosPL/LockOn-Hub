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

export function BrowserPage() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [browser, setBrowser] = useState<BrowserState>(initialState);
  const [input, setInput] = useState(initialState.url);

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
    });
    void window.lockOn.browser.setVisible(true);

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

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void window.lockOn.browser.navigate(input);
  };

  return (
    <div className="browser-page page-enter">
      <div className="browser-topline">
        <div>
          <span className="eyebrow">WBUDOWANA PRZEGLĄDARKA</span>
          <h1>{browser.title || 'Przeglądarka'}</h1>
        </div>
        <div className="browser-security"><LockKeyhole size={14} /> Chromium / sandbox</div>
      </div>

      <div className="browser-toolbar">
        <div className="browser-nav-actions">
          <button disabled={!browser.canGoBack} onClick={() => void window.lockOn.browser.back()} title="Wstecz"><ArrowLeft size={17} /></button>
          <button disabled={!browser.canGoForward} onClick={() => void window.lockOn.browser.forward()} title="Dalej"><ArrowRight size={17} /></button>
          <button onClick={() => void window.lockOn.browser.reload()} title="Odśwież"><RefreshCw className={browser.loading ? 'spin' : ''} size={17} /></button>
          <button onClick={() => void window.lockOn.browser.home()} title="Strona główna"><Home size={17} /></button>
        </div>

        <form className="browser-address" onSubmit={submit}>
          <Globe2 size={15} />
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Wpisz adres strony lub szukaj w Google…"
            spellCheck={false}
          />
          <button type="submit" title="Przejdź"><Search size={16} /></button>
        </form>

        <button className="browser-external" onClick={() => void window.lockOn.browser.openExternal()} title="Otwórz w domyślnej przeglądarce">
          <ExternalLink size={17} />
        </button>
      </div>

      <div className="browser-host-frame">
        <div ref={hostRef} className="browser-host" />
      </div>
    </div>
  );
}
