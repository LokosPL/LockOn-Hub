import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  screen,
  session,
  shell,
  type IpcMainInvokeEvent
} from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
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
let rendererBootReady: Promise<void> = Promise.resolve();
let resolveRendererBootReady: (() => void) | null = null;
let localApiProcess: ChildProcess | null = null;

const resetRendererBootGate = () => {
  rendererBootReady = new Promise<void>((resolve) => {
    resolveRendererBootReady = resolve;
  });
};

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

const createSplashWindow = async () => {
  splashWindow = new BrowserWindow({
    width: 680,
    height: 430,
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
  await splashWindow.loadURL(rendererUrl('splash'));
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.show();
};

const createMainWindow = () => {
  resetRendererBootGate();
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
  const startupStartedAt = Date.now();
  const minimumStartupMs = 8_500;

  await delay(120);
  pushSplashProgress(10, 'Uruchamiam bezpieczny silnik ServiceOS…');

  pushSplashProgress(22, 'Przygotowuję usługi aplikacji…');
  try {
    await startBundledApi();
  } catch (error) {
    console.error('[LockOn API startup]', error);
  }

  pushSplashProgress(36, 'Zabezpieczam komunikację i moduły…');
  registerIpc();
  configureUpdater();
  startAutomaticUpdateChecks();

  pushSplashProgress(52, 'Ładuję interfejs i ustawienia ekranu…');
  createMainWindow();

  await Promise.race([mainReady, delay(8_000)]);
  pushSplashProgress(70, 'Interfejs gotowy. Przywracam Twoją sesję…');

  // Renderer zgłasza gotowość dopiero po wczytaniu preferencji i stanu logowania.
  // Bezpiecznik nie blokuje aplikacji w nieskończoność przy problemach sieciowych.
  await Promise.race([rendererBootReady, delay(12_000)]);
  pushSplashProgress(90, 'Synchronizuję uprawnienia i widok startowy…');

  await delay(180);
  pushSplashProgress(95, 'Domykam moduły, sesję i dane pierwszego widoku…');

  const remainingStartupMs = minimumStartupMs - (Date.now() - startupStartedAt);
  if (remainingStartupMs > 0) {
    await delay(remainingStartupMs);
  }

  pushSplashProgress(100, 'Wszystko gotowe. Miłej pracy!');
  await delay(520);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
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

const safeId = (value: unknown, prefix: 'usr' | 'rev' | 'srv' | 'ntf' | 'cst' | 'trf' | 'sup' | 'cqr' | 'inv' | 'tnn') => {
  const text = String(value ?? '');
  const pattern = new RegExp('^' + prefix + '_[a-f0-9]{20}' + '$');
  if (!pattern.test(text)) throw new Error('Nieprawidłowy identyfikator.');
  return text;
};


interface StartWeatherData {
  city: string;
  region: string | null;
  country: string | null;
  temperature: number;
  apparentTemperature: number;
  minTemperature: number;
  maxTemperature: number;
  windSpeed: number;
  weatherCode: number;
  condition: string;
  fetchedAt: string;
}

const weatherCache = new Map<string, { expiresAt: number; value: StartWeatherData }>();

const weatherCondition = (code: number) => {
  if (code === 0) return 'Bezchmurnie';
  if (code === 1) return 'Przeważnie słonecznie';
  if (code === 2) return 'Częściowe zachmurzenie';
  if (code === 3) return 'Pochmurno';
  if (code === 45 || code === 48) return 'Mgła';
  if ([51, 53, 55, 56, 57].includes(code)) return 'Mżawka';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'Deszcz';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Śnieg';
  if ([95, 96, 99].includes(code)) return 'Burza';
  return 'Zmienna pogoda';
};

const fetchStartWeather = async (rawCity: unknown): Promise<StartWeatherData> => {
  const city = String(rawCity ?? '').trim().replace(/\s+/g, ' ').slice(0, 90);
  if (city.length < 2) throw new Error('Wpisz miasto, aby wyświetlić pogodę.');

  const cacheKey = city.toLocaleLowerCase('pl-PL');
  const cached = weatherCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const geocodeParams = new URLSearchParams({
    name: city,
    count: '1',
    language: 'pl',
    format: 'json'
  });
  const geocodeResponse = await fetch(
    'https://geocoding-api.open-meteo.com/v1/search?' + geocodeParams.toString(),
    { cache: 'no-store', signal: AbortSignal.timeout(8_000) }
  );
  if (!geocodeResponse.ok) throw new Error('Nie udało się znaleźć miasta dla pogody.');
  const geocode = await geocodeResponse.json() as {
    results?: Array<{ name?: string; latitude?: number; longitude?: number; admin1?: string; country?: string }>;
  };
  const location = geocode.results?.[0];
  if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
    throw new Error('Nie znaleziono takiego miasta.');
  }

  const forecastParams = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m',
    daily: 'temperature_2m_max,temperature_2m_min',
    timezone: 'auto',
    forecast_days: '1'
  });
  const forecastResponse = await fetch(
    'https://api.open-meteo.com/v1/forecast?' + forecastParams.toString(),
    { cache: 'no-store', signal: AbortSignal.timeout(8_000) }
  );
  if (!forecastResponse.ok) throw new Error('Pogoda jest chwilowo niedostępna.');
  const forecast = await forecastResponse.json() as {
    current?: {
      temperature_2m?: number;
      apparent_temperature?: number;
      weather_code?: number;
      wind_speed_10m?: number;
    };
    daily?: {
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
    };
  };

  const current = forecast.current;
  const maxTemperature = forecast.daily?.temperature_2m_max?.[0];
  const minTemperature = forecast.daily?.temperature_2m_min?.[0];
  if (
    !current ||
    !Number.isFinite(current.temperature_2m) ||
    !Number.isFinite(current.apparent_temperature) ||
    !Number.isFinite(current.weather_code) ||
    !Number.isFinite(current.wind_speed_10m) ||
    !Number.isFinite(maxTemperature) ||
    !Number.isFinite(minTemperature)
  ) {
    throw new Error('Serwis pogodowy zwrócił niepełne dane.');
  }

  const value: StartWeatherData = {
    city: location.name || city,
    region: location.admin1 || null,
    country: location.country || null,
    temperature: Number(current.temperature_2m),
    apparentTemperature: Number(current.apparent_temperature),
    minTemperature: Number(minTemperature),
    maxTemperature: Number(maxTemperature),
    windSpeed: Number(current.wind_speed_10m),
    weatherCode: Number(current.weather_code),
    condition: weatherCondition(Number(current.weather_code)),
    fetchedAt: new Date().toISOString()
  };
  weatherCache.set(cacheKey, { expiresAt: Date.now() + 10 * 60 * 1_000, value });
  return value;
};

const INVOICE_PDF_MAX_BYTES = 20 * 1024 * 1024;

const safeDownloadFileName = (value: unknown) => {
  const base = String(value ?? 'faktura.pdf')
    .trim()
    .replace(/[\\/\0-\x1f<>:"|?*]+/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 180) || 'faktura.pdf';
  return /\.pdf$/i.test(base) ? base : base + '.pdf';
};

const uniqueDownloadPath = (directory: string, fileName: string) => {
  const safe = safeDownloadFileName(fileName);
  const ext = path.extname(safe);
  const stem = safe.slice(0, safe.length - ext.length);
  let candidate = path.join(directory, safe);
  for (let index = 2; fs.existsSync(candidate) && index < 1000; index += 1) {
    candidate = path.join(directory, stem + ' (' + index + ')' + ext);
  }
  return candidate;
};

const sha256File = async (filePath: string) => {
  const hash = createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest('hex');
};

const assertPdfFile = async (filePath: string) => {
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile() || stat.size <= 0) throw new Error('Wybrany plik jest pusty.');
  if (stat.size > INVOICE_PDF_MAX_BYTES) throw new Error('Faktura PDF może mieć maksymalnie 20 MB.');
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const prefix = Buffer.alloc(5);
    await handle.read(prefix, 0, 5, 0);
    if (prefix.toString('ascii') !== '%PDF-') throw new Error('Wybrany plik nie jest prawidłowym dokumentem PDF.');
  } finally {
    await handle.close();
  }
  return stat;
};

const fetchPdfToFile = async (url: string, destination: string) => {
  const response = await fetch(url, { cache:'no-store', redirect:'error', signal:AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error('Pobranie faktury nie powiodło się (HTTP ' + response.status + ').');
  const type = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (type && type !== 'application/pdf' && type !== 'application/octet-stream') throw new Error('Serwer zwrócił nieprawidłowy typ pliku.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length <= 0 || bytes.length > INVOICE_PDF_MAX_BYTES || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('Pobrany dokument nie jest prawidłowym PDF.');
  }
  await fs.promises.writeFile(destination, bytes, { flag:'wx' });
};

const writeApiPdfToTemp = async (base64: string, fileName: string) => {
  const bytes=Buffer.from(String(base64||''),'base64');
  if(bytes.length<=0||bytes.length>8*1024*1024||bytes.subarray(0,5).toString('ascii')!=='%PDF-'){
    throw new Error('Serwer zwrócił nieprawidłową kartę serwisową PDF.');
  }
  const dir=path.join(app.getPath('temp'),'LockOn-ServiceOS','service-cards');
  await fs.promises.mkdir(dir,{recursive:true});
  const destination=path.join(dir,safeDownloadFileName(fileName));
  await fs.promises.writeFile(destination,bytes);
  return destination;
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
    version: APP_CONFIG.productVersion,
    buildVersion: app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged,
    apiBaseUrl: getBackendApiBaseUrl()
  };
};

const registerIpc = () => {
  secureHandle('app:renderer-ready', () => {
    resolveRendererBootReady?.();
    resolveRendererBootReady = null;
  });

  secureHandle('app:getInfo', () => ({
    name: APP_CONFIG.name,
    author: APP_CONFIG.author,
    version: APP_CONFIG.productVersion,
    buildVersion: app.getVersion(),
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

  secureHandle('customers:list', async (query = '') => {
    const token = requireSessionToken();
    const safeQuery=String(query ?? '').trim().slice(0,120);
    return backendRequest('/customer-accounts' + (safeQuery ? '?q='+encodeURIComponent(safeQuery) : ''), {}, token);
  });
  secureHandle('customers:updateProfile', async (customerId: string, payload: unknown) => {
    const token = requireSessionToken();
    return backendRequest(`/customer-accounts/${encodeURIComponent(safeId(customerId,'cst'))}/profile`, {
      method:'POST',body:JSON.stringify(payload)
    },token);
  });
  secureHandle('customers:unlinkGoogle', async (customerId: string) => {
    const token = requireSessionToken();
    return backendRequest(`/customer-accounts/${encodeURIComponent(safeId(customerId,'cst'))}/google/unlink`, {
      method:'POST',body:'{}'
    },token);
  });
  secureHandle('customers:getCode', async (customerId: string, rotate = false) => {
    const token = requireSessionToken();
    return backendRequest(`/customer-accounts/${encodeURIComponent(safeId(customerId,'cst'))}/code`, {
      method:'POST',body:JSON.stringify({rotate:Boolean(rotate)})
    },token);
  });
  secureHandle('customers:sendCode', async (customerId: string) => {
    const token = requireSessionToken();
    return backendRequest(`/customer-accounts/${encodeURIComponent(safeId(customerId,'cst'))}/send-code`, {
      method:'POST',body:'{}'
    },token);
  });
  secureHandle('customers:getNotificationPreferences', async (customerId: string) => {
    const token = requireSessionToken();
    return backendRequest(`/customer-accounts/${encodeURIComponent(safeId(customerId,'cst'))}/notification-preferences`, {}, token);
  });
  secureHandle('customers:updateNotificationPreferences', async (customerId: string, payload: unknown) => {
    const token = requireSessionToken();
    return backendRequest(`/customer-accounts/${encodeURIComponent(safeId(customerId,'cst'))}/notification-preferences`, {
      method:'POST', body:JSON.stringify(payload)
    }, token);
  });
  secureHandle('customers:block', async (customerId: string, blocked: boolean, reason?: string) => {
    const token = requireSessionToken();
    return backendRequest(`/customer-accounts/${encodeURIComponent(safeId(customerId,'cst'))}/block`, {
      method:'POST',body:JSON.stringify({blocked:Boolean(blocked),reason:String(reason ?? '').trim().slice(0,500)})
    },token);
  });
  secureHandle('customers:logoutAll', async (customerId: string) => {
    const token = requireSessionToken();
    return backendRequest(`/customer-accounts/${encodeURIComponent(safeId(customerId,'cst'))}/logout-all`, {
      method:'POST',body:'{}'
    },token);
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
  secureHandle('data:getWeather', async (city: string) => {
    requireSessionToken();
    return fetchStartWeather(city);
  });


  secureHandle('service:listCustomers', async (query = '') => {
    const token = requireSessionToken();
    const safeQuery = String(query ?? '').trim().slice(0, 120);
    return backendRequest('/service/customers' + (safeQuery ? '?q='+encodeURIComponent(safeQuery) : ''), {}, token);
  });
  secureHandle('service:updateCustomerProfile', async (customerId: string, payload: unknown) => {
    const token = requireSessionToken();
    return backendRequest(`/service/customers/${encodeURIComponent(safeId(customerId, 'cst'))}/profile`, {
      method:'POST',
      body:JSON.stringify(payload)
    }, token);
  });
  secureHandle('service:searchCustomers', async (query: string) => {
    const token = requireSessionToken();
    const safeQuery = String(query ?? '').trim().slice(0, 120);
    if (safeQuery.length < 2) return [];
    return backendRequest(`/service/customers/search?q=${encodeURIComponent(safeQuery)}`, {}, token);
  });
  secureHandle('service:searchOrders', async (query: string) => {
    const token = requireSessionToken();
    const safeQuery = String(query ?? '').trim().slice(0, 120);
    if (safeQuery.length < 2) return [];
    return backendRequest(`/service/orders/search?q=${encodeURIComponent(safeQuery)}`, {}, token);
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
  secureHandle('service:openServiceCard', async (orderId: string, printMode: 'PHYSICAL_AND_ONLINE' | 'ONLINE_ONLY') => {
    const token=requireSessionToken();
    const mode=printMode==='PHYSICAL_AND_ONLINE'?'PHYSICAL_AND_ONLINE':'ONLINE_ONLY';
    const result=await backendRequest(`/service/orders/${encodeURIComponent(safeId(orderId,'srv'))}/service-card`,{
      method:'POST',
      body:JSON.stringify({printMode:mode})
    },token) as {fileName:string;pdfBase64:string;staffScanCode?:string};
    const filePath=await writeApiPdfToTemp(result.pdfBase64,result.fileName);
    const openError=await shell.openPath(filePath);
    if(openError)throw new Error('Nie udało się otworzyć karty serwisowej: '+openError);
    return {opened:true,filePath,fileName:result.fileName,printMode:mode,staffScanCode:result.staffScanCode};
  });
  secureHandle('service:updateWarranty', async (orderId: string, payload: any) => {
    const token=requireSessionToken();
    return backendRequest(`/service/orders/${encodeURIComponent(safeId(orderId,'srv'))}/warranty`,{
      method:'POST',
      body:JSON.stringify({
        months:Math.max(1,Math.min(60,Math.trunc(Number(payload?.months)||0))),
        repairSummary:String(payload?.repairSummary??'').trim().slice(0,2000)
      })
    },token);
  });
  secureHandle('service:openWarrantyCard', async (orderId: string) => {
    const token=requireSessionToken();
    const result=await backendRequest(`/service/orders/${encodeURIComponent(safeId(orderId,'srv'))}/warranty-card`,{
      method:'POST',body:'{}'
    },token) as {fileName:string;pdfBase64:string;order?:unknown};
    const filePath=await writeApiPdfToTemp(result.pdfBase64,result.fileName);
    const openError=await shell.openPath(filePath);
    if(openError)throw new Error('Nie udało się otworzyć karty gwarancyjnej: '+openError);
    return {opened:true,filePath,fileName:result.fileName,order:result.order};
  });

  secureHandle('service:scanServiceCard', async (payload: any) => {
    const token=requireSessionToken();
    return backendRequest('/service/scan',{
      method:'POST',
      body:JSON.stringify({
        actingPointId:String(payload?.actingPointId??'').trim().slice(0,80),
        token:String(payload?.token??'').trim().slice(0,100),
        code:String(payload?.code??'').trim().slice(0,32)
      })
    },token);
  });
  secureHandle('service:listOrders', async (limit = 40, offset = 0) => {
    const token = requireSessionToken();
    const safeLimit=Math.max(1,Math.min(60,Math.trunc(Number(limit)||40)));
    const safeOffset=Math.max(0,Math.min(5000,Math.trunc(Number(offset)||0)));
    return backendRequest(`/service/orders?limit=${safeLimit}&offset=${safeOffset}`, {}, token);
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
  secureHandle('service:getCosting', async (orderId: string) => {
    const token = requireSessionToken();
    return backendRequest(`/service/orders/${encodeURIComponent(safeId(orderId,'srv'))}/costing`, {}, token);
  });
  secureHandle('service:saveCosting', async (orderId: string, payload: unknown) => {
    const token = requireSessionToken();
    return backendRequest(`/service/orders/${encodeURIComponent(safeId(orderId,'srv'))}/costing`, {
      method:'POST',body:JSON.stringify(payload)
    }, token);
  });
  secureHandle('service:uploadInvoice', async (orderId: string, payload: any) => {
    const token=requireSessionToken();
    if(!mainWindow||mainWindow.isDestroyed())throw new Error('Główne okno aplikacji nie jest dostępne.');
    const chosen=await dialog.showOpenDialog(mainWindow,{
      title:'Wybierz fakturę zakupu części',
      properties:['openFile'],
      filters:[{name:'Dokument PDF',extensions:['pdf']}]
    });
    if(chosen.canceled||!chosen.filePaths[0])return {cancelled:true};
    const filePath=chosen.filePaths[0];
    const stat=await assertPdfFile(filePath);
    const sha256=await sha256File(filePath);
    const intent=await backendRequest(`/service/orders/${encodeURIComponent(safeId(orderId,'srv'))}/invoices/upload-intent`,{
      method:'POST',
      body:JSON.stringify({
        fileName:path.basename(filePath),
        sizeBytes:stat.size,
        sha256,
        invoiceNumber:String(payload?.invoiceNumber??'').trim().slice(0,120),
        supplier:String(payload?.supplier??'').trim().slice(0,180),
        invoiceDate:String(payload?.invoiceDate??'').trim().slice(0,10),
        grossAmount:payload?.grossAmount===null||payload?.grossAmount===undefined||payload?.grossAmount===''?null:Number(payload.grossAmount)
      })
    },token) as {invoiceId:string;uploadUrl:string;requiredHeaders?:Record<string,string>};
    const bytes=await fs.promises.readFile(filePath);
    const upload=await fetch(intent.uploadUrl,{
      method:'PUT',
      headers:intent.requiredHeaders||{'content-type':'application/pdf','x-amz-meta-sha256':sha256},
      body:bytes,
      redirect:'error',
      signal:AbortSignal.timeout(60_000)
    });
    if(!upload.ok)throw new Error('Nie udało się wysłać faktury do prywatnego magazynu (HTTP '+upload.status+').');
    const invoice=await backendRequest(`/service/invoices/${encodeURIComponent(safeId(intent.invoiceId,'inv'))}/complete`,{method:'POST',body:'{}'},token);
    return {cancelled:false,invoice};
  });
  secureHandle('service:downloadInvoice', async (invoiceId: string) => {
    const token=requireSessionToken();
    const intent=await backendRequest(`/service/invoices/${encodeURIComponent(safeId(invoiceId,'inv'))}/download-intent`,{method:'POST',body:'{}'},token) as {invoice:{fileName:string};downloadUrl:string};
    if(!mainWindow||mainWindow.isDestroyed())throw new Error('Główne okno aplikacji nie jest dostępne.');
    const save=await dialog.showSaveDialog(mainWindow,{
      title:'Zapisz fakturę PDF',
      defaultPath:path.join(app.getPath('downloads'),safeDownloadFileName(intent.invoice?.fileName)),
      filters:[{name:'Dokument PDF',extensions:['pdf']}]
    });
    if(save.canceled||!save.filePath)return {cancelled:true};
    if(fs.existsSync(save.filePath))await fs.promises.unlink(save.filePath);
    await fetchPdfToFile(intent.downloadUrl,save.filePath);
    return {cancelled:false,filePath:save.filePath};
  });
  secureHandle('service:listInvoices', async (month: string, pointId: string) => {
    const token=requireSessionToken();
    const period=String(month??'').trim().slice(0,7);
    const safePointId=String(pointId??'').trim().slice(0,80);
    const params=new URLSearchParams({month:period,pointId:safePointId});
    return backendRequest('/service/invoices?'+params.toString(),{},token);
  });
  secureHandle('service:downloadInvoiceBatch', async (month: string, pointId: string) => {
    const token=requireSessionToken();
    const period=String(month??'').trim().slice(0,7);
    const safePointId=String(pointId??'').trim().slice(0,80);
    const batch=await backendRequest('/service/invoices/download-batch',{method:'POST',body:JSON.stringify({period,pointId:safePointId})},token) as {files:Array<{fileName:string;orderNumber?:number|null;downloadUrl:string}>};
    if(!mainWindow||mainWindow.isDestroyed())throw new Error('Główne okno aplikacji nie jest dostępne.');
    const chosen=await dialog.showOpenDialog(mainWindow,{title:'Wybierz folder dla faktur '+period,properties:['openDirectory','createDirectory']});
    if(chosen.canceled||!chosen.filePaths[0])return {cancelled:true,downloaded:0};
    const folder=chosen.filePaths[0];
    let downloaded=0,failed=0;
    for(const item of batch.files.slice(0,300)){
      const prefix=item.orderNumber!=null?'Zlecenie-'+item.orderNumber+' - ':'';
      const destination=uniqueDownloadPath(folder,prefix+safeDownloadFileName(item.fileName));
      try{await fetchPdfToFile(item.downloadUrl,destination);downloaded+=1;}catch{failed+=1;}
    }
    return {cancelled:false,downloaded,failed,folder};
  });
  secureHandle('service:deleteInvoice', async (invoiceId: string) => {
    const token=requireSessionToken();
    return backendRequest(`/service/invoices/${encodeURIComponent(safeId(invoiceId,'inv'))}`,{method:'DELETE'},token);
  });
  secureHandle('service:getInvoiceMonthlyPrompt', async () => backendRequest('/service/invoices/monthly-prompt',{},requireSessionToken()));
  secureHandle('service:dismissInvoiceMonthlyPrompt', async (period: string) => backendRequest('/service/invoices/monthly-prompt/dismiss',{
    method:'POST',body:JSON.stringify({period:String(period??'').trim().slice(0,7)})
  },requireSessionToken()));
  secureHandle('service:getTechnicianWorkspace', async () => backendRequest('/service/technician-workspace',{},requireSessionToken()));
  secureHandle('service:listTechnicianNotes', async () => backendRequest('/service/technician-notes',{},requireSessionToken()));
  secureHandle('service:addTechnicianNote', async (payload: any) => backendRequest('/service/technician-notes',{
    method:'POST',
    body:JSON.stringify({
      title:String(payload?.title??'').trim().slice(0,120),
      body:String(payload?.body??'').trim().slice(0,4000),
      pinned:payload?.pinned===true
    })
  },requireSessionToken()));
  secureHandle('service:updateTechnicianNote', async (noteId: string, payload: any) => backendRequest(`/service/technician-notes/${encodeURIComponent(safeId(noteId,'tnn'))}`,{
    method:'POST',
    body:JSON.stringify({
      title:String(payload?.title??'').trim().slice(0,120),
      body:String(payload?.body??'').trim().slice(0,4000),
      pinned:payload?.pinned===true
    })
  },requireSessionToken()));
  secureHandle('service:deleteTechnicianNote', async (noteId: string) => backendRequest(`/service/technician-notes/${encodeURIComponent(safeId(noteId,'tnn'))}`,{method:'DELETE'},requireSessionToken()));
  secureHandle('service:updateDetails', async (orderId: string, payload: unknown) => {
    const token = requireSessionToken();
    return backendRequest(`/service/orders/${encodeURIComponent(safeId(orderId, 'srv'))}/details`, {
      method: 'POST',
      body: JSON.stringify(payload)
    }, token);
  });
  secureHandle('service:updatePlan', async (orderId: string, payload: any) => {
    const token = requireSessionToken();
    return backendRequest(`/service/orders/${encodeURIComponent(safeId(orderId, 'srv'))}/plan`, {
      method: 'POST',
      body: JSON.stringify({
        estimatedCompletionAt: payload?.estimatedCompletionAt == null ? null : String(payload.estimatedCompletionAt).slice(0,64),
        targetIndex: Math.max(0, Math.min(500, Number(payload?.targetIndex) || 0))
      })
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
  secureHandle('assistant:send', async (message: string, target?: 'BOT' | 'CONSULTANT') => {
    const token = requireSessionToken();
    const channel = target === 'CONSULTANT' ? 'CONSULTANT' : 'BOT';
    return backendRequest('/assistant/chat', {
      method: 'POST',
      body: JSON.stringify({ message: String(message ?? '').trim().slice(0, 1500), target: channel })
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
  secureHandle('support:leave', async () => backendRequest('/support/leave', {method:'POST',body:'{}'}, requireSessionToken()));
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

  await createSplashWindow();
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
