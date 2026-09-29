import fs from 'node:fs';
import assert from 'node:assert/strict';
const root = new URL('..', import.meta.url);
const version = fs.readFileSync(new URL('./VERSION', root), 'utf8').trim();
assert.equal(version, '12.0.3');
const sw = fs.readFileSync(new URL('./sw.js', root), 'utf8');
assert.match(sw, /tavrimo-v12\.0\.3-rea-live-sync-3/);
const server = fs.readFileSync(new URL('./sync-service/server.mjs', root), 'utf8');
for (const pattern of [
  /extractClientGeneratedCalendar/,/discoverCalendarUrls/,/parseScheduleText/,/scheduleEventsToIcs/,
  /__tavrimoBlobUrls/,/__tavrimoDownloads/,/performance\.getEntriesByType\('resource'\)/,
  /Портал РЭУ открыл расписание, но календарь не выгружается и расписание не удалось разобрать/
]) assert.match(server, pattern);
console.log('Tavrimo 12.0.3 release checks passed.');
