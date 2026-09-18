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

const safeId = (value: unknown, prefix: 'usr' | 'rev') => {
  const text = String(value ?? '');
  if (!new RegExp(`^${prefix}_[a-f0-9]{20}$`).test(text)) throw new Error('Nieprawidłowy identyfikator.');
  return text;
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

  secureHandle('access:requestPoint', async (payload: { pointName?: unknown; city?: unknown; requestedRole?: unknown }) => {
    const token = requireSessionToken();
    const safePayload = {
      pointName: String(payload?.pointName ?? '').trim().slice(0, 90),
      city: String(payload?.city ?? '').trim().slice(0, 90),
      requestedRole: String(payload?.requestedRole ?? '').trim().slice(0, 30)
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
  secureHandle('admin:createPoint', async (payload: { name?: unknown; city?: unknown }) => {
    const token = requireSessionToken();
    return backendRequest('/admin/points', {
      method: 'POST',
      body: JSON.stringify({
        name: String(payload?.name ?? '').trim().slice(0, 90),
        city: String(payload?.city ?? '').trim().slice(0, 90)
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

  secureHandle('finance:list', async () => {
    const token = requireSessionToken();
    return backendRequest('/finance/revenues', {}, token);
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
