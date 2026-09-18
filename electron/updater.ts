import { BrowserWindow, app } from 'electron';
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

const sendState = (state: UpdateState) => {
  currentState = state;
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('update:status', state);
  });
};

export const getUpdateState = () => currentState;

export const configureUpdater = () => {
  // Aktualizacja ma działać jak zwykły program desktopowy: sprawdź w tle,
  // pobierz bez pytania, a instalację zaproponuj użytkownikowi.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  // Ustawiamy feed jawnie, dzięki czemu konfigurację GitHub zmieniasz w jednym miejscu.
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

  return autoUpdater.checkForUpdates();
};

export const downloadUpdate = async () => {
  if (!app.isPackaged) {
    sendState({
      status: 'development',
      message: 'Pobieranie aktualizacji jest wyłączone w trybie developerskim.'
    });
    return;
  }

  await autoUpdater.downloadUpdate();
};

export const installUpdate = () => {
  if (!app.isPackaged) return;
  autoUpdater.quitAndInstall(false, true);
};

let updateTimer: NodeJS.Timeout | null = null;

export const startAutomaticUpdateChecks = () => {
  if (!app.isPackaged || updateTimer) return;

  // Pierwsze sprawdzenie robi main.ts po starcie. Później ponawiamy je co 4h,
  // żeby użytkownik nie musiał zamykać aplikacji, by zobaczyć nowe wydanie.
  updateTimer = setInterval(() => {
    void checkForUpdates().catch(() => undefined);
  }, 4 * 60 * 60 * 1000);
};

export const stopAutomaticUpdateChecks = () => {
  if (!updateTimer) return;
  clearInterval(updateTimer);
  updateTimer = null;
};
