import { BrowserWindow, WebContentsView, shell } from 'electron';
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

let view: WebContentsView | null = null;
let owner: BrowserWindow | null = null;
let visible = false;
let lastBounds: BrowserBounds = { x: 0, y: 0, width: 0, height: 0 };

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);

export const normalizeBrowserInput = (raw: string) => {
  const value = raw.trim();
  if (!value) return APP_CONFIG.browser.homeUrl;
  if (isHttpUrl(value)) return value;
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

const ensureView = (window: BrowserWindow) => {
  owner = window;
  if (view && !view.webContents.isDestroyed()) return view;

  view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      safeDialogs: true
    }
  });

  view.setBackgroundColor('#ffffff');
  window.contentView.addChildView(view);

  const webContents = view.webContents;

  webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) void webContents.loadURL(url);
    return { action: 'deny' };
  });

  webContents.on('will-navigate', (event, url) => {
    if (!isHttpUrl(url)) event.preventDefault();
  });

  webContents.on('did-start-loading', emitState);
  webContents.on('did-stop-loading', emitState);
  webContents.on('did-navigate', () => emitState());
  webContents.on('did-navigate-in-page', () => emitState());
  webContents.on('page-title-updated', () => emitState());

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
  const safe: BrowserBounds = {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(0, Math.round(bounds.width)),
    height: Math.max(0, Math.round(bounds.height))
  };
  lastBounds = safe;
  const browserView = ensureView(window);
  if (visible) browserView.setBounds(safe);
};

export const navigateBrowser = async (window: BrowserWindow, input: string) => {
  const browserView = ensureView(window);
  const url = normalizeBrowserInput(input);
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
  if (isHttpUrl(url)) await shell.openExternal(url);
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
