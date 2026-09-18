import { shell } from 'electron';
import crypto from 'node:crypto';
import http from 'node:http';
import { APP_CONFIG } from './appConfig';
import { backendRequest } from './backendApi';
import { getStoredApiToken } from './googleAuth';

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

export const connectGmailSender = async (pointId: string): Promise<GmailConnectionStatus> => {
  const apiToken = getStoredApiToken();
  if (!apiToken) throw new Error('Brak aktywnej sesji LockOn.');

  const me = await backendRequest<{ user?: { email?: string } }>('/me', {}, apiToken).catch(() => ({}));
  const preferredEmail = String(me.user?.email || '').trim().toLowerCase();

  const { verifier, challenge } = createPkce();
  const stateToken = base64Url(crypto.randomBytes(24));

  return new Promise<GmailConnectionStatus>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
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

        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Błąd callbacku Gmail OAuth.');
        const redirectUri = 'http://127.0.0.1:' + address.port + '/gmail/callback';

        const clientSecret = APP_CONFIG.auth.googleClientSecret.trim();
        if (!clientSecret) throw new Error('Brak danych Google OAuth wymaganych przez klienta desktopowego.');

        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          redirect: 'error',
          body: new URLSearchParams({
            client_id: APP_CONFIG.auth.googleClientId,
            client_secret: clientSecret,
            code,
            code_verifier: verifier,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri
          })
        });
        const tokenPayload = await tokenResponse.json() as { refresh_token?: string; error?: string; error_description?: string };
        if (!tokenResponse.ok) {
          throw new Error(tokenPayload.error_description || tokenPayload.error || 'Google odrzucił połączenie Gmail.');
        }
        if (!tokenPayload.refresh_token) {
          throw new Error('Google nie zwrócił refresh tokena. Odłącz dostęp ServiceOS w koncie Google i spróbuj ponownie.');
        }

        const status = await backendRequest<GmailConnectionStatus>(
          '/integrations/gmail/connect',
          {
            method: 'POST',
            body: JSON.stringify({ pointId, refreshToken: tokenPayload.refresh_token, clientSecret })
          },
          apiToken
        );

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
        include_granted_scopes: 'true'
      });
      if (preferredEmail) params.set('login_hint', preferredEmail);
      authUrl.search = params.toString();
      await shell.openExternal(authUrl.toString());
    });

    setTimeout(() => {
      finish(() => {
        server.close();
        reject(new Error('Przekroczono czas oczekiwania na połączenie Gmail.'));
      });
    }, 180_000);
  });
};
