import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('1.0.3.22 keeps the live room mounted while navigating through ServiceOS', () => {
  const app = read('src/App.tsx');
  const room = read('src/components/MeetingRoom.tsx');
  const state = read('src/meetingLiveState.ts');

  assert.match(app, /persistent-meetings-host/);
  assert.match(app, /active === 'meetings' \? 'active' : 'background'/);
  assert.doesNotMatch(app, /active === 'meetings' && <MeetingsPage/);
  assert.match(room, /publishMeetingLiveState/);
  assert.match(state, /lockon:meeting-live-state/);
});

test('1.0.3.22 browser remains interactive while the meeting dock is expanded', () => {
  const app = read('src/App.tsx');
  const browser = read('src/pages/BrowserPage.tsx');
  const styles = read('src/styles.css');

  assert.match(app, /active === 'browser' && !helpOpen/);
  assert.doesNotMatch(app, /active === 'browser' && !helpOpen && !meetingDockExpanded/);
  assert.match(app, /BrowserPage meetingDockExpanded=\{meetingDockExpanded\}/);
  assert.match(browser, /meeting-dock-open/);
  assert.match(styles, /browser-page\.meeting-dock-open \.browser-host-frame/);
});

test('1.0.3.22 exposes a persistent host-only broadcast overlay for screen and window sharing', () => {
  const electron = read('electron/main.ts');
  const preload = read('electron/preload.ts');
  const room = read('src/components/MeetingRoom.tsx');

  assert.match(electron, /safe\.kind !== 'screen' && safe\.kind !== 'window'/);
  assert.match(electron, /setAlwaysOnTop\(true,'screen-saver'\)/);
  assert.match(electron, /setContentProtection\(true\)/);
  assert.match(electron, /setVisibleOnAllWorkspaces\(true,\{visibleOnFullScreen:true\}\)/);
  assert.match(electron, /meetings:updateShareOverlay/);
  assert.match(preload, /updateShareOverlay/);
  assert.match(room, /updateShareOverlay/);
  assert.match(electron, /Mówi:/);
  assert.match(electron, /latestMessage/);
});

test('1.0.3.22 defaults to a clean broadcast stage instead of a recursive local mirror', () => {
  const room = read('src/components/MeetingRoom.tsx');

  assert.match(room, /showSelfPreview/);
  assert.match(room, /TRANSMISJA AKTYWNA/);
  assert.match(room, /Lokalny podgląd jest domyślnie ukryty/);
  assert.match(room, /Pokaż lokalny podgląd/);
  assert.match(room, /Nikt nie udostępnia ekranu/);
});

test('1.0.3.22 prioritizes high-resolution screen share and low-latency speech', () => {
  const room = read('src/components/MeetingRoom.tsx');
  const electron = read('electron/main.ts');

  assert.match(room, /maxWidth:3840/);
  assert.match(room, /maxHeight:2160/);
  assert.match(room, /maxFrameRate:60/);
  assert.match(room, /contentHint = 'detail'/);
  assert.match(room, /simulcast:false/);
  assert.match(room, /maxBitrate:12_000_000/);
  assert.match(room, /maxFramerate:60/);
  assert.match(room, /degradationPreference:'maintain-resolution'/);
  assert.match(room, /sampleRate:48_000/);
  assert.match(room, /latency:\{ideal:0\.01,max:0\.04\}/);
  assert.match(room, /stopMicTrackOnMute:false/);
  assert.match(room, /red:true/);
  assert.match(electron, /backgroundThrottling: false/);
  assert.match(electron, /thumbnailSize:\{width:640,height:360\}/);
});

test('Start meeting hub remains role-aware and hides management shortcuts from technicians', () => {
  const dashboard = read('src/pages/Dashboard.tsx');
  const card = read('src/components/NextMeetingCard.tsx');

  assert.match(dashboard, /role=\{role\}/);
  assert.match(card, /role === 'OWNER' \|\| role === 'BOSS' \|\| role === 'COORDINATOR'/);
  assert.match(card, /Brak zaplanowanych szkoleń/);
  assert.match(card, /Aktywne spotkanie/);
  assert.doesNotMatch(card, /Oglądaj historię/);
  assert.doesNotMatch(card, /Planuj szkolenia/);
});

test('1.0.3.22 product and updater versions stay aligned', () => {
  assert.equal(read('RELEASE_VERSION').trim(), '1.0.3.22');
  assert.equal(read('BUILD_VERSION').trim(), '1.3.22');
  assert.equal(JSON.parse(read('package.json')).version, '1.3.22');
  assert.match(read('electron/appConfig.ts'), /productVersion: '1\.0\.3\.22'/);
});
