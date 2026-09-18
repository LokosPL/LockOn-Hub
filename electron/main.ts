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
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { APP_CONFIG } from './appConfig';
import { backendRequest } from './backendApi';
import {
  attachBrowser,
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
    width: Math.min(1540, Math.max(1040, Math.floor(workWidth * 0.86))),
    height: Math.min(960, Math.max(680, Math.floor(workHeight * 0.86)))
  };
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
  const serverScript = path.join(process.resourcesPath, 'app.asar.unpacked', 'server', 'index.mjs');

  const childEnv: NodeJS.ProcessEnv = {
    ELECTRON_RUN_AS_NODE: '1',
    LOCKON_API_HOST: '127.0.0.1',
    LOCKON_API_PORT: '8787',
    LOCKON_DATA_FILE: dataFile,
    LOCKON_OWNER_EMAIL: 'nowogar@gmail.com',
    LOCKON_GOOGLE_CLIENT_ID: APP_CONFIG.auth.googleClientId,
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    USERPROFILE: process.env.USERPROFILE,
    HOME: process.env.HOME
  };

  localApiProcess = spawn(process.execPath, [serverScript], {
    env: childEnv,
    windowsHide: true,
    stdio: 'ignore'
  });

  localApiProcess.once('exit', () => {
    localApiProcess = null;
  });

  await delay(350);
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
  attachBrowser(mainWindow);
  mainReady = new Promise((resolve) => mainWindow?.once('ready-to-show', () => resolve()));
  void mainWindow.loadURL(rendererUrl());
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
    { percent: 86, label: 'Ładowanie przeglądarki i aktualizacji…', delay: 260 }
  ];
  for (const stage of stages) {
    pushSplashProgress(stage.percent, stage.label);
    await delay(stage.delay);
  }
  await mainReady;
  pushSplashProgress(100, 'Gotowe.');
  await delay(200);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
  splashWindow?.close();
  splashWindow = null;
  void checkForUpdates();
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
    author: `${APP_CONFIG.author} - ${APP_CONFIG.defaultPoint.name}`,
    version: app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged,
    apiBaseUrl: APP_CONFIG.backend.apiBaseUrl
  }));

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

  await startBundledApi();
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
