import { BrowserWindow, app } from 'electron';
import path from 'node:path';
import { autoUpdater } from 'electron-updater';
import { APP_CONFIG } from './appConfig';

export type UpdateState =
  | { status: 'idle'; message: string }
  | { status: 'checking'; message: string }
  | { status: 'available'; message: string; version: string }
  | { status: 'not-available'; message: string; version: string }
  | { status: 'downloading'; message: string; percent: number }
  | { status: 'downloaded'; message: string; version: string }
  | { status: 'error'; message: string }
  | { status: 'development'; message: string };

let currentState: UpdateState = {
  status: 'idle',
  message: 'Aktualizator jest gotowy.'
};

let checkInFlight = false;
let lastCheckStartedAt = 0;

const sendState = (state: UpdateState) => {
  currentState = state;
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('update:status', state);
  });
};

export const getUpdateState = () => currentState;

export const configureUpdater = () => {
  // Pobieramy aktualizację automatycznie, ale samą instalację uruchamiamy
  // wyłącznie po świadomym kliknięciu użytkownika. To zapobiega wyścigowi
  // między zwykłym zamknięciem aplikacji a procesem NSIS na Windows.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;

  // Na Windowsie aktualizacja ma nadpisać dokładnie bieżącą instalację,
  // również wtedy, gdy starsza wersja była zainstalowana w niestandardowym katalogu.
  if (process.platform === 'win32' && app.isPackaged) {
    (autoUpdater as typeof autoUpdater & { installDirectory?: string }).installDirectory =
      path.dirname(process.execPath);
  }

  autoUpdater.setFeedURL({
    provider: 'github',
    owner: APP_CONFIG.updateRepository.owner,
    repo: APP_CONFIG.updateRepository.repo
  });

  autoUpdater.on('checking-for-update', () => {
    sendState({ status: 'checking', message: 'Sprawdzanie aktualizacji w GitHub…' });
  });

  autoUpdater.on('update-available', (info) => {
    sendState({
      status: 'available',
      version: info.version,
      message: `Dostępna jest wersja ${info.version}.`
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    sendState({
      status: 'not-available',
      version: info.version,
      message: 'Masz najnowszą wersję aplikacji.'
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendState({
      status: 'downloading',
      percent: Math.round(progress.percent),
      message: `Pobieranie aktualizacji: ${Math.round(progress.percent)}%`
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendState({
      status: 'downloaded',
      version: info.version,
      message: `Wersja ${info.version} jest gotowa do instalacji.`
    });
  });

  autoUpdater.on('error', (error) => {
    sendState({
      status: 'error',
      message: error instanceof Error ? error.message : 'Nieznany błąd aktualizacji.'
    });
  });
};

export const checkForUpdates = async () => {
  if (!app.isPackaged) {
    const state: UpdateState = {
      status: 'development',
      message: 'Tryb developerski — aktualizacje GitHub działają po zbudowaniu instalatora.'
    };
    sendState(state);
    return state;
  }

  if (checkInFlight) return currentState;

  checkInFlight = true;
  lastCheckStartedAt = Date.now();
  try {
    return await autoUpdater.checkForUpdates();
  } finally {
    checkInFlight = false;
  }
};

export const checkForUpdatesIfStale = async (minimumIntervalMs = 2 * 60 * 1000) => {
  if (!app.isPackaged) return currentState;
  if (Date.now() - lastCheckStartedAt < minimumIntervalMs) return currentState;
  return checkForUpdates();
};

export const downloadUpdate = async () => {
  if (!app.isPackaged) {
    sendState({
      status: 'development',
      message: 'Pobieranie aktualizacji jest wyłączone w trybie developerskim.'
    });
    return currentState;
  }

  if (currentState.status === 'downloading' || currentState.status === 'downloaded') return currentState;
  if (currentState.status !== 'available') {
    throw new Error('Najpierw sprawdź dostępność aktualizacji.');
  }

  await autoUpdater.downloadUpdate();
  return currentState;
};

export const installUpdate = () => {
  if (!app.isPackaged) return currentState;
  if (currentState.status !== 'downloaded') {
    throw new Error('Aktualizacja nie jest jeszcze gotowa do instalacji.');
  }

  // Instalator od 1.5.26 jest one-click NSIS. /S jest więc obsługiwane natywnie,
  // a --force-run ponownie uruchamia aplikację dopiero po zakończeniu nadpisania plików.
  autoUpdater.quitAndInstall(true, true);
  return currentState;
};

let updateTimer: NodeJS.Timeout | null = null;
let startupCheckTimer: NodeJS.Timeout | null = null;

export const startAutomaticUpdateChecks = () => {
  if (!app.isPackaged || updateTimer || startupCheckTimer) return;

  startupCheckTimer = setTimeout(() => {
    startupCheckTimer = null;
    void checkForUpdates().catch(() => undefined);
  }, 1_500);

  updateTimer = setInterval(() => {
    void checkForUpdates().catch(() => undefined);
  }, 10 * 60 * 1000);
};

export const stopAutomaticUpdateChecks = () => {
  if (startupCheckTimer) {
    clearTimeout(startupCheckTimer);
    startupCheckTimer = null;
  }
  if (updateTimer) {
    clearInterval(updateTimer);
    updateTimer = null;
  }
};
