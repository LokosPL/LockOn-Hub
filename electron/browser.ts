import { BrowserWindow, WebContentsView, session, shell } from 'electron';
import { APP_CONFIG } from './appConfig';

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

const BROWSER_PARTITION = 'persist:lockon-browser';

let view: WebContentsView | null = null;
let owner: BrowserWindow | null = null;
let visible = false;
let lastBounds: BrowserBounds = { x: 0, y: 0, width: 0, height: 0 };
let browserSessionConfigured = false;

const isLoopbackHost = (hostname: string) =>
  hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';

const isAllowedBrowserUrl = (value: string) => {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
};

export const normalizeBrowserInput = (raw: string) => {
  const value = raw.trim();
  if (!value) return APP_CONFIG.browser.homeUrl;

  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'https:') return parsed.toString();
    if (parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname)) return parsed.toString();
    if (parsed.protocol === 'http:') {
      parsed.protocol = 'https:';
      return parsed.toString();
    }
  } catch {
    // Nie jest pełnym URL-em. Obsłużymy domenę lub zapytanie wyszukiwania poniżej.
  }

  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(value)) return `https://${value}`;
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
};

const state = (): BrowserState => {
  if (!view || view.webContents.isDestroyed()) {
    return {
      url: APP_CONFIG.browser.homeUrl,
      title: 'Przeglądarka',
      canGoBack: false,
      canGoForward: false,
      loading: false
    };
  }

  return {
    url: view.webContents.getURL() || APP_CONFIG.browser.homeUrl,
    title: view.webContents.getTitle() || 'Przeglądarka',
    canGoBack: view.webContents.navigationHistory.canGoBack(),
    canGoForward: view.webContents.navigationHistory.canGoForward(),
    loading: view.webContents.isLoading()
  };
};

const emitState = () => {
  if (!owner || owner.isDestroyed()) return;
  owner.webContents.send('browser:state', state());
};

const configureBrowserSession = () => {
  if (browserSessionConfigured) return;
  browserSessionConfigured = true;

  const browserSession = session.fromPartition(BROWSER_PARTITION);
  browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  browserSession.setPermissionCheckHandler(() => false);

  // Wbudowana przeglądarka nie pobiera plików bez wiedzy aplikacji.
  // Użytkownik może otworzyć stronę w domyślnej przeglądarce systemowej.
  browserSession.on('will-download', (event) => {
    event.preventDefault();
  });
};

const ensureView = (window: BrowserWindow) => {
  owner = window;
  if (view && !view.webContents.isDestroyed()) return view;

  configureBrowserSession();

  view = new WebContentsView({
    webPreferences: {
      partition: BROWSER_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      safeDialogs: true,
      devTools: false
    }
  });

  view.setBackgroundColor('#0b0f14');
  view.setBorderRadius(14);
  window.contentView.addChildView(view);

  const webContents = view.webContents;

  webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedBrowserUrl(url)) void webContents.loadURL(url);
    return { action: 'deny' };
  });

  webContents.on('will-navigate', (event, url) => {
    if (!isAllowedBrowserUrl(url)) event.preventDefault();
  });

  webContents.on('will-redirect', (event, url) => {
    if (!isAllowedBrowserUrl(url)) event.preventDefault();
  });

  webContents.on('did-start-loading', emitState);
  webContents.on('did-stop-loading', emitState);
  webContents.on('did-navigate', emitState);
  webContents.on('did-navigate-in-page', emitState);
  webContents.on('page-title-updated', emitState);
  webContents.on('render-process-gone', emitState);

  void webContents.loadURL(APP_CONFIG.browser.homeUrl);
  view.setVisible(false);
  return view;
};

export const attachBrowser = (window: BrowserWindow) => {
  ensureView(window);
};

export const setBrowserVisible = (window: BrowserWindow, nextVisible: boolean) => {
  const browserView = ensureView(window);
  visible = nextVisible;
  browserView.setVisible(nextVisible);
  if (nextVisible) {
    browserView.setBounds(lastBounds);
    browserView.webContents.focus();
  }
  emitState();
};

export const setBrowserBounds = (window: BrowserWindow, bounds: BrowserBounds) => {
  // getBoundingClientRect() returns renderer CSS pixels. When the ServiceOS renderer
  // is zoomed on QHD/4K, WebContentsView still expects BrowserWindow content pixels.
  // Convert the coordinates back to window pixels so the embedded browser stays
  // perfectly aligned with its dark frame at every UI scale.
  const zoom = Math.max(0.5, Math.min(2, window.webContents.getZoomFactor() || 1));
  const safe: BrowserBounds = {
    x: Math.max(0, Math.round((Number(bounds.x) || 0) * zoom)),
    y: Math.max(0, Math.round((Number(bounds.y) || 0) * zoom)),
    width: Math.min(10_000, Math.max(0, Math.round((Number(bounds.width) || 0) * zoom))),
    height: Math.min(10_000, Math.max(0, Math.round((Number(bounds.height) || 0) * zoom)))
  };
  lastBounds = safe;
  const browserView = ensureView(window);
  browserView.setBorderRadius(Math.max(10, Math.round(14 * zoom)));
  if (visible) browserView.setBounds(safe);
};

export const navigateBrowser = async (window: BrowserWindow, input: string) => {
  const browserView = ensureView(window);
  const url = normalizeBrowserInput(String(input || '').slice(0, 4096));
  if (!isAllowedBrowserUrl(url)) throw new Error('Ten adres nie jest dozwolony.');
  await browserView.webContents.loadURL(url);
  return state();
};

export const browserBack = (window: BrowserWindow) => {
  const browserView = ensureView(window);
  if (browserView.webContents.navigationHistory.canGoBack()) {
    browserView.webContents.navigationHistory.goBack();
  }
  return state();
};

export const browserForward = (window: BrowserWindow) => {
  const browserView = ensureView(window);
  if (browserView.webContents.navigationHistory.canGoForward()) {
    browserView.webContents.navigationHistory.goForward();
  }
  return state();
};

export const browserReload = (window: BrowserWindow) => {
  const browserView = ensureView(window);
  browserView.webContents.reload();
  return state();
};

export const browserHome = async (window: BrowserWindow) =>
  navigateBrowser(window, APP_CONFIG.browser.homeUrl);

export const browserOpenExternal = async (window: BrowserWindow) => {
  const browserView = ensureView(window);
  const url = browserView.webContents.getURL();
  if (!isAllowedBrowserUrl(url)) return;
  await shell.openExternal(url);
};

export const getBrowserState = () => state();

export const destroyBrowser = () => {
  if (owner && view) {
    try {
      owner.contentView.removeChildView(view);
    } catch {
      // Okno może być już niszczone.
    }
  }
  view = null;
  owner = null;
  visible = false;
};
