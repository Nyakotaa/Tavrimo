import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../sync-service/server.mjs', import.meta.url), 'utf8');

assert.match(server, /window\.__tavrimoBlobUrls/);
assert.match(server, /a\[download\]/);
assert.match(server, /performance\.getEntriesByType\('resource'\)/);
assert.match(server, /function parseScheduleText\(/);
assert.match(server, /function scheduleEventsToIcs\(/);
assert.match(server, /BEGIN:VCALENDAR/);
assert.match(server, /Практическое занятие/);

const sample = `
15.14д-ГГ04/266 Расписание занятий ПОНЕДЕЛЬНИК, 28.09.2026
1 пара 08:30 10:00 Физическая культура и спорт Лекция 2 корпус - 137, пл. Основная
2 пара 10:10 11:40 Экономическая теория Практическое занятие 4 корпус - 302, пл. Основная
ВТОРНИК, 29.09.2026
3 пара 11:50 13:20 Теория государства и права Практическое занятие 4 корпус - 103, пл. Основная
`;

const dayHeader = /(ПОНЕДЕЛЬНИК|ВТОРНИК|СРЕДА|ЧЕТВЕРГ|ПЯТНИЦА|СУББОТА|ВОСКРЕСЕНЬЕ)\s*,?\s*(\d{1,2}\.\d{1,2}\.\d{4})/gi;
const periodPattern = /(\d{1,2})\s*пара\s+(\d{1,2}:\d{2})\s*(?:[-–—]\s*)?(\d{1,2}:\d{2})\s+([\s\S]*?)(?=\s+\d{1,2}\s*пара\s+\d{1,2}:\d{2}|\s+(?:ПОНЕДЕЛЬНИК|ВТОРНИК|СРЕДА|ЧЕТВЕРГ|ПЯТНИЦА|СУББОТА|ВОСКРЕСЕНЬЕ)\s*,?\s*\d{1,2}\.\d{1,2}\.\d{4}|$)/gi;
const normalized = sample.replace(/\s+/g, ' ').trim();
const headers = [...normalized.matchAll(dayHeader)];
assert.equal(headers.length, 2);
let parsed = 0;
for (let i = 0; i < headers.length; i += 1) {
  const start = headers[i].index + headers[i][0].length;
  const end = i + 1 < headers.length ? headers[i + 1].index : normalized.length;
  const section = normalized.slice(start, end);
  parsed += [...section.matchAll(periodPattern)].length;
}
assert.equal(parsed, 3);
assert.match(server, /current portal renders the timetable in the page itself/i);
console.log('REA fallback parser static tests passed.');
