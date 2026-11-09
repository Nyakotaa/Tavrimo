import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));

assert.match(app, /const APP_VERSION = '12\.1\.3';/);
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
assert.match(sw, /tavrimo-v12\.1\.3-static-schedule-provider/);
assert.match(app, /loadStaticScheduleSnapshot\(group/);
assert.ok(fs.existsSync(new URL('../data/schedules/manifest.json', import.meta.url)), 'Snapshot registry must ship with the app');
assert.ok(fs.existsSync(new URL('../data/schedules/rea-15-14d-gg04-266.ics', import.meta.url)), 'Real demo ICS must ship with the app');
assert.match(sw, /rea-15-14d-gg04-266\.ics\?v=vuzio-20261109-071932z-46-events/);
assert.equal(manifest.theme_color, '#151A17');
assert.equal(manifest.background_color, '#151A17');

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(ids.length, new Set(ids).size, 'Duplicate DOM id found');

console.log('Tavrimo 12.1.3 release checks passed.');
