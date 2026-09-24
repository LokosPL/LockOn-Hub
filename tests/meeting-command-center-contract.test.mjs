import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('1.0.2.22 keeps meeting collaboration visible outside the room without leaking browser WebContentsView', () => {
  const app = read('src/App.tsx');
  const dock = read('src/components/MeetingActivityDock.tsx');
  const browser = read('src/pages/BrowserPage.tsx');

  assert.match(app, /<MeetingActivityDock/);
  assert.match(app, /meetingDockExpanded/);
  assert.match(app, /active === 'browser' && !helpOpen && !meetingDockExpanded/);
  assert.match(dock, /meetings\.chat\(meeting\.id\)/);
  assert.match(dock, /meetings\.hands\(meeting\.id\)/);
  assert.match(dock, /meetings\.sendChat\(meeting\.id/);
  assert.match(dock, /onExpandedChange/);
  assert.doesNotMatch(dock, /setVisible\(true\)/);
  assert.doesNotMatch(browser, /setVisible\(true\)/);
});

test('1.0.2.22 shows no fake self screen until the user actually shares', () => {
  const room = read('src/components/MeetingRoom.tsx');

  assert.match(room, /useState<'empty'\|'self'\|'remote'>\('empty'\)/);
  assert.match(room, /Nikt nie udostępnia ekranu/);
  assert.match(room, /screenEnabled && \(/);
  assert.match(room, /setStageView\('self'\)/);
  assert.match(room, /setStageView\('remote'\)/);
  assert.match(room, /remotePreviewHostRef/);
  assert.doesNotMatch(room, /refreshLocalDesktopPreview/);
  assert.doesNotMatch(room, /localDesktopPreview/);
});

test('1.0.2.22 prioritizes readable Full HD screen sharing', () => {
  const room = read('src/components/MeetingRoom.tsx');
  const electron = read('electron/main.ts');

  assert.match(room, /adaptiveStream:false/);
  assert.match(room, /dynacast:false/);
  assert.match(room, /maxWidth:3840/);
  assert.match(room, /maxHeight:2160/);
  assert.match(room, /simulcast:false/);
  assert.match(room, /screenShareEncoding:\{/);
  assert.match(room, /maxBitrate:8_000_000/);
  assert.match(room, /degradationPreference:'maintain-resolution'/);
  assert.match(electron, /thumbnailSize:\{width:640,height:360\}/);
});

test('Start meeting hub is role-aware and no longer exposes management action tiles to technicians', () => {
  const dashboard = read('src/pages/Dashboard.tsx');
  const card = read('src/components/NextMeetingCard.tsx');

  assert.match(dashboard, /role=\{role\}/);
  assert.match(card, /role === 'OWNER' \|\| role === 'BOSS' \|\| role === 'COORDINATOR'/);
  assert.match(card, /Brak zaplanowanych szkoleń/);
  assert.match(card, /Aktywne spotkanie/);
  assert.doesNotMatch(card, /Oglądaj historię/);
  assert.doesNotMatch(card, /Planuj szkolenia/);
});

test('Start layout receives the selected UI scale', () => {
  const preferences = read('src/uiPreferences.ts');
  const styles = read('src/styles.css');

  assert.match(preferences, /document\.documentElement\.dataset\.scale = scale/);
  assert.match(styles, /:root\[data-scale="compact"\] \.dashboard-start/);
  assert.match(styles, /\.start-meeting-hub-unified/);
});

test('1.0.2.22 product and updater versions stay aligned', () => {
  assert.equal(read('RELEASE_VERSION').trim(), '1.0.2.22');
  assert.equal(read('BUILD_VERSION').trim(), '1.2.22');
  assert.equal(JSON.parse(read('package.json')).version, '1.2.22');
  assert.match(read('electron/appConfig.ts'), /productVersion: '1\.0\.2\.22'/);
});
