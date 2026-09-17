import { app, BrowserWindow, ipcMain, screen } from 'electron';
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
  installUpdate
} from './updater';

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

  localApiProcess = spawn(process.execPath, [serverScript], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      LOCKON_API_HOST: '127.0.0.1',
      LOCKON_API_PORT: '8787',
      LOCKON_DATA_FILE: dataFile,
      LOCKON_OWNER_EMAIL: 'nowogar@gmail.com'
    },
    windowsHide: true,
    stdio: 'ignore'
  });

  localApiProcess.once('exit', () => {
    localApiProcess = null;
  });

  // API startuje praktycznie natychmiast, ale dajemy mu krótki bufor przed pierwszym auth requestem.
  await delay(350);
};

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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
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
    backgroundColor: '#f4f5f7',
    show: false,
    center: true,
    resizable: true,
    maximizable: true,
    title: APP_CONFIG.name,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

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

const registerIpc = () => {
  ipcMain.handle('app:getInfo', () => ({
    name: APP_CONFIG.name,
    author: `${APP_CONFIG.author} - ${APP_CONFIG.defaultPoint.name}`,
    version: app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged,
    apiBaseUrl: APP_CONFIG.backend.apiBaseUrl
  }));

  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:toggleMaximize', () => {
    if (!mainWindow) return;
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  });
  ipcMain.handle('window:close', () => mainWindow?.close());

  ipcMain.handle('auth:getState', () => getAuthState(isDevelopment));
  ipcMain.handle('auth:loginGoogle', () => loginWithGoogle(isDevelopment));
  ipcMain.handle('auth:loginLocal', () => loginLocalStarter(isDevelopment));
  ipcMain.handle('auth:logout', async () => {
    withMainWindow((window) => setBrowserVisible(window, false));
    return logout(isDevelopment);
  });

  ipcMain.handle('access:requestPoint', async (_event, payload: { pointName: string; city: string; requestedRole: string }) => {
    const token = requireSessionToken();
    await backendRequest('/access/request-point', {
      method: 'POST',
      body: JSON.stringify(payload)
    }, token);
    return getAuthState(isDevelopment);
  });

  ipcMain.handle('admin:getOverview', async () => {
    const token = requireSessionToken();
    return backendRequest('/admin/overview', {}, token);
  });
  ipcMain.handle('admin:createPoint', async (_event, payload: { name: string; city: string }) => {
    const token = requireSessionToken();
    return backendRequest('/admin/points', { method: 'POST', body: JSON.stringify(payload) }, token);
  });
  ipcMain.handle('admin:approveUser', async (_event, userId: string, payload: unknown) => {
    const token = requireSessionToken();
    return backendRequest(`/admin/users/${encodeURIComponent(userId)}/approve`, {
      method: 'POST',
      body: JSON.stringify(payload)
    }, token);
  });
  ipcMain.handle('admin:rejectUser', async (_event, userId: string) => {
    const token = requireSessionToken();
    return backendRequest(`/admin/users/${encodeURIComponent(userId)}/reject`, {
      method: 'POST', body: '{}'
    }, token);
  });
  ipcMain.handle('admin:updateUserAccess', async (_event, userId: string, payload: unknown) => {
    const token = requireSessionToken();
    return backendRequest(`/admin/users/${encodeURIComponent(userId)}/access`, {
      method: 'POST',
      body: JSON.stringify(payload)
    }, token);
  });

  ipcMain.handle('finance:list', async () => {
    const token = requireSessionToken();
    return backendRequest('/finance/revenues', {}, token);
  });
  ipcMain.handle('finance:submit', async (_event, payload: unknown) => {
    const token = requireSessionToken();
    return backendRequest('/finance/revenues', { method: 'POST', body: JSON.stringify(payload) }, token);
  });
  ipcMain.handle('finance:review', async (_event, revenueId: string, action: 'APPROVE' | 'REJECT') => {
    const token = requireSessionToken();
    return backendRequest(`/finance/revenues/${encodeURIComponent(revenueId)}/review`, {
      method: 'POST', body: JSON.stringify({ action })
    }, token);
  });
  ipcMain.handle('data:getDashboard', async () => {
    const token = requireSessionToken();
    return backendRequest('/dashboard', {}, token);
  });

  ipcMain.handle('browser:getState', () => getBrowserState());
  ipcMain.handle('browser:setVisible', (_event, value: boolean) =>
    withMainWindow((window) => setBrowserVisible(window, Boolean(value)))
  );
  ipcMain.handle('browser:setBounds', (_event, bounds: BrowserBounds) =>
    withMainWindow((window) => setBrowserBounds(window, bounds))
  );
  ipcMain.handle('browser:navigate', (_event, input: string) =>
    withMainWindow((window) => navigateBrowser(window, input))
  );
  ipcMain.handle('browser:back', () => withMainWindow(browserBack));
  ipcMain.handle('browser:forward', () => withMainWindow(browserForward));
  ipcMain.handle('browser:reload', () => withMainWindow(browserReload));
  ipcMain.handle('browser:home', () => withMainWindow(browserHome));
  ipcMain.handle('browser:openExternal', () => withMainWindow(browserOpenExternal));

  ipcMain.handle('update:getState', () => getUpdateState());
  ipcMain.handle('update:check', async () => {
    await requireOwner();
    return checkForUpdates();
  });
  ipcMain.handle('update:download', async () => {
    await requireOwner();
    return downloadUpdate();
  });
  ipcMain.handle('update:install', async () => {
    await requireOwner();
    return installUpdate();
  });
};

app.whenReady().then(async () => {
  await startBundledApi();
  registerIpc();
  configureUpdater();
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
  if (localApiProcess && !localApiProcess.killed) localApiProcess.kill();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
