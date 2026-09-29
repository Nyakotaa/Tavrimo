import fs from 'node:fs';
import assert from 'node:assert/strict';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const config = fs.readFileSync(new URL('../config.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../sync-service/server.mjs', import.meta.url), 'utf8');

assert.match(app, /syncUniversitySchedule\(\{ silent: true \}\)/, 'App must sync on foreground/resume');
assert.match(app, /syncIntervalMinutes \\|\\| 15/, 'App default sync interval should be 15 minutes');
assert.match(app, /If-None-Match/, 'App must use conditional requests for schedule sync');
assert.match(app, /response\.status === 304/, 'App must handle 304 Not Modified');
assert.match(app, /последнее известное расписание/i, 'App should avoid wiping a known schedule on an empty remote result');
assert.match(sw, /api\//, 'Service Worker must treat API separately from cached app shell');
assert.match(config, /syncEndpoint: '\/api\/rea\/schedule'/, 'Default same-origin sync endpoint missing');
assert.match(config, /syncIntervalMinutes: 15/, 'Config sync interval missing');
assert.match(app, /function syncConfigNumber\(/, 'Config number helper missing for invalid runtime config values');
assert.match(server, /Access-Control-Allow-Origin/, 'Gateway must allow cross-origin PWA requests');
assert.match(server, /If-None-Match/, 'Gateway must support conditional requests');
assert.match(server, /app\.use\(\(req, res\) =>/, 'Gateway SPA fallback must be Express-5 compatible');
assert.doesNotMatch(server, /app\.get\('\*'/, 'Gateway must not use Express-4 wildcard syntax');
assert.match(server, /rasp\.rea\.ru/, 'Gateway must use official REA portal as upstream');
console.log('Live sync static tests passed.');
