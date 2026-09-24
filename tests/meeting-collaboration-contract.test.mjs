import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(path)=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const api=read('functions/lockon-api.mjs');
const migration=read('database/migrations/2026-09-24-v100022-meeting-collaboration.sql');
const room=read('src/components/MeetingRoom.tsx');
const card=read('src/components/MeetingsCard.tsx');
const app=read('src/App.tsx');
const dashboard=read('src/pages/Dashboard.tsx');
const main=read('electron/main.ts');

test('meeting chat is persisted and isolated by meeting id',()=>{
  assert.match(migration,/CREATE TABLE IF NOT EXISTS meeting_chat_messages/);
  assert.match(api,/WHERE m\.meeting_id=\$1 AND m\.deleted_at IS NULL/);
  assert.match(api,/INSERT INTO meeting_chat_messages\(id,meeting_id,author_user_id,body\)/);
});

test('raise hand survives reconnect and never leaks across meetings',()=>{
  assert.match(migration,/PRIMARY KEY \(meeting_id, user_id\)/);
  assert.match(api,/WHERE h\.meeting_id=\$1 AND \(h\.lowered_at IS NULL OR h\.lowered_at<h\.raised_at\)/);
  assert.match(api,/ON CONFLICT\(meeting_id,user_id\) DO UPDATE/);
  assert.match(api,/UPDATE meeting_hand_raises SET lowered_at=now\(\).*meeting_id=\$1 AND user_id=\$2/);
});

test('email notifications are explicit opt-in and worker respects OFF',()=>{
  assert.match(migration,/email_notifications_enabled boolean NOT NULL DEFAULT false/);
  assert.match(card,/Powiadom uczestników e-mailem/);
  assert.match(api,/if\(preference\?\.email_notifications_enabled!==true\)return \{eligible:0,queued:0,disabled:true\}/);
  assert.match(api,/m\.email_notifications_enabled=true/);
});

test('stable meeting URL contains no LiveKit credential',()=>{
  assert.match(api,/meetingUrl:PUBLIC_PORTAL_URL\+'\/\?spotkanie='/);
  assert.match(api,/desktopDeepLink:'lockon-serviceos:\/\/meeting\/'/);
  const urlLine=api.split('\n').find((line)=>line.includes("meetingUrl:PUBLIC_PORTAL_URL")) ?? '';
  assert.doesNotMatch(urlLine,/token|jwt|LIVEKIT/i);
});

test('meetings are a dedicated module while Start keeps only summary',()=>{
  assert.match(app,/active === 'meetings'/);
  assert.match(app,/MeetingsPage/);
  assert.match(dashboard,/NextMeetingCard/);
  assert.doesNotMatch(dashboard,/MeetingsCard/);
});

test('meeting room exposes chat, hand, speaker and safe share cleanup',()=>{
  for(const contract of ['sendChat','setHandRaised','ActiveSpeakersChanged','audioLevel','meeting-local-share-preview','Zmień ekran / okno','shareOverlay(null)']){
    assert.ok(room.includes(contract),contract);
  }
  assert.match(main,/setIgnoreMouseEvents\(true/);
  assert.match(main,/setContentProtection\(true\)/);
  assert.match(main,/closeMeetingShareOverlay\(\)/);
});

test('system-stopped screen share resets local state and overlay',()=>{
  assert.match(room,/mediaTrack\.addEventListener\('ended'/);
  assert.match(room,/setScreenEnabled\(false\)/);
  assert.match(room,/setSelectedSource\(null\)/);
  assert.match(room,/meetings\.shareOverlay\(null\)/);
});
