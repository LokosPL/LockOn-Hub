import { GOOGLE_CLIENT_SECRET } from './generatedSecrets';
import fs from 'node:fs';
import path from 'node:path';

const loadLocalEnv = () => {
  try {
    const envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const index = trimmed.indexOf('=');
      if (index <= 0) continue;
      const key = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // .env jest wygodą developerską, brak pliku nie jest błędem.
  }
};

loadLocalEnv();

export type UserRole = 'OWNER' | 'BOSS' | 'COORDINATOR' | 'SUPPORT' | 'TECHNICIAN' | 'USER';

export const APP_CONFIG = {
  name: 'LockOn ServiceOS',
  productVersion: '1.0.3.22',
  author: 'Bartłomiej Motłoch',
  defaultPoint: {
    id: 'nowogard',
    name: 'Punkt Nowogard'
  },
  backend: {
    // Development zachowuje lokalny backend jako szybki fallback.
    // Pakietowana aplikacja domyślnie korzysta z centralnego API w Neon.
    apiBaseUrl:
      process.env.LOCKON_API_URL ||
      (process.env.VITE_DEV_SERVER_URL
        ? 'http://127.0.0.1:8787'
        : 'https://br-steep-bonus-b1f1qh8u-lockonapi.compute.c-5.eu-central-1.aws.neon.tech')
  },
  updateRepository: {
    owner: 'LokosPL',
    repo: 'LockOn-Hub'
  },
  auth: {
    googleClientId:
      '996585439932-e10mu53j95s6u13vrua841tm4oco38so.apps.googleusercontent.com',

    // Google wymaga tego credentialu dla aktualnej konfiguracji Desktop OAuth
    // podczas wymiany authorization code na token. Wartość jest wstrzykiwana
    // wyłącznie podczas release z GitHub Actions Secret i nie jest commitowana.
    googleClientSecret: process.env.LOCKON_GOOGLE_CLIENT_SECRET || GOOGLE_CLIENT_SECRET,

    // Tylko development; backend /auth/dev-owner działa, gdy LOCKON_ALLOW_DEV_LOGIN=1.
    allowLocalStarterLogin: true
  },
  browser: {
    homeUrl: 'https://www.google.com/'
  }
} as const;

export const hasGoogleClientId = () =>
  Boolean(APP_CONFIG.auth.googleClientId) &&
  !APP_CONFIG.auth.googleClientId.startsWith('PASTE_');
