import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLiveKitGrant,
  canJoinMeeting,
  getMeetingTransition,
  meetingScheduleHint,
  normalizeLiveKitUrls,
  resolveMeetingPublishPermissions
} from '../functions/meeting-policy.mjs';

test('SCHEDULED pozostaje SCHEDULED po upływie startsAt', () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  assert.equal(getMeetingTransition('SCHEDULED','noop'), null);
  assert.equal(canJoinMeeting('SCHEDULED'), false);
  assert.match(meetingScheduleHint('SCHEDULED',past), /oczekiwanie na prowadzącego/);
});

test('lifecycle wymaga jawnej akcji hosta', () => {
  assert.equal(getMeetingTransition('SCHEDULED','start'),'LIVE');
  assert.equal(getMeetingTransition('LIVE','end'),'ENDED');
  assert.equal(getMeetingTransition('SCHEDULED','cancel'),'CANCELLED');
  assert.equal(getMeetingTransition('CANCELLED','start'),null);
  assert.equal(getMeetingTransition('ENDED','start'),null);
});

test('join jest możliwy wyłącznie w LIVE', () => {
  assert.equal(canJoinMeeting('SCHEDULED'),false);
  assert.equal(canJoinMeeting('LIVE'),true);
  assert.equal(canJoinMeeting('ENDED'),false);
  assert.equal(canJoinMeeting('CANCELLED'),false);
});

test('grant uczestnika respektuje audio i screen share', () => {
  assert.deepEqual(resolveMeetingPublishPermissions({
    isManager:false,
    allowParticipantAudio:false,
    allowParticipantScreenShare:false
  }), {microphone:false,screenShare:false});
  assert.deepEqual(resolveMeetingPublishPermissions({
    isManager:false,
    allowParticipantAudio:true,
    allowParticipantScreenShare:true,
    microphoneAllowed:false
  }), {microphone:false,screenShare:true});
  assert.deepEqual(resolveMeetingPublishPermissions({isManager:true}), {microphone:true,screenShare:true});
});

test('LiveKit grant nie daje publish poza przekazanymi źródłami', () => {
  assert.deepEqual(buildLiveKitGrant('room-a',[]),{
    roomJoin:true,room:'room-a',canSubscribe:true,canPublish:false,canPublishData:false,canPublishSources:[]
  });
  assert.deepEqual(buildLiveKitGrant('room-a',[1,3]),{
    roomJoin:true,room:'room-a',canSubscribe:true,canPublish:true,canPublishData:false,canPublishSources:[1,3]
  });
});

test('LiveKit URL jest normalizowany do wss dla klienta i https dla serwera', () => {
  assert.deepEqual(normalizeLiveKitUrls('https://example.livekit.cloud/'),{
    clientUrl:'wss://example.livekit.cloud',
    serverUrl:'https://example.livekit.cloud',
    hostname:'example.livekit.cloud',
    isCloud:true,
    secure:true
  });
  assert.throws(()=>normalizeLiveKitUrls('http://example.livekit.cloud'),/szyfrowanego/);
  assert.equal(normalizeLiveKitUrls('ws://127.0.0.1:7880')?.clientUrl,'ws://127.0.0.1:7880');
});

test('muted-by-default jest kontraktem renderera', async () => {
  const source = await import('node:fs/promises').then((fs)=>fs.readFile(new URL('../src/components/MeetingRoom.tsx', import.meta.url),'utf8'));
  assert.match(source,/useState\(false\).*micEnabled|\[micEnabled, setMicEnabled\] = useState\(false\)/s);
  assert.match(source,/Mikrofon pozostaje wyłączony po wejściu/);
});
