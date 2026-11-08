import fs from 'node:fs';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');
const server = read('sync-service/server.mjs');
const index = read('index.html');
const sw = read('sw.js');
const app = read('app.js');
const changelog = read('CHANGELOG.md');
const manifest = JSON.parse(read('RELEASE_MANIFEST.json'));
const packageJson = JSON.parse(read('sync-service/package.json'));
const search = server.slice(server.indexOf('async function searchForGroup(page, group) {'), server.indexOf('async function downloadOfficialIcs(group)'));

assert.ok(search.indexOf('await selectGroupTab(page)') < search.indexOf('if (await tryDirectGroupUrl(page, group))'), 'visible portal search should precede direct ?q= fallback');
assert.ok(search.includes("await page.goto(UPSTREAM, { waitUntil: 'domcontentloaded', timeout: 45_000 })"), 'reload canonical portal URL when search field is missing');
assert.ok(search.includes('input[placeholder*="Введите номер группы" i]'), 'support the official portal placeholder');
assert.ok(search.includes('REA_SEARCH_INPUT_MISSING'), 'log actionable search diagnostics');
assert.ok(server.includes('За всё время'), 'keep all-time ICS export flow');
assert.ok(server.includes('[REA_RENDERED_WEEK_FALLBACK]'), 'keep current rendered-week fallback diagnostics');
assert.ok(index.includes('app.js?v=12.0.10') && index.includes('style.css?v=12.0.10') && index.includes('config.js?v=12.0.10'), 'asset cache busting');
assert.ok(sw.includes('tavrimo-v12.0.10-rea-sync-ci-fix'), 'service worker cache version');
assert.ok(app.includes("const APP_VERSION = '12.0.10'"), 'app version');
assert.equal(manifest.version, '12.0.10', 'release manifest version');
assert.equal(packageJson.version, '1.0.10', 'sync gateway package version');
assert.ok(changelog.startsWith('## 12.0.10'), 'release notes');
console.log('Tavrimo 12.0.10 REA sync + CI regression tests: PASS');
