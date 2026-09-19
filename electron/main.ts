import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  screen,
  session,
  type IpcMainInvokeEvent
} from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { APP_CONFIG } from './appConfig';
import { backendRequest, getBackendApiBaseUrl, setBackendApiBaseUrl } from './backendApi';
import {
  browserBack,
  browserForward,
  browserHome,
  browserOpenExternal,
  browserReload,
  destroyBrowser,
  getBrowserState,
  navigateBrowser,
  setBrowserBounds,
  setBrowserVisible,
  type BrowserBounds
} from './browser';
import {
  getAuthState,
  getStoredApiToken,
  loginLocalStarter,
  loginWithGoogle,
  logout
} from './googleAuth';
import { connectGmailSender, disconnectGmailSender, getGmailConnectionStatus } from './gmailAuth';
import {
  checkForUpdates,
  checkForUpdatesIfStale,
  configureUpdater,
  downloadUpdate,
  getUpdateState,
  installUpdate,
  startAutomaticUpdateChecks,
  stopAutomaticUpdateChecks
} from './updater';

app.enableSandbox();

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let mainReady: Promise<void> = Promise.resolve();
let localApiProcess: ChildProcess | null = null;

const APP_PROTOCOL = 'lockon-serviceos';
let pendingProtocolFocus = false;

const focusMainWindow = () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingProtocolFocus = true;
    return;
  }
  pendingProtocolFocus = false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
};

const handleProtocolUrl = (value: string) => {
  try {
    const url = new URL(value);
    if (url.protocol !== APP_PROTOCOL + ':' || url.hostname !== 'login-complete') return false;
    focusMainWindow();
    return true;
  } catch {
    return false;
  }
};

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    const deepLink = commandLine.find((arg) => arg.startsWith(APP_PROTOCOL + '://'));
    if (!deepLink || !handleProtocolUrl(deepLink)) focusMainWindow();
  });
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleProtocolUrl(url);
  });
}

const rendererUrl = (view?: string) => {
  if (isDevelopment) {
    const url = new URL(process.env.VITE_DEV_SERVER_URL!);
    if (view) url.searchParams.set('view', view);
    return url.toString();
  }
  const url = pathToFileURL(path.join(__dirname, '../dist/index.html'));
  if (view) url.searchParams.set('view', view);
  return url.toString();
};

const isTrustedRendererUrl = (value: string) => {
  try {
    const url = new URL(value);
    if (isDevelopment) {
      return url.origin === new URL(process.env.VITE_DEV_SERVER_URL!).origin;
    }
    return url.protocol === 'file:';
  } catch {
    return false;
  }
};

const protectLocalWindow = (window: BrowserWindow) => {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault();
  });
  window.webContents.on('will-redirect', (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault();
  });
};

const windowSize = () => {
  const { width: workWidth, height: workHeight } = screen.getPrimaryDisplay().workAreaSize;
  return {
    width: Math.min(1840, Math.max(1040, Math.floor(workWidth * 0.88))),
    height: Math.min(1120, Math.max(680, Math.floor(workHeight * 0.88)))
  };
};

type UiScaleMode = 'auto' | 'compact' | 'comfortable' | 'large';

const automaticUiZoom = () => {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  if (width >= 3000 || height >= 1800) return 1.32;
  if (width >= 2400 || height >= 1400) return 1.18;
  if (width >= 1900 || height >= 1100) return 1.06;
  return 1;
};

const resolveUiZoom = (mode: UiScaleMode) => {
  const base = automaticUiZoom();
  const multiplier = mode === 'compact' ? 0.92 : mode === 'comfortable' ? 1.08 : mode === 'large' ? 1.18 : 1;
  return Math.max(0.9, Math.min(1.55, Number((base * multiplier).toFixed(2))));
};

const reserveLoopbackPort = () => new Promise<number>((resolve, reject) => {
  const probe = net.createServer();
  probe.unref();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const address = probe.address();
    if (!address || typeof address === 'string') {
      probe.close();
      reject(new Error('Nie udało się wybrać portu dla lokalnego API.'));
      return;
    }
    const port = address.port;
    probe.close((error) => error ? reject(error) : resolve(port));
  });
});

const waitForApi = async (baseUrl: string, timeoutMs = 7000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`, {
        method: 'GET',
        cache: 'no-store',
        signal: AbortSignal.timeout(900)
      });
      if (response.ok) {
        const payload = await response.json() as { ok?: boolean };
        if (payload.ok === true) return true;
      }
    } catch {}
    await delay(220);
  }
  return false;
};

const shouldStartBundledApi = () => {
  if (isDevelopment) return false;
  try {
    const api = new URL(APP_CONFIG.backend.apiBaseUrl);
    return ['127.0.0.1', 'localhost'].includes(api.hostname);
  } catch {
    return false;
  }
};

const startBundledApi = async () => {
  if (!shouldStartBundledApi() || localApiProcess) return;

  const dataFile = path.join(app.getPath('userData'), 'database.json');
  const serverScript = path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-server', 'index.cjs');
  const logFile = path.join(app.getPath('userData'), 'backend.log');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const port = await reserveLoopbackPort();
    const baseUrl = `http://127.0.0.1:${port}`;
    setBackendApiBaseUrl(baseUrl);

    const childEnv: NodeJS.ProcessEnv = {
      ELECTRON_RUN_AS_NODE: '1',
      LOCKON_API_HOST: '127.0.0.1',
      LOCKON_API_PORT: String(port),
      LOCKON_DATA_FILE: dataFile,
      LOCKON_OWNER_EMAIL: 'nowogar@gmail.com',
      LOCKON_GOOGLE_CLIENT_ID: APP_CONFIG.auth.googleClientId,
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      USERPROFILE: process.env.USERPROFILE,
      HOME: process.env.HOME,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
      APPDATA: process.env.APPDATA,
      ComSpec: process.env.ComSpec
    };

    const child = spawn(process.execPath, [serverScript], {
      env: childEnv,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    localApiProcess = child;

    const appendLog = (prefix: string, chunk: unknown) => {
      try {
        fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${prefix} ${String(chunk)}\n`, 'utf8');
      } catch {}
    };

    child.stdout?.on('data', (chunk) => appendLog('OUT', chunk));
    child.stderr?.on('data', (chunk) => appendLog('ERR', chunk));
    child.once('error', (error) => {
      appendLog('SPAWN', error instanceof Error ? error.stack ?? error.message : error);
      if (localApiProcess === child) localApiProcess = null;
    });
    child.once('exit', (code, signal) => {
      appendLog('EXIT', `code=${code ?? 'null'} signal=${signal ?? 'null'}`);
      if (localApiProcess === child) localApiProcess = null;
    });

    if (await waitForApi(baseUrl)) {
      appendLog('READY', `LockOn API gotowe: ${baseUrl}`);
      return;
    }

    appendLog('RETRY', `API nie wystartowało, próba ${attempt}/3`);
    if (!child.killed) child.kill();
    if (localApiProcess === child) localApiProcess = null;
    await delay(250);
  }

  throw new Error(`Lokalne LockOn API nie uruchomiło się. Szczegóły: ${logFile}`);
};

const secureWebPreferences = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  devTools: isDevelopment,
  spellcheck: false
} as const;

const createSplashWindow = () => {
  splashWindow = new BrowserWindow({
    width: 610,
    height: 390,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    show: false,
    alwaysOnTop: true,
    center: true,
    hasShadow: true,
    webPreferences: secureWebPreferences
  });
  protectLocalWindow(splashWindow);
  void splashWindow.loadURL(rendererUrl('splash'));
  splashWindow.once('ready-to-show', () => splashWindow?.show());
};

const createMainWindow = () => {
  const size = windowSize();
  mainWindow = new BrowserWindow({
    ...size,
    minWidth: 900,
    minHeight: 620,
    frame: false,
    backgroundColor: '#090a0c',
    show: false,
    center: true,
    resizable: true,
    maximizable: true,
    title: APP_CONFIG.name,
    webPreferences: secureWebPreferences
  });

  protectLocalWindow(mainWindow);
  mainWindow.webContents.setZoomFactor(resolveUiZoom('auto'));

  // Nie twórz WebContentsView przeglądarki podczas startu aplikacji.
  // Po aktualizacji Windows potrafi uruchomić ServiceOS zanim cały profil
  // przeglądarki zdąży się ustabilizować. Przeglądarka powstanie dopiero,
  // gdy użytkownik faktycznie otworzy zakładkę "Przeglądarka".
  const windowRef = mainWindow;
  const url = rendererUrl();

  mainReady = (async () => {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await windowRef.loadURL(url);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 3) await delay(350 * attempt);
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Nie udało się załadować głównego interfejsu.');
  })().catch((error) => {
    console.error('[LockOn renderer startup]', error);
  });

  mainWindow.on('focus', () => {
    void checkForUpdatesIfStale().catch(() => undefined);
  });

  mainWindow.on('closed', () => {
    destroyBrowser();
    mainWindow = null;
  });
};

const pushSplashProgress = (percent: number, label: string) => {
  splashWindow?.webContents.send('splash:progress', { percent, label });
};
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const runStartupSequence = async () => {
  const stages = [
    { percent: 12, label: 'Uruchamianie LockOn ServiceOS…', delay: 200 },
    { percent: 30, label: 'Ładowanie interfejsu…', delay: 230 },
    { percent: 50, label: 'Łączenie z LockOn API…', delay: 260 },
    { percent: 68, label: 'Przygotowanie punktów i uprawnień…', delay: 260 },
    { percent: 86, label: 'Finalizowanie interfejsu…', delay: 260 }
  ];
  for (const stage of stages) {
    pushSplashProgress(stage.percent, stage.label);
    await delay(stage.delay);
  }
  // Nie pozwalamy, aby splash został na 86% w nieskończoność.
  // Po aktualizacji "ready-to-show" potrafi nie nadejść mimo załadowanego renderera,
  // dlatego opieramy start na loadURL i dodajemy twardy bezpiecznik czasowy.
  await Promise.race([mainReady, delay(8_000)]);
  pushSplashProgress(100, 'Gotowe.');
  await delay(200);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
  splashWindow?.close();
  splashWindow = null;
};

const withMainWindow = <T>(callback: (window: BrowserWindow) => T): T | undefined => {
  if (!mainWindow || mainWindow.isDestroyed()) return undefined;
  return callback(mainWindow);
};

const requireSessionToken = () => {
  const token = getStoredApiToken();
  if (!token) throw new Error('Brak aktywnej sesji LockOn. Zaloguj się ponownie.');
  return token;
};

const requireOwner = async () => {
  const state = await getAuthState(isDevelopment);
  if (!state.authenticated || state.role !== 'OWNER' || state.status !== 'ACTIVE') {
    throw new Error('Ta operacja wymaga roli Właściciel aplikacji.');
  }
};

const assertTrustedIpc = (event: IpcMainInvokeEvent) => {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Główne okno aplikacji nie jest dostępne.');
  if (event.sender.id !== mainWindow.webContents.id) throw new Error('Odrzucono niezaufane wywołanie IPC.');
  const senderFrame = event.senderFrame;
  if (!senderFrame || !isTrustedRendererUrl(senderFrame.url)) throw new Error('Odrzucono wywołanie z niezaufanego źródła.');
};

type SecureHandler = (...args: any[]) => unknown;

const secureHandle = (channel: string, listener: SecureHandler) => {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedIpc(event);
    return listener(...args);
  });
};

const safeId = (value: unknown, prefix: 'usr' | 'rev' | 'srv' | 'ntf' | 'cst' | 'trf' | 'sup' | 'cqr') => {
  const text = String(value ?? '');
  const pattern = new RegExp('^' + prefix + '_[a-f0-9]{20}' + '$');
  if (!pattern.test(text)) throw new Error('Nieprawidłowy identyfikator.');
  return text;
};

const measureFetch = async (url: string, init: RequestInit = {}, timeoutMs = 15_000) => {
  const started = performance.now();
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.arrayBuffer();
  return { elapsedMs: Math.max(1, performance.now() - started), bytes: body.byteLength };
};

const runInternetSpeedTest = async () => {
  const latencySamples: number[] = [];
  for (let index = 0; index < 3; index += 1) {
    const started = performance.now();
    const response = await fetch('https://speed.cloudflare.com/__down?bytes=1000', {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error(`Serwer testowy zwrócił HTTP ${response.status}.`);
    await response.arrayBuffer();
    latencySamples.push(performance.now() - started);
  }

  const download = await measureFetch('https://speed.cloudflare.com/__down?bytes=5000000', {}, 20_000);
  const downloadMbps = Number(((download.bytes * 8) / (download.elapsedMs * 1000)).toFixed(1));

  let uploadMbps: number | null = null;
  let uploadWarning: string | null = null;
  try {
    const uploadBytes = 1_000_000;
    const uploadBody = Buffer.alloc(uploadBytes, 0x61);
    const started = performance.now();
    const response = await fetch('https://speed.cloudflare.com/__up', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: uploadBody,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await response.arrayBuffer().catch(() => new ArrayBuffer(0));
    const elapsedMs = Math.max(1, performance.now() - started);
    uploadMbps = Number(((uploadBytes * 8) / (elapsedMs * 1000)).toFixed(1));
  } catch {
    uploadWarning = 'Nie udało się wiarygodnie zmierzyć wysyłania. Pobieranie i opóźnienie zostały zmierzone poprawnie.';
  }

  const latencyMs = Number((latencySamples.reduce((sum, value) => sum + value, 0) / latencySamples.length).toFixed(0));
  const quality = downloadMbps >= 100 && latencyMs <= 35
    ? 'Bardzo dobre'
    : downloadMbps >= 30 && latencyMs <= 70
      ? 'Dobre'
      : downloadMbps >= 10 && latencyMs <= 120
        ? 'Wystarczające'
        : 'Słabe';

  return {
    testedAt: new Date().toISOString(),
    downloadMbps,
    uploadMbps,
    latencyMs,
    quality,
    provider: 'Cloudflare speed test',
    warning: uploadWarning
  };
};

const runConnectivityDiagnostics = async () => {
  const started = performance.now();
  let apiOk = false;
  let apiLatencyMs: number | null = null;
  let apiError: string | null = null;
  try {
    const response = await fetch(getBackendApiBaseUrl() + '/health', {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(5000)
    });
    apiOk = response.ok;
    apiLatencyMs = Number((performance.now() - started).toFixed(0));
    if (!response.ok) apiError = `HTTP ${response.status}`;
  } catch (error) {
    apiError = error instanceof Error ? error.message : 'Brak połączenia';
  }

  let internetOk = false;
  let internetLatencyMs: number | null = null;
  try {
    const internetStarted = performance.now();
    const response = await fetch('https://speed.cloudflare.com/__down?bytes=1000', {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(5000)
    });
    internetOk = response.ok;
    await response.arrayBuffer();
    internetLatencyMs = Number((performance.now() - internetStarted).toFixed(0));
  } catch {}

  return {
    testedAt: new Date().toISOString(),
    internetOk,
    internetLatencyMs,
    apiOk,
    apiLatencyMs,
    apiError,
    version: app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged,
    apiBaseUrl: getBackendApiBaseUrl()
  };
};

const registerIpc = () => {
  secureHandle('app:getInfo', () => ({
    name: APP_CONFIG.name,
    author: APP_CONFIG.author,
    version: app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged,
    apiBaseUrl: getBackendApiBaseUrl()
  }));

  secureHandle('ui:setScale', (scale: UiScaleMode) => {
    const safeScale: UiScaleMode = ['auto', 'compact', 'comfortable', 'large'].includes(scale) ? scale : 'auto';
    const factor = resolveUiZoom(safeScale);
    mainWindow?.webContents.setZoomFactor(factor);
    return factor;
  });

  secureHandle('window:minimize', () => mainWindow?.minimize());
  secureHandle('window:toggleMaximize', () => {
    if (!mainWindow) return;
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  });
  secureHandle('window:close', () => mainWindow?.close());

  secureHandle('auth:getState', () => getAuthState(isDevelopment));
  secureHandle('auth:loginGoogle', () => loginWithGoogle(isDevelopment));
  secureHandle('auth:loginLocal', () => loginLocalStarter(isDevelopment));
  secureHandle('auth:logout', async () => {
    withMainWindow((window) => setBrowserVisible(window, false));
    return logout(isDevelopment);
  });

  secureHandle('access:requestPoint', async (payload: { pointName?: unknown; city?: unknown; requestedRole?: unknown; technicianSplitPercent?: unknown }) => {
    const token = requireSessionToken();
    const split = payload?.technicianSplitPercent === null || payload?.technicianSplitPercent === undefined || payload?.technicianSplitPercent === ''
      ? null
      : Number(payload.technicianSplitPercent);
    const safePayload = {
      pointName: String(payload?.pointName ?? '').trim().slice(0, 90),
      city: String(payload?.city ?? '').trim().slice(0, 90),
      requestedRole: String(payload?.requestedRole ?? '').trim().slice(0, 30),
      technicianSplitPercent: split
    };
    await backendRequest('/access/request-point', {
      method: 'POST',
      body: JSON.stringify(safePayload)
    }, token);
    return getAuthState(isDevelopment);
  });

  secureHandle('admin:getOverview', async () => {
    const token = requireSessionToken();
    return backendRequest('/admin/overview', {}, token);
  });
  secureHandle('admin:getAudit', async (filters: { userId?: unknown; pointId?: unknown; action?: unknown; orderNumber?: unknown; dateFrom?: unknown; dateTo?: unknown } = {}) => {
    const token = requireSessionToken();
    const params = new URLSearchParams();
    for (const key of ['userId','pointId','action','orderNumber','dateFrom','dateTo'] as const) {
      const value = String(filters?.[key] ?? '').trim().slice(0, 120);
      if (value) params.set(key, value);
    }
    const suffix = params.toString() ? '?' + params.toString() : '';
    return backendRequest('/admin/audit' + suffix, {}, token);
  });
  secureHandle('admin:createPoint', async (payload: { name?: unknown; city?: unknown; serviceEnabled?: unknown; acceptsExternalRepairs?: unknown; serviceNote?: unknown }) => {
    const token = requireSessionToken();
    return backendRequest('/admin/points', {
      method: 'POST',
      body: JSON.stringify({
        name: String(payload?.name ?? '').trim().slice(0, 90),
        city: String(payload?.city ?? '').trim().slice(0, 90),
        serviceEnabled: payload?.serviceEnabled === true,
        acceptsExternalRepairs: payload?.acceptsExternalRepairs === true,
        serviceNote: String(payload?.serviceNote ?? '').trim().slice(0, 500)
      })
    }, token);
  });
  secureHandle('admin:approveUser', async (userId: string, payload: unknown) => {
    const token = requireSessionToken();
    return backendRequest(`/admin/users/${encodeURIComponent(safeId(userId, 'usr'))}/approve`, {
      method: 'POST',
      body: JSON.stringify(payload)
    }, token);
  });
  secureHandle('admin:rejectUser', async (userId: string) => {
    const token = requireSessionToken();
    return backendRequest(`/admin/users/${encodeURIComponent(safeId(userId, 'usr'))}/reject`, {
      method: 'POST',
      body: '{}'
    }, token);
  });
  secureHandle('admin:updateUserAccess', async (userId: string, payload: unknown) => {
    const token = requireSessionToken();
    return backendRequest(`/admin/users/${encodeURIComponent(safeId(userId, 'usr'))}/access`, {
      method: 'POST',
      body: JSON.stringify(payload)
    }, token);
  });

  secureHandle('admin:updatePointService', async (pointId: string, payload: unknown) => {
    const token = requireSessionToken();
    const safePointId = String(pointId ?? '').trim().slice(0, 80);
    return backendRequest(`/admin/points/${encodeURIComponent(safePointId)}/service`, {
      method: 'POST',
      body: JSON.stringify(payload)
    }, token);
  });
  secureHandle('admin:blockUser', async (userId: string, blocked: boolean, reason?: string) => {
    const token = requireSessionToken();
    return backendRequest(`/admin/users/${encodeURIComponent(safeId(userId, 'usr'))}/block`, {
      method: 'POST',
      body: JSON.stringify({ blocked: Boolean(blocked), reason: String(reason ?? '').trim().slice(0, 500) })
    }, token);
  });
  secureHandle('admin:logoutUserSessions', async (userId: string) => {
    const token = requireSessionToken();
    return backendRequest(`/admin/users/${encodeURIComponent(safeId(userId, 'usr'))}/logout-all`, {
      method: 'POST',
      body: '{}'
    }, token);
  });
  secureHandle('admin:logoutAllSessions', async (exceptCurrent = true) => {
    const token = requireSessionToken();
    return backendRequest('/admin/logout-all', {
      method: 'POST',
      body: JSON.stringify({ exceptCurrent: exceptCurrent !== false })
    }, token);
  });
  secureHandle('admin:factoryResetPreview', async () => {
    const token = requireSessionToken();
    return backendRequest('/admin/factory-reset/preview', {}, token);
  });
  secureHandle('admin:factoryReset', async (payload: unknown) => {
    const token = requireSessionToken();
    return backendRequest('/admin/factory-reset', {
      method: 'POST',
      body: JSON.stringify(payload)
    }, token);
  });

  secureHandle('finance:list', async () => {
    const token = requireSessionToken();
    return backendRequest('/finance/revenues', {}, token);
  });
  secureHandle('finance:getTechnicianSettings', async () => {
    const token = requireSessionToken();
    return backendRequest('/finance/technician-settings', {}, token);
  });
  secureHandle('finance:updateTechnicianSettings', async (technicianPercent: number) => {
    const token = requireSessionToken();
    return backendRequest('/finance/technician-settings', {
      method: 'POST',
      body: JSON.stringify({ technicianPercent:Number(technicianPercent) })
    }, token);
  });
  secureHandle('finance:submit', async (payload: unknown) => {
    const token = requireSessionToken();
    return backendRequest('/finance/revenues', { method: 'POST', body: JSON.stringify(payload) }, token);
  });
  secureHandle('finance:review', async (revenueId: string, action: 'APPROVE' | 'REJECT') => {
    if (!['APPROVE', 'REJECT'].includes(action)) throw new Error('Nieprawidłowa akcja.');
    const token = requireSessionToken();
    return backendRequest(`/finance/revenues/${encodeURIComponent(safeId(revenueId, 'rev'))}/review`, {
      method: 'POST',
      body: JSON.stringify({ action })
    }, token);
  });
  secureHandle('data:getDashboard', async () => {
    const token = requireSessionToken();
    return backendRequest('/dashboard', {}, token);
  });

  secureHandle('service:searchCustomers', async (query: string) => {
    const token = requireSessionToken();
    const safeQuery = String(query ?? '').trim().slice(0, 120);
    if (safeQuery.length < 2) return [];
    return backendRequest(`/service/customers/search?q=${encodeURIComponent(safeQuery)}`, {}, token);
  });
  secureHandle('service:getCustomer', async (customerId: string) => {
    const token = requireSessionToken();
    return backendRequest(`/service/customers/${encodeURIComponent(safeId(customerId, 'cst'))}`, {}, token);
  });
  secureHandle('service:listTechnicians', async (pointId: string) => {
    const token = requireSessionToken();
    const safePointId = String(pointId ?? '').trim().slice(0, 80);
    return backendRequest(`/service/technicians?pointId=${encodeURIComponent(safePointId)}`, {}, token);
  });
  secureHandle('service:listServicePoints', async () => {
    const token = requireSessionToken();
    return backendRequest('/service/service-points', {}, token);
  });
  secureHandle('service:listTransfers', async (incoming = false, status?: string) => {
    const token = requireSessionToken();
    const params = new URLSearchParams();
    if (incoming) params.set('incoming', '1');
    const cleanStatus = String(status ?? '').trim().slice(0, 30);
    if (cleanStatus) params.set('status', cleanStatus);
    return backendRequest('/service/transfers' + (params.size ? '?' + params.toString() : ''), {}, token);
  });
  secureHandle('service:transferOrder', async (orderId: string, payload: unknown) => {
    const token = requireSessionToken();
    return backendRequest(`/service/orders/${encodeURIComponent(safeId(orderId, 'srv'))}/transfer`, {
      method: 'POST',
      body: JSON.stringify(payload)
    }, token);
  });
  secureHandle('service:updateTransferStatus', async (transferId: string, status: string, note?: string) => {
    const token = requireSessionToken();
    return backendRequest(`/service/transfers/${encodeURIComponent(safeId(transferId, 'trf'))}/status`, {
      method: 'POST',
      body: JSON.stringify({
        status: String(status ?? '').trim().slice(0, 30),
        note: String(note ?? '').trim().slice(0, 500)
      })
    }, token);
  });

  secureHandle('service:createOrder', async (payload: unknown) => {
    const token = requireSessionToken();
    return backendRequest('/service/orders', {
      method: 'POST',
      body: JSON.stringify(payload)
    }, token);
  });
  secureHandle('service:listOrders', async () => {
    const token = requireSessionToken();
    return backendRequest('/service/orders', {}, token);
  });
  secureHandle('service:getHistory', async (orderId: string) => {
    const token = requireSessionToken();
    return backendRequest(`/service/orders/${encodeURIComponent(safeId(orderId, 'srv'))}/history`, {}, token);
  });
  secureHandle('service:getNotes', async (orderId: string) => {
    const token = requireSessionToken();
    return backendRequest(`/service/orders/${encodeURIComponent(safeId(orderId, 'srv'))}/notes`, {}, token);
  });
  secureHandle('service:addNote', async (orderId: string, body: string) => {
    const token = requireSessionToken();
    return backendRequest(`/service/orders/${encodeURIComponent(safeId(orderId, 'srv'))}/notes`, {
      method: 'POST',
      body: JSON.stringify({ body: String(body ?? '').trim().slice(0, 2000) })
    }, token);
  });
  secureHandle('service:updateDetails', async (orderId: string, payload: unknown) => {
    const token = requireSessionToken();
    return backendRequest(`/service/orders/${encodeURIComponent(safeId(orderId, 'srv'))}/details`, {
      method: 'POST',
      body: JSON.stringify(payload)
    }, token);
  });
  secureHandle('service:updateStatus', async (orderId: string, status: string, note?: string, actingPointId?: string) => {
    const token = requireSessionToken();
    return backendRequest(`/service/orders/${encodeURIComponent(safeId(orderId, 'srv'))}/status`, {
      method: 'POST',
      body: JSON.stringify({
        status: String(status ?? '').trim().slice(0, 30),
        note: String(note ?? '').trim().slice(0, 500),
        actingPointId: String(actingPointId ?? '').trim().slice(0, 80)
      })
    }, token);
  });
  secureHandle('service:listCustomerQuotes', async (pointId?: string) => {
    const token = requireSessionToken();
    const params = new URLSearchParams();
    const cleanPointId = String(pointId ?? '').trim().slice(0, 80);
    if (cleanPointId) params.set('pointId', cleanPointId);
    return backendRequest('/service/customer-quotes' + (params.size ? '?' + params.toString() : ''), {}, token);
  });
  secureHandle('service:replyCustomerQuote', async (requestId: string, message: string) => {
    const token = requireSessionToken();
    return backendRequest(`/service/customer-quotes/${encodeURIComponent(safeId(requestId, 'cqr'))}/reply`, {
      method:'POST',
      body:JSON.stringify({message:String(message ?? '').trim().slice(0,1000)})
    }, token);
  });
  secureHandle('service:priceCustomerQuote', async (requestId: string, amount: number, note?: string) => {
    const token = requireSessionToken();
    return backendRequest(`/service/customer-quotes/${encodeURIComponent(safeId(requestId, 'cqr'))}/quote`, {
      method:'POST',
      body:JSON.stringify({amount:Number(amount),note:String(note ?? '').trim().slice(0,1000)})
    }, token);
  });
  secureHandle('service:closeCustomerQuote', async (requestId: string) => {
    const token = requireSessionToken();
    return backendRequest(`/service/customer-quotes/${encodeURIComponent(safeId(requestId, 'cqr'))}/close`, {method:'POST',body:'{}'}, token);
  });

  secureHandle('gmail:getStatus', (pointId: string) =>
    getGmailConnectionStatus(String(pointId ?? '').trim().slice(0, 80))
  );
  secureHandle('gmail:connect', (pointId: string) =>
    connectGmailSender(String(pointId ?? '').trim().slice(0, 80))
  );
  secureHandle('gmail:disconnect', (pointId: string) =>
    disconnectGmailSender(String(pointId ?? '').trim().slice(0, 80))
  );
  secureHandle('gmail:test', async (pointId: string) => {
    const token = requireSessionToken();
    return backendRequest('/integrations/gmail/test', {
      method: 'POST',
      body: JSON.stringify({ pointId: String(pointId ?? '').trim().slice(0, 80) })
    }, token);
  });

  secureHandle('notifications:getSettings', async (pointId: string) => {
    const token = requireSessionToken();
    return backendRequest(`/notifications/settings?pointId=${encodeURIComponent(String(pointId ?? '').trim().slice(0, 80))}`, {}, token);
  });
  secureHandle('notifications:updateSettings', async (payload: unknown) => {
    const token = requireSessionToken();
    return backendRequest('/notifications/settings', {
      method: 'POST',
      body: JSON.stringify(payload)
    }, token);
  });
  secureHandle('notifications:getHistory', async (pointId: string) => {
    const token = requireSessionToken();
    return backendRequest(`/notifications/history?pointId=${encodeURIComponent(String(pointId ?? '').trim().slice(0, 80))}`, {}, token);
  });
  secureHandle('notifications:retry', async (notificationId: string) => {
    const token = requireSessionToken();
    return backendRequest(`/notifications/${encodeURIComponent(safeId(notificationId, 'ntf'))}/retry`, {
      method: 'POST',
      body: '{}'
    }, token);
  });

  secureHandle('assistant:getConversation', async () => {
    const token = requireSessionToken();
    return backendRequest('/support/conversation', {}, token);
  });
  secureHandle('assistant:send', async (message: string) => {
    const token = requireSessionToken();
    return backendRequest('/assistant/chat', {
      method: 'POST',
      body: JSON.stringify({ message: String(message ?? '').trim().slice(0, 1500) })
    }, token);
  });
  secureHandle('diagnostics:internetSpeed', async () => {
    requireSessionToken();
    return runInternetSpeedTest();
  });
  secureHandle('diagnostics:connectivity', async () => {
    requireSessionToken();
    return runConnectivityDiagnostics();
  });
  secureHandle('support:request', async (pointId?: string, message?: string) => {
    const token = requireSessionToken();
    return backendRequest('/support/request', { method:'POST', body:JSON.stringify({pointId:String(pointId ?? '').trim().slice(0,80),message:String(message ?? '').trim().slice(0,1500)}) }, token);
  });
  secureHandle('support:presence', async () => backendRequest('/support/presence', {}, requireSessionToken()));
  secureHandle('support:listTickets', async () => backendRequest('/support/tickets', {}, requireSessionToken()));
  secureHandle('support:take', async (ticketId: string) => backendRequest('/support/tickets/' + encodeURIComponent(safeId(ticketId,'sup')) + '/take', {method:'POST',body:'{}'}, requireSessionToken()));
  secureHandle('support:reply', async (ticketId: string, message: string) => backendRequest('/support/tickets/' + encodeURIComponent(safeId(ticketId,'sup')) + '/reply', {method:'POST',body:JSON.stringify({message:String(message ?? '').trim().slice(0,2000)})}, requireSessionToken()));
  secureHandle('support:close', async (ticketId: string) => backendRequest('/support/tickets/' + encodeURIComponent(safeId(ticketId,'sup')) + '/close', {method:'POST',body:'{}'}, requireSessionToken()));
  secureHandle('website:createAuthCode', async () => {
    const token = requireSessionToken();
    return backendRequest('/website/auth-code', { method: 'POST', body: '{}' }, token);
  });

  secureHandle('browser:getState', () => getBrowserState());
  secureHandle('browser:setVisible', (value: boolean) =>
    withMainWindow((window) => setBrowserVisible(window, Boolean(value)))
  );
  secureHandle('browser:setBounds', (bounds: BrowserBounds) =>
    withMainWindow((window) => setBrowserBounds(window, bounds))
  );
  secureHandle('browser:navigate', (input: string) =>
    withMainWindow((window) => navigateBrowser(window, String(input ?? '').slice(0, 4096)))
  );
  secureHandle('browser:back', () => withMainWindow(browserBack));
  secureHandle('browser:forward', () => withMainWindow(browserForward));
  secureHandle('browser:reload', () => withMainWindow(browserReload));
  secureHandle('browser:home', () => withMainWindow(browserHome));
  secureHandle('browser:openExternal', () => withMainWindow(browserOpenExternal));

  secureHandle('update:getState', () => getUpdateState());
  // Aktualizacja aplikacji nie zależy od zalogowanej roli.
  // Wywołanie nadal jest chronione przez trusted IPC i mechanizm electron-updater.
  secureHandle('update:check', () => checkForUpdates());
  secureHandle('update:download', () => downloadUpdate());
  secureHandle('update:install', () => installUpdate());
};

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);

  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient(APP_PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(APP_PROTOCOL);
  }
  const startupDeepLink = process.argv.find((arg) => arg.startsWith(APP_PROTOCOL + '://'));
  if (startupDeepLink) handleProtocolUrl(startupDeepLink);

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  try {
    await startBundledApi();
  } catch (error) {
    console.error('[LockOn API startup]', error);
  }
  registerIpc();
  configureUpdater();
  startAutomaticUpdateChecks();
  createSplashWindow();
  createMainWindow();
  await delay(380);
  await runStartupSequence();
  if (pendingProtocolFocus) focusMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
      void mainReady.then(() => mainWindow?.show());
    }
  });
});

app.on('before-quit', () => {
  stopAutomaticUpdateChecks();
  if (localApiProcess && !localApiProcess.killed) localApiProcess.kill();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
);
  if (!pattern.test(text)) throw new Error('Nieprawidłowy identyfikator.');
  return text;
};

const measureFetch = async (url: string, init: RequestInit = {}, timeoutMs = 15_000) => {
  const started = performance.now();
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.arrayBuffer();
  return { elapsedMs: Math.max(1, performance.now() - started), bytes: body.byteLength };
};

const runInternetSpeedTest = async () => {
  const latencySamples: number[] = [];
  for (let index = 0; index < 3; index += 1) {
    const started = performance.now();
    const response = await fetch('https://speed.cloudflare.com/__down?bytes=1000', {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error(`Serwer testowy zwrócił HTTP ${response.status}.`);
    await response.arrayBuffer();
    latencySamples.push(performance.now() - started);
  }

  const download = await measureFetch('https://speed.cloudflare.com/__down?bytes=5000000', {}, 20_000);
  const downloadMbps = Number(((download.bytes * 8) / (download.elapsedMs * 1000)).toFixed(1));

  let uploadMbps: number | null = null;
  let uploadWarning: string | null = null;
  try {
    const uploadBytes = 1_000_000;
    const uploadBody = Buffer.alloc(uploadBytes, 0x61);
    const started = performance.now();
    const response = await fetch('https://speed.cloudflare.com/__up', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: uploadBody,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await response.arrayBuffer().catch(() => new ArrayBuffer(0));
    const elapsedMs = Math.max(1, performance.now() - started);
    uploadMbps = Number(((uploadBytes * 8) / (elapsedMs * 1000)).toFixed(1));
  } catch {
    uploadWarning = 'Nie udało się wiarygodnie zmierzyć wysyłania. Pobieranie i opóźnienie zostały zmierzone poprawnie.';
  }

  const latencyMs = Number((latencySamples.reduce((sum, value) => sum + value, 0) / latencySamples.length).toFixed(0));
  const quality = downloadMbps >= 100 && latencyMs <= 35
    ? 'Bardzo dobre'
    : downloadMbps >= 30 && latencyMs <= 70
      ? 'Dobre'
      : downloadMbps >= 10 && latencyMs <= 120
        ? 'Wystarczające'
        : 'Słabe';

  return {
    testedAt: new Date().toISOString(),
    downloadMbps,
    uploadMbps,
    latencyMs,
    quality,
    provider: 'Cloudflare speed test',
    warning: uploadWarning
  };
};

const runConnectivityDiagnostics = async () => {
  const started = performance.now();
  let apiOk = false;
  let apiLatencyMs: number | null = null;
  let apiError: string | null = null;
  try {
    const response = await fetch(getBackendApiBaseUrl() + '/health', {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(5000)
    });
    apiOk = response.ok;
    apiLatencyMs = Number((performance.now() - started).toFixed(0));
    if (!response.ok) apiError = `HTTP ${response.status}`;
  } catch (error) {
    apiError = error instanceof Error ? error.message : 'Brak połączenia';
  }

  let internetOk = false;
  let internetLatencyMs: number | null = null;
  try {
    const internetStarted = performance.now();
    const response = await fetch('https://speed.cloudflare.com/__down?bytes=1000', {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(5000)
    });
    internetOk = response.ok;
    await response.arrayBuffer();
    internetLatencyMs = Number((performance.now() - internetStarted).toFixed(0));
  } catch {}

  return {
    testedAt: new Date().toISOString(),
    internetOk,
    internetLatencyMs,
    apiOk,
    apiLatencyMs,
    apiError,
    version: app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged,
    apiBaseUrl: getBackendApiBaseUrl()
  };
};

const registerIpc = () => {
  secureHandle('app:getInfo', () => ({
    name: APP_CONFIG.name,
    author: APP_CONFIG.author,
    version: app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged,
    apiBaseUrl: getBackendApiBaseUrl()
  }));

  secureHandle('ui:setScale', (scale: UiScaleMode) => {
    const safeScale: UiScaleMode = ['auto', 'compact', 'comfortable', 'large'].includes(scale) ? scale : 'auto';
    const factor = resolveUiZoom(safeScale);
    mainWindow?.webContents.setZoomFactor(factor);
    return factor;
  });

  secureHandle('window:minimize', () => mainWindow?.minimize());
  secureHandle('window:toggleMaximize', () => {
    if (!mainWindow) return;
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  });
  secureHandle('window:close', () => mainWindow?.close());

  secureHandle('auth:getState', () => getAuthState(isDevelopment));
  secureHandle('auth:loginGoogle', () => loginWithGoogle(isDevelopment));
  secureHandle('auth:loginLocal', () => loginLocalStarter(isDevelopment));
  secureHandle('auth:logout', async () => {
    withMainWindow((window) => setBrowserVisible(window, false));
    return logout(isDevelopment);
  });

  secureHandle('access:requestPoint', async (payload: { pointName?: unknown; city?: unknown; requestedRole?: unknown; technicianSplitPercent?: unknown }) => {
    const token = requireSessionToken();
    const split = payload?.technicianSplitPercent === null || payload?.technicianSplitPercent === undefined || payload?.technicianSplitPercent === ''
      ? null
      : Number(payload.technicianSplitPercent);
    const safePayload = {
      pointName: String(payload?.pointName ?? '').trim().slice(0, 90),
      city: String(payload?.city ?? '').trim().slice(0, 90),
      requestedRole: String(payload?.requestedRole ?? '').trim().slice(0, 30),
      technicianSplitPercent: split
    };
    await backendRequest('/access/request-point', {
      method: 'POST',
      body: JSON.stringify(safePayload)
    }, token);
    return getAuthState(isDevelopment);
  });

  secureHandle('admin:getOverview', async () => {
    const token = requireSessionToken();
    return backendRequest('/admin/overview', {}, token);
  });
  secureHandle('admin:getAudit', async (filters: { userId?: unknown; pointId?: unknown; action?: unknown; orderNumber?: unknown; dateFrom?: unknown; dateTo?: unknown } = {}) => {
    const token = requireSessionToken();
    const params = new URLSearchParams();
    for (const key of ['userId','pointId','action','orderNumber','dateFrom','dateTo'] as const) {
      const value = String(filters?.[key] ?? '').trim().slice(0, 120);
      if (value) params.set(key, value);
    }
    const suffix = params.toString() ? '?' + params.toString() : '';
    return backendRequest('/admin/audit' + suffix, {}, token);
  });
  secureHandle('admin:createPoint', async (payload: { name?: unknown; city?: unknown; serviceEnabled?: unknown; acceptsExternalRepairs?: unknown; serviceNote?: unknown }) => {
    const token = requireSessionToken();
    return backendRequest('/admin/points', {
      method: 'POST',
      body: JSON.stringify({
        name: String(payload?.name ?? '').trim().slice(0, 90),
        city: String(payload?.city ?? '').trim().slice(0, 90),
        serviceEnabled: payload?.serviceEnabled === true,
        acceptsExternalRepairs: payload?.acceptsExternalRepairs === true,
        serviceNote: String(payload?.serviceNote ?? '').trim().slice(0, 500)
      })
    }, token);
  });
  secureHandle('admin:approveUser', async (userId: string, payload: unknown) => {
    const token = requireSessionToken();
    return backendRequest(`/admin/users/${encodeURIComponent(safeId(userId, 'usr'))}/approve`, {
      method: 'POST',
      body: JSON.stringify(payload)
    }, token);
  });
  secureHandle('admin:rejectUser', async (userId: string) => {
    const token = requireSessionToken();
    return backendRequest(`/admin/users/${encodeURIComponent(safeId(userId, 'usr'))}/reject`, {
      method: 'POST',
      body: '{}'
    }, token);
  });
  secureHandle('admin:updateUserAccess', async (userId: string, payload: unknown) => {
    const token = requireSessionToken();
    return backendRequest(`/admin/users/${encodeURIComponent(safeId(userId, 'usr'))}/access`, {
      method: 'POST',
      body: JSON.stringify(payload)
    }, token);
  });

  secureHandle('admin:updatePointService', async (pointId: string, payload: unknown) => {
    const token = requireSessionToken();
    const safePointId = String(pointId ?? '').trim().slice(0, 80);
    return backendRequest(`/admin/points/${encodeURIComponent(safePointId)}/service`, {
      method: 'POST',
      body: JSON.stringify(payload)
    }, token);
  });
  secureHandle('admin:blockUser', async (userId: string, blocked: boolean, reason?: string) => {
    const token = requireSessionToken();
    return backendRequest(`/admin/users/${encodeURIComponent(safeId(userId, 'usr'))}/block`, {
      method: 'POST',
      body: JSON.stringify({ blocked: Boolean(blocked), reason: String(reason ?? '').trim().slice(0, 500) })
    }, token);
  });
  secureHandle('admin:logoutUserSessions', async (userId: string) => {
    const token = requireSessionToken();
    return backendRequest(`/admin/users/${encodeURIComponent(safeId(userId, 'usr'))}/logout-all`, {
      method: 'POST',
      body: '{}'
    }, token);
  });
  secureHandle('admin:logoutAllSessions', async (exceptCurrent = true) => {
    const token = requireSessionToken();
    return backendRequest('/admin/logout-all', {
      method: 'POST',
      body: JSON.stringify({ exceptCurrent: exceptCurrent !== false })
    }, token);
  });
  secureHandle('admin:factoryResetPreview', async () => {
    const token = requireSessionToken();
    return backendRequest('/admin/factory-reset/preview', {}, token);
  });
  secureHandle('admin:factoryReset', async (payload: unknown) => {
    const token = requireSessionToken();
    return backendRequest('/admin/factory-reset', {
      method: 'POST',
      body: JSON.stringify(payload)
    }, token);
  });

  secureHandle('finance:list', async () => {
    const token = requireSessionToken();
    return backendRequest('/finance/revenues', {}, token);
  });
  secureHandle('finance:getTechnicianSettings', async () => {
    const token = requireSessionToken();
    return backendRequest('/finance/technician-settings', {}, token);
  });
  secureHandle('finance:updateTechnicianSettings', async (technicianPercent: number) => {
    const token = requireSessionToken();
    return backendRequest('/finance/technician-settings', {
      method: 'POST',
      body: JSON.stringify({ technicianPercent:Number(technicianPercent) })
    }, token);
  });
  secureHandle('finance:submit', async (payload: unknown) => {
    const token = requireSessionToken();
    return backendRequest('/finance/revenues', { method: 'POST', body: JSON.stringify(payload) }, token);
  });
  secureHandle('finance:review', async (revenueId: string, action: 'APPROVE' | 'REJECT') => {
    if (!['APPROVE', 'REJECT'].includes(action)) throw new Error('Nieprawidłowa akcja.');
    const token = requireSessionToken();
    return backendRequest(`/finance/revenues/${encodeURIComponent(safeId(revenueId, 'rev'))}/review`, {
      method: 'POST',
      body: JSON.stringify({ action })
    }, token);
  });
  secureHandle('data:getDashboard', async () => {
    const token = requireSessionToken();
    return backendRequest('/dashboard', {}, token);
  });

  secureHandle('service:searchCustomers', async (query: string) => {
    const token = requireSessionToken();
    const safeQuery = String(query ?? '').trim().slice(0, 120);
    if (safeQuery.length < 2) return [];
    return backendRequest(`/service/customers/search?q=${encodeURIComponent(safeQuery)}`, {}, token);
  });
  secureHandle('service:getCustomer', async (customerId: string) => {
    const token = requireSessionToken();
    return backendRequest(`/service/customers/${encodeURIComponent(safeId(customerId, 'cst'))}`, {}, token);
  });
  secureHandle('service:listTechnicians', async (pointId: string) => {
    const token = requireSessionToken();
    const safePointId = String(pointId ?? '').trim().slice(0, 80);
    return backendRequest(`/service/technicians?pointId=${encodeURIComponent(safePointId)}`, {}, token);
  });
  secureHandle('service:listServicePoints', async () => {
    const token = requireSessionToken();
    return backendRequest('/service/service-points', {}, token);
  });
  secureHandle('service:listTransfers', async (incoming = false, status?: string) => {
    const token = requireSessionToken();
    const params = new URLSearchParams();
    if (incoming) params.set('incoming', '1');
    const cleanStatus = String(status ?? '').trim().slice(0, 30);
    if (cleanStatus) params.set('status', cleanStatus);
    return backendRequest('/service/transfers' + (params.size ? '?' + params.toString() : ''), {}, token);
  });
  secureHandle('service:transferOrder', async (orderId: string, payload: unknown) => {
    const token = requireSessionToken();
    return backendRequest(`/service/orders/${encodeURIComponent(safeId(orderId, 'srv'))}/transfer`, {
      method: 'POST',
      body: JSON.stringify(payload)
    }, token);
  });
  secureHandle('service:updateTransferStatus', async (transferId: string, status: string, note?: string) => {
    const token = requireSessionToken();
    return backendRequest(`/service/transfers/${encodeURIComponent(safeId(transferId, 'trf'))}/status`, {
      method: 'POST',
      body: JSON.stringify({
        status: String(status ?? '').trim().slice(0, 30),
        note: String(note ?? '').trim().slice(0, 500)
      })
    }, token);
  });

  secureHandle('service:createOrder', async (payload: unknown) => {
    const token = requireSessionToken();
    return backendRequest('/service/orders', {
      method: 'POST',
      body: JSON.stringify(payload)
    }, token);
  });
  secureHandle('service:listOrders', async () => {
    const token = requireSessionToken();
    return backendRequest('/service/orders', {}, token);
  });
  secureHandle('service:getHistory', async (orderId: string) => {
    const token = requireSessionToken();
    return backendRequest(`/service/orders/${encodeURIComponent(safeId(orderId, 'srv'))}/history`, {}, token);
  });
  secureHandle('service:getNotes', async (orderId: string) => {
    const token = requireSessionToken();
    return backendRequest(`/service/orders/${encodeURIComponent(safeId(orderId, 'srv'))}/notes`, {}, token);
  });
  secureHandle('service:addNote', async (orderId: string, body: string) => {
    const token = requireSessionToken();
    return backendRequest(`/service/orders/${encodeURIComponent(safeId(orderId, 'srv'))}/notes`, {
      method: 'POST',
      body: JSON.stringify({ body: String(body ?? '').trim().slice(0, 2000) })
    }, token);
  });
  secureHandle('service:updateDetails', async (orderId: string, payload: unknown) => {
    const token = requireSessionToken();
    return backendRequest(`/service/orders/${encodeURIComponent(safeId(orderId, 'srv'))}/details`, {
      method: 'POST',
      body: JSON.stringify(payload)
    }, token);
  });
  secureHandle('service:updateStatus', async (orderId: string, status: string, note?: string, actingPointId?: string) => {
    const token = requireSessionToken();
    return backendRequest(`/service/orders/${encodeURIComponent(safeId(orderId, 'srv'))}/status`, {
      method: 'POST',
      body: JSON.stringify({
        status: String(status ?? '').trim().slice(0, 30),
        note: String(note ?? '').trim().slice(0, 500),
        actingPointId: String(actingPointId ?? '').trim().slice(0, 80)
      })
    }, token);
  });
  secureHandle('service:listCustomerQuotes', async (pointId?: string) => {
    const token = requireSessionToken();
    const params = new URLSearchParams();
    const cleanPointId = String(pointId ?? '').trim().slice(0, 80);
    if (cleanPointId) params.set('pointId', cleanPointId);
    return backendRequest('/service/customer-quotes' + (params.size ? '?' + params.toString() : ''), {}, token);
  });
  secureHandle('service:replyCustomerQuote', async (requestId: string, message: string) => {
    const token = requireSessionToken();
    return backendRequest(`/service/customer-quotes/${encodeURIComponent(safeId(requestId, 'cqr'))}/reply`, {
      method:'POST',
      body:JSON.stringify({message:String(message ?? '').trim().slice(0,1000)})
    }, token);
  });
  secureHandle('service:priceCustomerQuote', async (requestId: string, amount: number, note?: string) => {
    const token = requireSessionToken();
    return backendRequest(`/service/customer-quotes/${encodeURIComponent(safeId(requestId, 'cqr'))}/quote`, {
      method:'POST',
      body:JSON.stringify({amount:Number(amount),note:String(note ?? '').trim().slice(0,1000)})
    }, token);
  });
  secureHandle('service:closeCustomerQuote', async (requestId: string) => {
    const token = requireSessionToken();
    return backendRequest(`/service/customer-quotes/${encodeURIComponent(safeId(requestId, 'cqr'))}/close`, {method:'POST',body:'{}'}, token);
  });

  secureHandle('gmail:getStatus', (pointId: string) =>
    getGmailConnectionStatus(String(pointId ?? '').trim().slice(0, 80))
  );
  secureHandle('gmail:connect', (pointId: string) =>
    connectGmailSender(String(pointId ?? '').trim().slice(0, 80))
  );
  secureHandle('gmail:disconnect', (pointId: string) =>
    disconnectGmailSender(String(pointId ?? '').trim().slice(0, 80))
  );
  secureHandle('gmail:test', async (pointId: string) => {
    const token = requireSessionToken();
    return backendRequest('/integrations/gmail/test', {
      method: 'POST',
      body: JSON.stringify({ pointId: String(pointId ?? '').trim().slice(0, 80) })
    }, token);
  });

  secureHandle('notifications:getSettings', async (pointId: string) => {
    const token = requireSessionToken();
    return backendRequest(`/notifications/settings?pointId=${encodeURIComponent(String(pointId ?? '').trim().slice(0, 80))}`, {}, token);
  });
  secureHandle('notifications:updateSettings', async (payload: unknown) => {
    const token = requireSessionToken();
    return backendRequest('/notifications/settings', {
      method: 'POST',
      body: JSON.stringify(payload)
    }, token);
  });
  secureHandle('notifications:getHistory', async (pointId: string) => {
    const token = requireSessionToken();
    return backendRequest(`/notifications/history?pointId=${encodeURIComponent(String(pointId ?? '').trim().slice(0, 80))}`, {}, token);
  });
  secureHandle('notifications:retry', async (notificationId: string) => {
    const token = requireSessionToken();
    return backendRequest(`/notifications/${encodeURIComponent(safeId(notificationId, 'ntf'))}/retry`, {
      method: 'POST',
      body: '{}'
    }, token);
  });

  secureHandle('assistant:getConversation', async () => {
    const token = requireSessionToken();
    return backendRequest('/support/conversation', {}, token);
  });
  secureHandle('assistant:send', async (message: string) => {
    const token = requireSessionToken();
    return backendRequest('/assistant/chat', {
      method: 'POST',
      body: JSON.stringify({ message: String(message ?? '').trim().slice(0, 1500) })
    }, token);
  });
  secureHandle('diagnostics:internetSpeed', async () => {
    requireSessionToken();
    return runInternetSpeedTest();
  });
  secureHandle('diagnostics:connectivity', async () => {
    requireSessionToken();
    return runConnectivityDiagnostics();
  });
  secureHandle('support:request', async (pointId?: string, message?: string) => {
    const token = requireSessionToken();
    return backendRequest('/support/request', { method:'POST', body:JSON.stringify({pointId:String(pointId ?? '').trim().slice(0,80),message:String(message ?? '').trim().slice(0,1500)}) }, token);
  });
  secureHandle('support:presence', async () => backendRequest('/support/presence', {}, requireSessionToken()));
  secureHandle('support:listTickets', async () => backendRequest('/support/tickets', {}, requireSessionToken()));
  secureHandle('support:take', async (ticketId: string) => backendRequest('/support/tickets/' + encodeURIComponent(safeId(ticketId,'sup')) + '/take', {method:'POST',body:'{}'}, requireSessionToken()));
  secureHandle('support:reply', async (ticketId: string, message: string) => backendRequest('/support/tickets/' + encodeURIComponent(safeId(ticketId,'sup')) + '/reply', {method:'POST',body:JSON.stringify({message:String(message ?? '').trim().slice(0,2000)})}, requireSessionToken()));
  secureHandle('support:close', async (ticketId: string) => backendRequest('/support/tickets/' + encodeURIComponent(safeId(ticketId,'sup')) + '/close', {method:'POST',body:'{}'}, requireSessionToken()));
  secureHandle('website:createAuthCode', async () => {
    const token = requireSessionToken();
    return backendRequest('/website/auth-code', { method: 'POST', body: '{}' }, token);
  });

  secureHandle('browser:getState', () => getBrowserState());
  secureHandle('browser:setVisible', (value: boolean) =>
    withMainWindow((window) => setBrowserVisible(window, Boolean(value)))
  );
  secureHandle('browser:setBounds', (bounds: BrowserBounds) =>
    withMainWindow((window) => setBrowserBounds(window, bounds))
  );
  secureHandle('browser:navigate', (input: string) =>
    withMainWindow((window) => navigateBrowser(window, String(input ?? '').slice(0, 4096)))
  );
  secureHandle('browser:back', () => withMainWindow(browserBack));
  secureHandle('browser:forward', () => withMainWindow(browserForward));
  secureHandle('browser:reload', () => withMainWindow(browserReload));
  secureHandle('browser:home', () => withMainWindow(browserHome));
  secureHandle('browser:openExternal', () => withMainWindow(browserOpenExternal));

  secureHandle('update:getState', () => getUpdateState());
  // Aktualizacja aplikacji nie zależy od zalogowanej roli.
  // Wywołanie nadal jest chronione przez trusted IPC i mechanizm electron-updater.
  secureHandle('update:check', () => checkForUpdates());
  secureHandle('update:download', () => downloadUpdate());
  secureHandle('update:install', () => installUpdate());
};

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);

  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient(APP_PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(APP_PROTOCOL);
  }
  const startupDeepLink = process.argv.find((arg) => arg.startsWith(APP_PROTOCOL + '://'));
  if (startupDeepLink) handleProtocolUrl(startupDeepLink);

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  try {
    await startBundledApi();
  } catch (error) {
    console.error('[LockOn API startup]', error);
  }
  registerIpc();
  configureUpdater();
  startAutomaticUpdateChecks();
  createSplashWindow();
  createMainWindow();
  await delay(380);
  await runStartupSequence();
  if (pendingProtocolFocus) focusMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
      void mainReady.then(() => mainWindow?.show());
    }
  });
});

app.on('before-quit', () => {
  stopAutomaticUpdateChecks();
  if (localApiProcess && !localApiProcess.killed) localApiProcess.kill();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
