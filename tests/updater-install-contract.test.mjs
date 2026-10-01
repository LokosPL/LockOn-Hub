import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const updaterSource = fs.readFileSync(new URL('../electron/updater.ts', import.meta.url), 'utf8');
const installerSource = fs.readFileSync(new URL('../build/installer.nsh', import.meta.url), 'utf8');

test('Windows updater uses one-click per-user NSIS', () => {
  assert.equal(packageJson.build?.nsis?.oneClick, true);
  assert.equal(packageJson.build?.nsis?.perMachine, false);
  assert.equal(packageJson.build?.nsis?.allowToChangeInstallationDirectory, false);
});

test('updates install only from the explicit install action', () => {
  assert.match(updaterSource, /autoUpdater\.autoInstallOnAppQuit\s*=\s*false/);
  assert.match(updaterSource, /autoUpdater\.quitAndInstall\(true, true\)/);
  assert.match(updaterSource, /installDirectory\s*=\s*\n?\s*path\.dirname\(process\.execPath\)/);
});

test('custom NSIS include does not override updater silent mode', () => {
  assert.doesNotMatch(installerSource, /SetSilent\s+silent/);
});
