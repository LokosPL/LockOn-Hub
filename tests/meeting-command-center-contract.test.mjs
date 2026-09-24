import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('1.0.4.22 keeps the live room mounted while navigating through ServiceOS', () => {
  const app = read('src/App.tsx');
  const room = read('src/components/MeetingRoom.tsx');
  const state = read('src/meetingLiveState.ts');

  assert.match(app, /persistent-meetings-host/);
  assert.match(app, /active === 'meetings' \? 'active' : 'background'/);
  assert.match(room, /publishMeetingLiveState/);
  assert.match(state, /lockon:meeting-live-state/);
});

test('1.0.4.22 browser remains interactive beside a live meeting', () => {
  const app = read('src/App.tsx');
  const browser = read('src/pages/BrowserPage.tsx');
  const styles = read('src/styles.css');

  assert.match(app, /active === 'browser' && !helpOpen/);
  assert.match(app, /BrowserPage meetingDockExpanded=\{meetingDockExpanded\}/);
  assert.match(browser, /meeting-dock-open/);
  assert.match(styles, /browser-page\.meeting-dock-open \.browser-host-frame/);
});

test('1.0.4.22 exposes a persistent host-only broadcast overlay for screen and window sharing', () => {
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
});

test('1.0.4.22 theater mode maximizes the stage and keeps collaboration visible', () => {
  const room = read('src/components/MeetingRoom.tsx');
  const styles = read('src/styles.css');

  assert.match(room, /theaterMode/);
  assert.match(room, /Tryb kinowy/);
  assert.match(room, /Widok standardowy/);
  assert.match(room, /setSideTab\('chat'\)/);
  assert.match(room, /event\.key === 'Escape'/);
  assert.match(room, /onDoubleClick=\{toggleTheaterMode\}/);
  assert.match(styles, /meeting-room-panel\.theater-mode/);
  assert.match(styles, /grid-template-columns:minmax\(0,1fr\) 350px/);
});

test('1.0.4.22 removes duplicate local stream tile and keeps only remote-share thumbnails', () => {
  const room = read('src/components/MeetingRoom.tsx');

  assert.doesNotMatch(room, /Twoja transmisja/);
  assert.match(room, /Udostępniane ekrany uczestników/);
  assert.match(room, /Wróć do swojej transmisji/);
  assert.match(room, /meeting-broadcast-strip/);
});

test('1.0.4.22 keeps clean self-share stage and explicit local preview', () => {
  const room = read('src/components/MeetingRoom.tsx');

  assert.match(room, /showSelfPreview/);
  assert.match(room, /TRANSMISJA AKTYWNA/);
  assert.match(room, /Lokalny podgląd jest domyślnie ukryty/);
  assert.match(room, /Pokaż lokalny podgląd/);
  assert.match(room, /Nikt nie udostępnia ekranu/);
});

test('1.0.4.22 retains high-resolution screen share and low-latency speech', () => {
  const room = read('src/components/MeetingRoom.tsx');
  const electron = read('electron/main.ts');

  assert.match(room, /maxWidth:3840/);
  assert.match(room, /maxHeight:2160/);
  assert.match(room, /maxFrameRate:60/);
  assert.match(room, /contentHint = 'detail'/);
  assert.match(room, /maxBitrate:12_000_000/);
  assert.match(room, /maxFramerate:60/);
  assert.match(room, /degradationPreference:'maintain-resolution'/);
  assert.match(room, /sampleRate:48_000/);
  assert.match(room, /stopMicTrackOnMute:false/);
  assert.match(room, /red:true/);
  assert.match(electron, /backgroundThrottling: false/);
});

test('1.0.4.22 product and updater versions stay aligned', () => {
  assert.equal(read('RELEASE_VERSION').trim(), '1.0.4.22');
  assert.equal(read('BUILD_VERSION').trim(), '1.4.22');
  assert.equal(JSON.parse(read('package.json')).version, '1.4.22');
  assert.match(read('electron/appConfig.ts'), /productVersion: '1\.0\.4\.22'/);
});
