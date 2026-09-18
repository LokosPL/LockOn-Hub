import { app, safeStorage, shell } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { APP_CONFIG, hasGoogleClientId, type UserRole } from './appConfig';
import {
  backendDevOwnerLogin,
  backendGoogleLogin,
  backendLogout,
  backendMe,
  type BackendAuthPayload,
  type BackendRequestedPoint
} from './backendApi';

export interface AuthUser {
  id?: string;
  email: string;
  name: string;
  picture?: string | null;
}

export interface AuthPoint {
  id: string;
  name: string;
  city?: string;
}

export type AccountStatus = 'PENDING' | 'ACTIVE' | 'REJECTED';

export interface AuthState {
  configured: boolean;
  authenticated: boolean;
  development: boolean;
  localStarterLoginAllowed: boolean;
  user: AuthUser | null;
  point: AuthPoint | null;
  points: AuthPoint[];
  role: UserRole | null;
  status: AccountStatus | null;
  requestedPoint?: BackendRequestedPoint | null;
  message?: string;
}

interface StoredSessionFile {
  encryptedApiToken?: string;
  apiToken?: string;
  provider: 'google' | 'local';
  savedAt: string;
}

interface StoredSession {
  apiToken: string;
  provider: 'google' | 'local';
  savedAt: string;
}

interface GoogleCredentialFile {
  installed?: {
    client_id?: string;
    client_secret?: string;
  };
}

const SESSION_FILE = 'auth-session.json';
const sessionPath = () => path.join(app.getPath('userData'), SESSION_FILE);

const writeStoredSession = (session: StoredSession) => {
  fs.mkdirSync(path.dirname(sessionPath()), { recursive: true });

  const payload: StoredSessionFile = {
    provider: session.provider,
    savedAt: session.savedAt
  };

  if (safeStorage.isEncryptionAvailable()) {
    payload.encryptedApiToken = safeStorage.encryptString(session.apiToken).toString('base64');
  } else {
    // Fallback is intended only for development environments where the OS keychain
    // may be unavailable. Packaged Windows builds use DPAPI through safeStorage.
    payload.apiToken = session.apiToken;
  }

  fs.writeFileSync(sessionPath(), JSON.stringify(payload, null, 2), {
    encoding: 'utf8',
    mode: 0o600
  });
};

const readStoredSession = (): StoredSession | null => {
  try {
    const parsed = JSON.parse(fs.readFileSync(sessionPath(), 'utf8')) as Partial<StoredSessionFile>;
    let apiToken = '';

    if (parsed.encryptedApiToken && safeStorage.isEncryptionAvailable()) {
      apiToken = safeStorage.decryptString(Buffer.from(parsed.encryptedApiToken, 'base64'));
    } else if (parsed.apiToken) {
      apiToken = parsed.apiToken;

      // Transparent migration from the old plaintext session file.
      if (safeStorage.isEncryptionAvailable()) {
        writeStoredSession({
          apiToken,
          provider: parsed.provider ?? 'google',
          savedAt: parsed.savedAt ?? new Date().toISOString()
        });
      }
    }

    if (!apiToken) return null;
    return {
      apiToken,
      provider: parsed.provider ?? 'google',
      savedAt: parsed.savedAt ?? new Date().toISOString()
    };
  } catch {
    return null;
  }
};

const clearStoredSession = () => {
  try { fs.unlinkSync(sessionPath()); } catch {}
};

export const getStoredApiToken = () => readStoredSession()?.apiToken ?? '';

const toAuthState = (
  payload: BackendAuthPayload,
  development: boolean,
  message?: string
): AuthState => {
  const points = payload.points.map((point) => ({ id: point.id, name: point.name, city: point.city }));
  return {
    configured: hasGoogleClientId(),
    authenticated: true,
    development,
    localStarterLoginAllowed: APP_CONFIG.auth.allowLocalStarterLogin && development,
    user: {
      id: payload.user.id,
      email: payload.user.email,
      name: payload.user.name,
      picture: payload.user.picture
    },
    point: points[0] ?? null,
    points,
    role: payload.user.role,
    status: payload.user.status,
    requestedPoint: payload.user.requestedPoint ?? null,
    message
  };
};

const emptyState = (development: boolean, message?: string): AuthState => ({
  configured: hasGoogleClientId(),
  authenticated: false,
  development,
  localStarterLoginAllowed: APP_CONFIG.auth.allowLocalStarterLogin && development,
  user: null,
  point: null,
  points: [],
  role: null,
  status: null,
  requestedPoint: null,
  message
});

export const getAuthState = async (development: boolean): Promise<AuthState> => {
  const stored = readStoredSession();
  if (!stored) return emptyState(development);

  try {
    const payload = await backendMe(stored.apiToken);
    return toAuthState(payload, development);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nie udało się odświeżyć sesji.';
    if (/sesja|unauthorized|wygas/i.test(message)) clearStoredSession();
    return emptyState(development, message);
  }
};

export const logout = async (development: boolean) => {
  const stored = readStoredSession();
  if (stored?.apiToken) {
    try { await backendLogout(stored.apiToken); } catch {
      // Lokalne dane sesji i tak usuwamy. Backend wygaśnie sesję automatycznie.
    }
  }
  clearStoredSession();
  return emptyState(development);
};

const base64Url = (input: Buffer) =>
  input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

const createPkce = () => {
  const verifier = base64Url(crypto.randomBytes(48));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
};

const tryReadGoogleCredentials = (filePath: string): GoogleCredentialFile['installed'] | null => {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as GoogleCredentialFile;
    if (!parsed.installed?.client_id || !parsed.installed?.client_secret) return null;
    return parsed.installed;
  } catch {
    return null;
  }
};

const findCredentialFile = (directory: string) => {
  try {
    return fs.readdirSync(directory)
      .filter((name) => /^client_secret_.*\.apps\.googleusercontent\.com\.json$/i.test(name))
      .map((name) => path.join(directory, name));
  } catch {
    return [] as string[];
  }
};

const resolveGoogleClientSecret = () => {
  if (APP_CONFIG.auth.googleClientSecret.trim()) return APP_CONFIG.auth.googleClientSecret.trim();

  // Installed-app OAuth clients are public clients. Do not ship a reusable
  // client_secret inside the desktop binary. A local secret is accepted only
  // for development compatibility with the current Google client setup.
  if (app.isPackaged) return '';

  const envSecret = process.env.LOCKON_GOOGLE_CLIENT_SECRET?.trim();
  if (envSecret) return envSecret;

  const candidates = [
    path.join(process.cwd(), 'google-oauth.local.json'),
    ...findCredentialFile(process.cwd()),
    ...findCredentialFile(app.getPath('downloads'))
  ];

  for (const candidate of candidates) {
    const credentials = tryReadGoogleCredentials(candidate);
    if (credentials?.client_id === APP_CONFIG.auth.googleClientId && credentials.client_secret) {
      return credentials.client_secret;
    }
  }
  return '';
};

const oauthHtmlHeaders = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store, max-age=0',
  'Pragma': 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char] ?? char);

export const loginLocalStarter = async (development: boolean): Promise<AuthState> => {
  if (!APP_CONFIG.auth.allowLocalStarterLogin || !development) {
    throw new Error('Logowanie lokalne jest dostępne tylko w development.');
  }
  const payload = await backendDevOwnerLogin();
  writeStoredSession({ apiToken: payload.token, provider: 'local', savedAt: new Date().toISOString() });
  return toAuthState(payload, development);
};

export const loginWithGoogle = async (development: boolean): Promise<AuthState> => {
  if (!hasGoogleClientId()) return emptyState(development, 'Najpierw skonfiguruj Google OAuth Client ID.');

  const clientSecret = resolveGoogleClientSecret();

  const { verifier, challenge } = createPkce();
  const stateToken = base64Url(crypto.randomBytes(24));

  return new Promise<AuthState>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      callback();
    };

    const server = http.createServer(async (request, response) => {
      try {
        const callbackUrl = new URL(request.url || '/', 'http://127.0.0.1');
        if (callbackUrl.pathname !== '/oauth2/callback') {
          response.writeHead(404, oauthHtmlHeaders).end('Not found');
          return;
        }

        const error = callbackUrl.searchParams.get('error');
        const returnedState = callbackUrl.searchParams.get('state');
        const code = callbackUrl.searchParams.get('code');
        if (error) throw new Error(`Google OAuth: ${error}`);
        if (returnedState !== stateToken) throw new Error('Nieprawidłowy stan sesji logowania.');
        if (!code) throw new Error('Google nie zwrócił kodu autoryzacji.');

        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Błąd lokalnego callbacku OAuth.');
        const redirectUri = `http://127.0.0.1:${address.port}/oauth2/callback`;

        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          redirect: 'error',
          body: new URLSearchParams({
            client_id: APP_CONFIG.auth.googleClientId,
            ...(clientSecret ? { client_secret: clientSecret } : {}),
            code,
            code_verifier: verifier,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri
          })
        });

        if (!tokenResponse.ok) {
          let googleError = '';
          try {
            const errorPayload = await tokenResponse.json() as { error?: unknown; error_description?: unknown };
            const code = typeof errorPayload.error === 'string' ? errorPayload.error : '';
            const description = typeof errorPayload.error_description === 'string' ? errorPayload.error_description : '';
            googleError = [code, description].filter(Boolean).join(': ');
          } catch {
            // Nie pokazujemy surowej odpowiedzi, aby przypadkiem nie ujawnić danych wrażliwych.
          }
          throw new Error(
            `Google odrzucił logowanie (HTTP ${tokenResponse.status})${googleError ? `: ${googleError}` : '.'}`
          );
        }

        const tokens = (await tokenResponse.json()) as { id_token?: string };
        if (!tokens.id_token) throw new Error('Google nie zwrócił tokena tożsamości.');

        // Backend weryfikuje podpis, issuer, czas ważności i audience ID tokena.
        const payload = await backendGoogleLogin(tokens.id_token);
        writeStoredSession({ apiToken: payload.token, provider: 'google', savedAt: new Date().toISOString() });
        const state = toAuthState(payload, development);

        const statusText = payload.user.status === 'ACTIVE'
          ? `Dostęp aktywny: <b>${escapeHtml(String(payload.user.role ?? ''))}</b>.`
          : 'Konto zostało zapisane i czeka na akceptację właściciela.';

        response.writeHead(200, oauthHtmlHeaders);
        response.end(`
          <!doctype html>
          <html lang="pl"><head><meta charset="utf-8"><title>LockOn ServiceOS</title></head>
          <body style="font-family:Arial;background:#111;color:#fff;padding:40px">
            <h2>LockOn ServiceOS</h2>
            <p>Zalogowano jako <b>${escapeHtml(payload.user.email)}</b>.</p>
            <p>${statusText}</p>
            <p>Możesz zamknąć tę kartę i wrócić do aplikacji.</p>
          </body></html>
        `);

        finish(() => {
          server.close();
          resolve(state);
        });
      } catch (error) {
        response.writeHead(500, oauthHtmlHeaders);
        response.end('<h2>Logowanie nie powiodło się. Wróć do LockOn ServiceOS.</h2>');
        finish(() => {
          server.close();
          reject(error);
        });
      }
    });

    server.maxHeadersCount = 40;
    server.requestTimeout = 15_000;

    server.on('error', (error) => finish(() => reject(error)));
    server.listen(0, '127.0.0.1', async () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        finish(() => reject(new Error('Nie udało się uruchomić callbacku OAuth.')));
        return;
      }
      const redirectUri = `http://127.0.0.1:${address.port}/oauth2/callback`;
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.search = new URLSearchParams({
        client_id: APP_CONFIG.auth.googleClientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state: stateToken,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        prompt: 'select_account'
      }).toString();
      await shell.openExternal(authUrl.toString());
    });

    setTimeout(() => {
      finish(() => {
        server.close();
        reject(new Error('Przekroczono czas oczekiwania na logowanie Google.'));
      });
    }, 180_000);
  });
};
