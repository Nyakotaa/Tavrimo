import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app.js');
const html = read('../index.html');
const sw = read('../sw.js');
const manifest = JSON.parse(read('../RELEASE_MANIFEST.json'));
const versionFile = read('../VERSION').trim();

const appVersion = app.match(/const APP_VERSION = '([^']+)'/)?.[1];
assert.ok(appVersion, 'APP_VERSION must be declared in app.js');
assert.equal(versionFile, appVersion, 'VERSION must match app.js');
assert.equal(manifest.version, appVersion, 'Release manifest version must match app.js');
assert.equal(manifest.release, appVersion, 'Release manifest release must match app.js');
assert.ok(html.includes(`id="appVersionLabel">v${appVersion}</span>`), 'Visible app version must match app.js');

for (const resource of ['app.js', 'style.css', 'config.js']) {
  assert.ok(html.includes(`${resource}?v=${appVersion}`), `${resource} cache-busting version must match app.js`);
}

assert.ok(sw.includes(`tavrimo-v${appVersion}-`), 'Service Worker cache must include current app version');

const allIds = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(allIds.length, new Set(allIds).size, 'HTML must not contain duplicate IDs');

console.log(`Release version consistency checks passed (${appVersion}).`);
