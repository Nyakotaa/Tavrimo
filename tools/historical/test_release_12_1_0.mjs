import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));

assert.match(app, /const APP_VERSION = '12\.1\.0';/);
assert.match(html, /class="brand-lockup"/);
assert.match(html, /class="brand-wordmark">TAVRIMO<\/span>/);
assert.match(html, /id="headerContext"/);
assert.match(html, /class="schedule-timeline" id="todayScheduleTimeline"/);
assert.match(html, /data-view="calendar"/);
assert.match(html, /data-view="tasks"/);
assert.match(html, /id="tabAdd"/);
assert.match(html, /homeSyncBtnText/);
assert.match(css, /Campus Utility \/ Editorial Planner/);
assert.match(css, /--bg:#151A17/);
assert.match(css, /--accent:#D7ED83/);
assert.match(css, /\.brand-wordmark/);
assert.match(css, /\.home-schedule-row/);
assert.match(sw, /tavrimo-v12\.1\.0-campus-editorial/);
assert.equal(manifest.theme_color, '#151A17');
assert.equal(manifest.background_color, '#151A17');

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(ids.length, new Set(ids).size, 'Duplicate DOM id found');

console.log('Tavrimo 12.1.0 design release checks passed.');
