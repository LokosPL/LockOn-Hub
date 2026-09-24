import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL('../'+path,import.meta.url),'utf8');

const section = (source, start, end) => {
  const from=source.indexOf(start);
  assert.notEqual(from,-1,'missing section start: '+start);
  const to=source.indexOf(end,from+start.length);
  assert.notEqual(to,-1,'missing section end: '+end);
  return source.slice(from,to);
};

test('Google login zapisuje sesję przed opcjonalnym fallbackiem Gmail i ogranicza restore timeoutem', async () => {
  const source=await read('electron/googleAuth.ts');
  assert.match(source,/AUTH_SESSION_RESTORE_TIMEOUT_MS = 12_000/);
  assert.match(source,/backendMe\(stored\.apiToken, AbortSignal\.timeout\(AUTH_SESSION_RESTORE_TIMEOUT_MS\)\)/);
  assert.match(source,/GOOGLE_GMAIL_AUTOCONNECT_TIMEOUT_MS = 8_000/);

  const fallback=section(source,'payload = await backendGoogleLogin','writeStoredSession({ apiToken: payload.token, provider: \'google\'');
  assert.match(fallback,/backendGoogleLogin/);

  const afterFallback=source.slice(source.indexOf('payload = await backendGoogleLogin'));
  const persistedIndex=afterFallback.indexOf("writeStoredSession({ apiToken: payload.token, provider: 'google'");
  const gmailIndex=afterFallback.indexOf("backendRequest<NonNullable<BackendAuthPayload['gmail']>>('/integrations/gmail/connect'");
  assert.ok(persistedIndex>=0 && gmailIndex>persistedIndex,'fallback session must persist before Gmail auto-connect');
  assert.match(afterFallback,/AbortSignal\.timeout\(GOOGLE_GMAIL_AUTOCONNECT_TIMEOUT_MS\)/);
});

test('Backend Gmail follow-up podczas loginu nie robi sieciowego refresh ani natychmiastowej wysyłki backlogu', async () => {
  const source=await read('functions/lockon-api.mjs');
  assert.match(source,/GMAIL_UPSTREAM_TIMEOUT_MS = 8_000/);
  assert.match(source,/signal: AbortSignal\.timeout\(GMAIL_UPSTREAM_TIMEOUT_MS\)/);
  assert.match(source,/const requeueNoSenderNotificationsForUser/);

  const userAuto=section(source,'const autoConnectGmailFromPrimaryLogin','const autoConnectMeetingGmailFromOwner');
  assert.doesNotMatch(userAuto,/await refreshGmailAccess/);
  assert.doesNotMatch(userAuto,/recoverNoSenderNotificationsForUser/);
  assert.match(userAuto,/requeueNoSenderNotificationsForUser/);

  const meetingAuto=section(source,'const autoConnectMeetingGmailFromOwner','const mailSettingsForPoint');
  assert.doesNotMatch(meetingAuto,/await refreshGmailAccess/);

  const route=section(source,"if (method === 'POST' && url.pathname === '/auth/google-code')","if (method === 'POST' && url.pathname === '/auth/google')");
  assert.match(route,/Promise\.all\(/);
  assert.match(route,/autoConnectMeetingGmailFromOwner/);
  assert.match(route,/autoConnectGmailFromPrimaryLogin/);
});

test('Renderer może odzyskać zakończone logowanie bez restartu aplikacji', async () => {
  const main=await read('electron/main.ts');
  const preload=await read('electron/preload.ts');
  const types=await read('src/types/electron.d.ts');
  const app=await read('src/App.tsx');
  const login=await read('src/pages/LoginScreen.tsx');

  assert.match(main,/webContents\.send\('auth:state-changed', state\)/);
  assert.match(main,/void refreshAndPushAuthState\(\)/);
  assert.match(preload,/onState:/);
  assert.match(preload,/auth:state-changed/);
  assert.match(types,/onState: \(callback:\(state:AuthState\)=>void\)/);
  assert.match(app,/window\.lockOn\.auth\.onState/);
  assert.match(login,/GOOGLE_SESSION_RECOVERY_INTERVAL_MS = 1_500/);
  assert.match(login,/window\.lockOn\.auth\.getState\(\)/);
  assert.match(login,/Sesja Google została odzyskana/);
});
