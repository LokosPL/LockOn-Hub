import { app, safeStorage, shell } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { APP_CONFIG, hasGoogleClientId, type UserRole } from './appConfig';
import {
  backendDevOwnerLogin,
  backendGoogleCodeLogin,
  backendGoogleLogin,
  backendLogout,
  backendRequest,
  backendMe,
  type BackendAuthPayload,
  type BackendLoginPayload,
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
  technicianSplitPercent?: number | null;
  supportEnabled?: boolean;
  status: AccountStatus | null;
  requestedPoint?: BackendRequestedPoint | null;
  gmailConnected?: boolean;
  gmailStatus?: string | null;
  gmailEmail?: string | null;
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

const SESSION_FILE = 'auth-session.json';
const GOOGLE_OAUTH_USER_WAIT_MS = 10 * 60_000;
const GOOGLE_OAUTH_EXCHANGE_TIMEOUT_MS = 45_000;
const GOOGLE_GMAIL_AUTOCONNECT_TIMEOUT_MS = 8_000;
const AUTH_SESSION_RESTORE_TIMEOUT_MS = 12_000;
const AUTH_LOGOUT_TIMEOUT_MS = 8_000;
const sessionPath = () => path.join(app.getPath('userData'), SESSION_FILE);

let googleLoginInFlight: Promise<AuthState> | null = null;

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
    point: points.find((point)=>point.id===payload.activePointId) ?? points[0] ?? null,
    points,
    role: payload.user.role,
    technicianSplitPercent: payload.user.technicianSplitPercent ?? null,
    supportEnabled: payload.user.supportEnabled === true || payload.user.role === 'SUPPORT' || payload.user.role === 'OWNER',
    status: payload.user.status,
    requestedPoint: payload.user.requestedPoint ?? null,
    gmailConnected: payload.gmail?.connected === true,
    gmailStatus: payload.gmail?.reason ?? payload.gmail?.status ?? null,
    gmailEmail: payload.gmail?.email ?? null,
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
  technicianSplitPercent: null,
  supportEnabled: false,
  status: null,
  requestedPoint: null,
  message
});

export const getAuthState = async (development: boolean): Promise<AuthState> => {
  const stored = readStoredSession();
  if (!stored) return emptyState(development);

  try {
    const payload = await backendMe(stored.apiToken, AbortSignal.timeout(AUTH_SESSION_RESTORE_TIMEOUT_MS));
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
    try { await backendLogout(stored.apiToken, AbortSignal.timeout(AUTH_LOGOUT_TIMEOUT_MS)); } catch {
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

const oauthHtmlHeaders = (nonce?: string) => ({
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store, max-age=0',
  'Pragma': 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; script-src ${nonce ? `'nonce-${nonce}'` : "'none'"}; base-uri 'none'; frame-ancestors 'none'`
});

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

const performGoogleLogin = async (development: boolean): Promise<AuthState> => {
  if (!hasGoogleClientId()) return emptyState(development, 'Najpierw skonfiguruj Google OAuth Client ID.');

  const { verifier, challenge } = createPkce();
  const stateToken = base64Url(crypto.randomBytes(24));

  return new Promise<AuthState>((resolve, reject) => {
    let settled = false;
    let callbackAccepted = false;
    let userWaitTimer: ReturnType<typeof setTimeout> | null = null;

    const clearUserWaitTimer = () => {
      if (!userWaitTimer) return;
      clearTimeout(userWaitTimer);
      userWaitTimer = null;
    };

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearUserWaitTimer();
      callback();
    };

    const server = http.createServer(async (request, response) => {
      try {
        const callbackUrl = new URL(request.url || '/', 'http://127.0.0.1');
        if (callbackUrl.pathname !== '/oauth2/callback') {
          response.writeHead(404, oauthHtmlHeaders()).end('Nie znaleziono.');
          return;
        }

        const error = callbackUrl.searchParams.get('error');
        const errorDescription = callbackUrl.searchParams.get('error_description') || '';
        const returnedState = callbackUrl.searchParams.get('state');
        const code = callbackUrl.searchParams.get('code');
        if (error) {
          const cleanDescription = errorDescription.replace(/[\r\n]+/g, ' ').trim().slice(0, 280);
          if (error === 'access_denied') {
            throw new Error('Logowanie Google zostało anulowane lub dostęp został odrzucony.');
          }
          throw new Error(cleanDescription || `Google OAuth: ${error}`);
        }
        if (returnedState !== stateToken) throw new Error('Nieprawidłowy stan sesji logowania.');
        if (!code) throw new Error('Google nie zwrócił kodu autoryzacji.');
        if (callbackAccepted) {
          response.writeHead(409, oauthHtmlHeaders()).end('Logowanie jest już finalizowane.');
          return;
        }

        callbackAccepted = true;
        // Od tego momentu użytkownik zakończył pracę w Google. Nie wolno już
        // pozwolić, aby timer oczekiwania na przeglądarkę przerwał wymianę kodu.
        clearUserWaitTimer();

        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Błąd lokalnego callbacku OAuth.');
        const redirectUri = `http://127.0.0.1:${address.port}/oauth2/callback`;

        let payload: BackendLoginPayload;
        try {
          payload = await backendGoogleCodeLogin({
            code,
            codeVerifier: verifier,
            redirectUri
          }, AbortSignal.timeout(GOOGLE_OAUTH_EXCHANGE_TIMEOUT_MS));
        } catch (serverError) {
          const typed = serverError as Error & { code?: string; status?: number };
          const canFallback = typed.code === 'SERVER_OAUTH_NOT_CONFIGURED' || typed.code === 'NOT_FOUND' || typed.status === 404;
          if (!canFallback) throw serverError;

          const clientSecret = APP_CONFIG.auth.googleClientSecret.trim();
          if (!clientSecret) {
            throw new Error('Serwerowe Google OAuth nie jest jeszcze skonfigurowane. Administrator musi dodać credential po stronie ServiceOS.');
          }

          const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            redirect: 'error',
            signal: AbortSignal.timeout(GOOGLE_OAUTH_EXCHANGE_TIMEOUT_MS),
            body: new URLSearchParams({
              client_id: APP_CONFIG.auth.googleClientId,
              client_secret: clientSecret,
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
              const errorCode = typeof errorPayload.error === 'string' ? errorPayload.error : '';
              const description = typeof errorPayload.error_description === 'string' ? errorPayload.error_description : '';
              googleError = [errorCode, description].filter(Boolean).join(': ');
            } catch {}
            throw new Error(
              `Google odrzucił logowanie (HTTP ${tokenResponse.status})${googleError ? `: ${googleError}` : '.'}`
            );
          }

          const tokens = (await tokenResponse.json()) as {
            id_token?: string;
            refresh_token?: string;
            scope?: string;
          };
          if (!tokens.id_token) throw new Error('Google nie zwrócił tokena tożsamości.');
          payload = await backendGoogleLogin(tokens.id_token, AbortSignal.timeout(GOOGLE_OAUTH_EXCHANGE_TIMEOUT_MS));

          // Sesja użytkownika jest ważniejsza niż opcjonalne spięcie Gmaila.
          // Zapisujemy ją natychmiast po poprawnym logowaniu, dzięki czemu renderer
          // może ją odzyskać nawet gdy dalsza integracja Google odpowiada wolno.
          writeStoredSession({ apiToken: payload.token, provider: 'google', savedAt: new Date().toISOString() });

          const role = String(payload.user.role ?? '').toUpperCase();
          const pointId = String(payload.activePointId ?? '').trim();
          const canAutoConnectGmail =
            role !== 'OWNER' &&
            payload.user.status === 'ACTIVE' &&
            Boolean(tokens.refresh_token) &&
            String(tokens.scope ?? '').split(/\s+/).includes('https://www.googleapis.com/auth/gmail.send');

          if (canAutoConnectGmail) {
            try {
              payload.gmail = await backendRequest<NonNullable<BackendAuthPayload['gmail']>>('/integrations/gmail/connect', {
                method: 'POST',
                signal: AbortSignal.timeout(GOOGLE_GMAIL_AUTOCONNECT_TIMEOUT_MS),
                body: JSON.stringify({
                  pointId: pointId || null,
                  refreshToken: tokens.refresh_token,
                  idToken: tokens.id_token,
                  clientSecret
                })
              }, payload.token);
            } catch {
              payload.gmail = { connected:false, pointId:pointId || null, reason:'GMAIL_AUTO_CONNECT_FAILED' };
            }
          }
        }

        writeStoredSession({ apiToken: payload.token, provider: 'google', savedAt: new Date().toISOString() });
        const state = toAuthState(payload, development);

        const statusText = payload.user.status === 'ACTIVE'
          ? 'Dostęp do ServiceOS jest aktywny.'
          : 'Konto zostało zapisane i czeka na akceptację przez osobę uprawnioną.';
        const pageNonce = base64Url(crypto.randomBytes(18));
        const returnToAppUrl = 'lockon-serviceos://login-complete';

        response.writeHead(200, oauthHtmlHeaders(pageNonce));
        response.end(`
          <!doctype html>
          <html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Logowanie zakończone · ServiceOS</title></head>
          <body style="font-family:Arial,sans-serif;background:#111;color:#fff;padding:40px;max-width:620px;margin:0 auto;line-height:1.5">
            <h1 style="font-size:28px;margin:0 0 16px">Logowanie zakończone.</h1>
            <p style="font-size:18px">Wracamy do ServiceOS.</p>
            <p style="color:#c3c8cf">Zalogowano jako <b>${escapeHtml(payload.user.email)}</b>. ${statusText}</p>
            <p style="color:#8f98a3">Ta karta spróbuje zamknąć się automatycznie za kilka sekund.</p>
            <p><a id="returnToApp" href="${returnToAppUrl}" style="display:inline-block;background:#fff;color:#111;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:10px">Wróć do aplikacji</a></p>
            <script nonce="${pageNonce}">
              (() => {
                const target = '${returnToAppUrl}';
                const openApp = () => { window.location.href = target; };
                document.getElementById('returnToApp')?.addEventListener('click', (event) => {
                  event.preventDefault();
                  openApp();
                });
                window.setTimeout(openApp, 180);
                window.setTimeout(() => window.close(), 5000);
              })();
            </script>
          </body></html>
        `);

        finish(() => {
          server.close();
          resolve(state);
        });
      } catch (error) {
        const errorName = error instanceof Error ? error.name : '';
        const message = errorName === 'AbortError' || errorName === 'TimeoutError'
          ? 'Google lub serwer logowania odpowiadał zbyt długo. Spróbuj ponownie.'
          : error instanceof Error
            ? error.message
            : 'Logowanie nie powiodło się.';
        const pageNonce = base64Url(crypto.randomBytes(18));
        const returnToAppUrl = 'lockon-serviceos://login-complete';
        response.writeHead(400, oauthHtmlHeaders(pageNonce));
        response.end(`
          <!doctype html>
          <html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nie udało się zalogować · ServiceOS</title></head>
          <body style="font-family:Arial,sans-serif;background:#111;color:#fff;padding:40px;max-width:620px;margin:0 auto;line-height:1.5">
            <h1 style="font-size:28px;margin:0 0 16px">Nie udało się zakończyć logowania.</h1>
            <p style="color:#c3c8cf">${escapeHtml(message)}</p>
            <p style="color:#8f98a3">Wróć do ServiceOS i spróbuj ponownie. Ta karta spróbuje zamknąć się automatycznie.</p>
            <p><a id="returnToApp" href="${returnToAppUrl}" style="display:inline-block;background:#fff;color:#111;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:10px">Wróć do aplikacji</a></p>
            <script nonce="${pageNonce}">
              (() => {
                const target = '${returnToAppUrl}';
                const openApp = () => { window.location.href = target; };
                document.getElementById('returnToApp')?.addEventListener('click', (event) => {
                  event.preventDefault();
                  openApp();
                });
                window.setTimeout(() => window.close(), 5000);
              })();
            </script>
          </body></html>
        `);
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
        scope: 'openid email profile https://www.googleapis.com/auth/gmail.send',
        access_type: 'offline',
        include_granted_scopes: 'true',
        state: stateToken,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        prompt: 'consent select_account'
      }).toString();
      try {
        await shell.openExternal(authUrl.toString());
      } catch {
        finish(() => {
          server.close();
          reject(new Error('Nie udało się otworzyć bezpiecznego logowania Google w przeglądarce.'));
        });
      }
    });

    userWaitTimer = setTimeout(() => {
      finish(() => {
        server.close();
        reject(new Error('Okno logowania Google było otwarte zbyt długo. Uruchom logowanie ponownie.'));
      });
    }, GOOGLE_OAUTH_USER_WAIT_MS);
  });
};

export const loginWithGoogle = (development: boolean): Promise<AuthState> => {
  if (googleLoginInFlight) return googleLoginInFlight;

  const attempt = performGoogleLogin(development);
  const tracked = attempt.finally(() => {
    if (googleLoginInFlight === tracked) googleLoginInFlight = null;
  });
  googleLoginInFlight = tracked;
  return tracked;
};
