import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL('../'+path,import.meta.url),'utf8');

test('Dashboard status jest renderowany z backendowego meeting.status', async () => {
  const source=await read('src/components/MeetingsCard.tsx');
  assert.match(source,/meeting\.status === 'LIVE'/);
  assert.match(source,/meeting\.status === 'SCHEDULED'/);
  assert.match(source,/item\.status === 'LIVE' \|\| item\.status === 'SCHEDULED'/);
  assert.doesNotMatch(source,/Date\.now\(\)[^\n]{0,120}LIVE|startsAt[^\n]{0,120}\?[^\n]{0,120}LIVE/);
  assert.match(source,/Termin minął · oczekiwanie na prowadzącego/);
  assert.match(source,/Brak zaplanowanych spotkań\./);
});

test('Renderer łączy się dokładnie z LiveKit serverUrl i nie pokazuje surowego błędu sygnału', async () => {
  const source=await read('src/components/MeetingRoom.tsx');
  assert.match(source,/room\.connect\(serverUrl, credentials\.token/);
  assert.match(source,/Nie udało się połączyć ze spotkaniem\. Sprawdź połączenie z internetem i spróbuj ponownie\./);
  assert.match(source,/Spróbuj ponownie/);
  assert.match(source,/console\.error\('\[meeting connection\]'/);
  assert.doesNotMatch(source,/setError\(err instanceof Error \? err\.message : 'Nie udało się dołączyć/);
});

test('CSP i Electron dopuszczają tylko zaufane media/LiveKit Cloud', async () => {
  const html=await read('index.html');
  const electron=await read('electron/main.ts');
  assert.match(html,/https:\/\/\*\.livekit\.cloud/);
  assert.match(html,/wss:\/\/\*\.livekit\.cloud/);
  assert.match(electron,/permission === 'media' && isTrustedRendererUrl/);
  assert.match(electron,/setPermissionCheckHandler/);
});

test('Backend nie ma czasowej autopromocji spotkania do LIVE', async () => {
  const source=await read('functions/lockon-api.mjs');
  assert.match(source,/if\(!canJoinMeeting\(meeting\.status\)\)/);
  assert.match(source,/const target=getMeetingTransition\(meeting\.status,action\)/);
  assert.doesNotMatch(source,/UPDATE meetings SET status='LIVE'/);
  assert.doesNotMatch(source,/starts_at\s*<=\s*now\(\)[^\n]{0,180}LIVE/i);
});

test('Gmail spotkań pozostaje odseparowany od sendera wiadomości serwisowych', async () => {
  const migration=await read('database/migrations/2026-09-24-v100020-meetings.sql');
  const backend=await read('functions/lockon-api.mjs');
  assert.match(migration,/meeting_email_sender/);
  assert.match(migration,/ISOLATED/i);
  assert.match(backend,/meeting_email_outbox/);
  assert.match(backend,/notification_outbox/);
  assert.match(backend,/senderUserId/);
});

test('Daty formularza są wysyłane jako jednoznaczne ISO i wyświetlane lokalnie', async () => {
  const source=await read('src/components/MeetingsCard.tsx');
  assert.match(source,/startsAt:startsAt\.toISOString\(\)/);
  assert.match(source,/toLocaleString\('pl-PL'/);
  assert.match(source,/getTimezoneOffset\(\)/);
});
