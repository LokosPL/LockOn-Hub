import { shell } from 'electron';
import crypto from 'node:crypto';
import http from 'node:http';
import { APP_CONFIG } from './appConfig';
import { backendRequest } from './backendApi';
import { getStoredApiToken } from './googleAuth';

const GMAIL_OAUTH_USER_WAIT_MS = 10 * 60_000;
const GMAIL_OAUTH_EXCHANGE_TIMEOUT_MS = 60_000;

const base64Url = (input: Buffer) =>
  input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

const createPkce = () => {
  const verifier = base64Url(crypto.randomBytes(48));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
};

const headers = {
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

const friendlyGoogleOAuthError = (code: string, description = '') => {
  const normalized = code.trim().toLowerCase();
  if (normalized === 'access_denied') {
    return 'Google nie udzielił zgody na wysyłanie wiadomości. Jeśli zamknąłeś ekran zgody lub wybrałeś powrót do bezpieczeństwa, spróbuj ponownie.';
  }
  if (normalized === 'temporarily_unavailable') {
    return 'Google chwilowo nie może zakończyć autoryzacji. Spróbuj ponownie za moment.';
  }
  const cleanDescription = description.replace(/[\r\n]+/g, ' ').trim().slice(0, 280);
  return cleanDescription || (code ? 'Google OAuth: ' + code : 'Google odrzucił połączenie Gmail.');
};

const oauthPage = (title: string, message: string, ok: boolean) => `<!doctype html>
<html lang="pl">
<head><meta charset="utf-8"><title>LockOn ServiceOS</title></head>
<body style="margin:0;background:#0d0f13;color:#eef1f4;font-family:Arial,sans-serif">
  <main style="max-width:680px;margin:8vh auto;padding:28px">
    <div style="border:1px solid #2b3038;border-radius:18px;background:#15181e;padding:26px">
      <div style="font-size:12px;font-weight:800;letter-spacing:.08em;color:${ok ? '#71d99b' : '#ff8c84'}">LOCKON SERVICEOS</div>
      <h2 style="margin:10px 0 12px">${escapeHtml(title)}</h2>
      <p style="margin:0;color:#aab2bc;line-height:1.55">${escapeHtml(message)}</p>
      <p style="margin:18px 0 0;color:#707985;font-size:12px">Możesz zamknąć tę kartę i wrócić do ServiceOS.</p>
    </div>
  </main>
</body>
</html>`;

export interface GmailConnectionStatus {
  connected: boolean;
  needsReconnect?: boolean;
  pointId: string;
  email?: string;
  status?: string;
  lastError?: string | null;
  connectedAt?: string;
  recoveredNotifications?: number;
}

export const getGmailConnectionStatus = async (pointId: string) => {
  const token = getStoredApiToken();
  if (!token) throw new Error('Brak aktywnej sesji LockOn.');
  return backendRequest<GmailConnectionStatus>(
    '/integrations/gmail?pointId=' + encodeURIComponent(pointId),
    {},
    token
  );
};

export const disconnectGmailSender = async (pointId: string) => {
  const token = getStoredApiToken();
  if (!token) throw new Error('Brak aktywnej sesji LockOn.');
  return backendRequest<{ ok: true }>(
    '/integrations/gmail?pointId=' + encodeURIComponent(pointId),
    { method: 'DELETE' },
    token
  );
};

const performGmailConnect = async (pointId: string): Promise<GmailConnectionStatus> => {
  const apiToken = getStoredApiToken();
  if (!apiToken) throw new Error('Brak aktywnej sesji LockOn.');

  let preferredEmail = '';
  try {
    const me = await backendRequest<{ user?: { email?: string } }>('/me', {}, apiToken);
    preferredEmail = String(me.user?.email || '').trim().toLowerCase();
  } catch {
    // login_hint jest tylko ułatwieniem UX; brak /me nie może blokować OAuth.
  }

  const { verifier, challenge } = createPkce();
  const stateToken = base64Url(crypto.randomBytes(24));

  return new Promise<GmailConnectionStatus>((resolve, reject) => {
    let settled = false;
    let callbackAccepted = false;
    let userWaitTimer: ReturnType<typeof setTimeout> | null = null;

    const clearUserWaitTimer = () => {
      if (!userWaitTimer) return;
      clearTimeout(userWaitTimer);
      userWaitTimer = null;
    };

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearUserWaitTimer();
      fn();
    };

    const server = http.createServer(async (request, response) => {
      try {
        const callback = new URL(request.url || '/', 'http://127.0.0.1');
        if (callback.pathname !== '/gmail/callback') {
          response.writeHead(404, headers).end('Not found');
          return;
        }
        const error = callback.searchParams.get('error');
        const errorDescription = callback.searchParams.get('error_description') || '';
        const returnedState = callback.searchParams.get('state');
        const code = callback.searchParams.get('code');
        if (error) throw new Error(friendlyGoogleOAuthError(error, errorDescription));
        if (returnedState !== stateToken) throw new Error('Nieprawidłowy state OAuth.');
        if (!code) throw new Error('Google nie zwrócił kodu autoryzacji.');
        if (callbackAccepted) {
          response.writeHead(409, headers).end('Połączenie Gmail jest już finalizowane.');
          return;
        }

        callbackAccepted = true;
        clearUserWaitTimer();

        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Błąd callbacku Gmail OAuth.');
        const redirectUri = 'http://127.0.0.1:' + address.port + '/gmail/callback';

        let status: GmailConnectionStatus;
        try {
          status = await backendRequest<GmailConnectionStatus>(
            '/integrations/gmail/connect-code',
            {
              method: 'POST',
              signal: AbortSignal.timeout(GMAIL_OAUTH_EXCHANGE_TIMEOUT_MS),
              body: JSON.stringify({
                pointId,
                code,
                codeVerifier: verifier,
                redirectUri
              })
            },
            apiToken
          );
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
            signal: AbortSignal.timeout(GMAIL_OAUTH_EXCHANGE_TIMEOUT_MS),
            body: new URLSearchParams({
              client_id: APP_CONFIG.auth.googleClientId,
              client_secret: clientSecret,
              code,
              code_verifier: verifier,
              grant_type: 'authorization_code',
              redirect_uri: redirectUri
            })
          });
          const tokenPayload = await tokenResponse.json() as { refresh_token?: string; id_token?: string; error?: string; error_description?: string };
          if (!tokenResponse.ok) {
            throw new Error(tokenPayload.error_description || tokenPayload.error || 'Google odrzucił połączenie Gmail.');
          }
          if (!tokenPayload.refresh_token) {
            throw new Error('Google nie zwrócił refresh tokena. Odłącz dostęp ServiceOS w koncie Google i spróbuj ponownie.');
          }
          if (!tokenPayload.id_token) {
            throw new Error('Google nie zwrócił tokena tożsamości dla połączonego konta.');
          }

          status = await backendRequest<GmailConnectionStatus>(
            '/integrations/gmail/connect',
            {
              method: 'POST',
              signal: AbortSignal.timeout(GMAIL_OAUTH_EXCHANGE_TIMEOUT_MS),
              body: JSON.stringify({
                pointId,
                refreshToken: tokenPayload.refresh_token,
                idToken: tokenPayload.id_token,
                clientSecret
              })
            },
            apiToken
          );
        }

        response.writeHead(200, headers);
        response.end(oauthPage(
          'Gmail połączony',
          'ServiceOS może wysyłać klientom powiadomienia z konta ' + (status.email || preferredEmail || 'Google') + '.',
          true
        ));
        finish(() => {
          server.close();
          resolve(status);
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Nie udało się połączyć Gmail.';
        response.writeHead(400, headers);
        response.end(oauthPage('Nie udało się połączyć Gmail', message, false));
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
        finish(() => reject(new Error('Nie udało się uruchomić callbacku Gmail OAuth.')));
        return;
      }
      const redirectUri = 'http://127.0.0.1:' + address.port + '/gmail/callback';
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      const params = new URLSearchParams({
        client_id: APP_CONFIG.auth.googleClientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile https://www.googleapis.com/auth/gmail.send',
        state: stateToken,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'false'
      });
      if (preferredEmail) params.set('login_hint', preferredEmail);
      authUrl.search = params.toString();
      try {
        await shell.openExternal(authUrl.toString());
      } catch {
        finish(() => {
          server.close();
          reject(new Error('Nie udało się otworzyć autoryzacji Gmail w przeglądarce.'));
        });
      }
    });

    userWaitTimer = setTimeout(() => {
      finish(() => {
        server.close();
        reject(new Error('Autoryzacja Gmail nie została zakończona. Uruchom połączenie ponownie.'));
      });
    }, GMAIL_OAUTH_USER_WAIT_MS);
  });
};

const gmailConnectInFlight = new Map<string, Promise<GmailConnectionStatus>>();

export const connectGmailSender = (pointId: string): Promise<GmailConnectionStatus> => {
  const safePointId = String(pointId ?? '').trim().slice(0, 80);
  if (!safePointId) return Promise.reject(new Error('Brak punktu dla integracji Gmail.'));

  const existing = gmailConnectInFlight.get(safePointId);
  if (existing) return existing;

  const attempt = performGmailConnect(safePointId);
  const tracked = attempt.finally(() => {
    if (gmailConnectInFlight.get(safePointId) === tracked) {
      gmailConnectInFlight.delete(safePointId);
    }
  });
  gmailConnectInFlight.set(safePointId, tracked);
  return tracked;
};
