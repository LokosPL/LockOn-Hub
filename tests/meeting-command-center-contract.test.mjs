import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('1.0.1.22 keeps meeting collaboration visible outside the room', () => {
  const app = read('src/App.tsx');
  const dock = read('src/components/MeetingActivityDock.tsx');

  assert.match(app, /<MeetingActivityDock/);
  assert.match(dock, /meetings\.chat\(meeting\.id\)/);
  assert.match(dock, /meetings\.hands\(meeting\.id\)/);
  assert.match(dock, /meetings\.sendChat\(meeting\.id/);
  assert.match(dock, /Podniesione ręce/);
  assert.match(dock, /Wróć do spotkania/);
});

test('1.0.1.22 meeting room exposes a switchable self and remote screen stage', () => {
  const room = read('src/components/MeetingRoom.tsx');

  assert.match(room, /stageView/);
  assert.match(room, /refreshLocalDesktopPreview/);
  assert.match(room, /localDesktopPreview/);
  assert.match(room, /remotePreviewHostRef/);
  assert.match(room, /Kliknij, aby otworzyć na głównym ekranie/);
  assert.match(room, /setStageView\('self'\)/);
  assert.match(room, /setStageView\('remote'\)/);
});

test('Start layout receives the selected UI scale', () => {
  const preferences = read('src/uiPreferences.ts');
  const styles = read('src/styles.css');

  assert.match(preferences, /document\.documentElement\.dataset\.scale = scale/);
  assert.match(styles, /:root\[data-scale="compact"\] \.dashboard-start/);
  assert.match(styles, /\.start-meeting-hub/);
});

test('1.0.1.22 product and updater versions stay aligned', () => {
  assert.equal(read('RELEASE_VERSION').trim(), '1.0.1.22');
  assert.equal(read('BUILD_VERSION').trim(), '1.1.22');
  assert.equal(JSON.parse(read('package.json')).version, '1.1.22');
  assert.match(read('electron/appConfig.ts'), /productVersion: '1\.0\.1\.22'/);
});
