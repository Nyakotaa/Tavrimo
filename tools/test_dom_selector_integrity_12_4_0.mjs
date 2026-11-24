import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
const staticSelectors = [...app.matchAll(/(?<!\$)\$\(['"]#([A-Za-z0-9_-]+)['"]\)/g)].map(match => match[1]);
const dynamicHtmlIds = new Set(['onboardingNext', 'onboardingPrev']);
for (const id of staticSelectors) {
  assert.ok(ids.has(id) || dynamicHtmlIds.has(id), 'Application references missing DOM ID #' + id);
}
assert.equal(staticSelectors.filter(id => !ids.has(id) && !dynamicHtmlIds.has(id)).length, 0);
assert.doesNotMatch(app, /(?<!\$)\$\(['"][^'"]+['"]\)\s*\.\s*(?:forEach|map|filter|find|some|every|reduce|length)\b/,
  'Single-element $() must not be used as a collection');
assert.match(app, /\$\$\('\.tab\[data-view\]'\)\.forEach/);
assert.match(app, /\$\$\('\.view'\)\.forEach/);
console.log('Tavrimo 12.4.0 DOM selector integrity tests passed.');
