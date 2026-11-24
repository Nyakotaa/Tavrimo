import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = ('globalThis.__TAVRIMO_QA__ = true;\n' + fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8')).replace('  boot();\n})();', '  // boot disabled for local ICS tests\n})();');
const classList = { add() {}, remove() {}, toggle() {}, contains() {} };
const makeElement = () => new Proxy({
  classList, style: { setProperty() {} }, dataset: {}, hidden: false, value: '', checked: false,
  disabled: false, textContent: '', innerHTML: '', setAttribute() {}, removeAttribute() {}, addEventListener() {},
  focus() {}, click() {}, scrollIntoView() {}, options: []
}, { get(target, key) { return key in target ? target[key] : undefined; }, set(target, key, value) { target[key] = value; return true; } });
const elements = new Map();
const getElement = selector => { if (!elements.has(selector)) elements.set(selector, makeElement()); return elements.get(selector); };
const storage = Object.create(null);
class MockFileReader {
  readAsText(file) { this.result = file.contents; this.onload?.(); }
}
const context = {
  console, crypto: { randomUUID: () => 'local-ics-test' },
  localStorage: { getItem: key => storage[key] ?? null, setItem: (key, value) => { storage[key] = String(value); }, removeItem: key => { delete storage[key]; } },
  Intl, Date, Math, Number, String, JSON, Array, Object, Set, Map, RegExp, Blob, File, URL, AbortController, Promise, Error, TypeError,
  isNaN, parseInt, parseFloat, FileReader: MockFileReader,
  document: { baseURI: 'https://example.test/Tavrimo/', documentElement: { dataset: {} }, body: { classList }, querySelector: getElement, querySelectorAll: () => [], addEventListener() {}, createElement: () => makeElement() },
  window: { location: { href: 'https://example.test/Tavrimo/' }, addEventListener() {} },
  navigator: { onLine: false }, setTimeout, clearTimeout, setInterval, clearInterval, confirm: () => true,
  fetch: async () => { throw new Error('Local ICS import must not make a network request.'); }
};
context.globalThis = context;
vm.runInNewContext(app, context, { filename: 'app.js' });
const qa = context.__TAVRIMO_TEST__;
assert.ok(qa);

function dateKeyAfter(days) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('');
}
const start = dateKeyAfter(21);
const d = new Date(start.slice(0,4) + '-' + start.slice(4,6) + '-' + start.slice(6,8) + 'T12:00:00');
d.setDate(d.getDate() + 2);
const allDayStart = dateKeyAfter(35);
const allDayDate = new Date(allDayStart.slice(0,4) + '-' + allDayStart.slice(4,6) + '-' + allDayStart.slice(6,8) + 'T12:00:00');
allDayDate.setDate(allDayDate.getDate() + 2);
const until = [allDayDate.getFullYear(), String(allDayDate.getMonth() + 1).padStart(2, '0'), String(allDayDate.getDate()).padStart(2, '0')].join('');
const ics = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'X-WR-CALNAME:Личный календарь',
  'BEGIN:VEVENT',
  'UID:all-day-two-days',
  'DTSTART;VALUE=DATE:' + allDayStart,
  'DTEND;VALUE=DATE:' + until,
  'SUMMARY:Поездка',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:weekly-meeting',
  'DTSTART;TZID=Europe/Berlin:' + start + 'T100000',
  'DTEND;TZID=Europe/Berlin:' + start + 'T110000',
  'RRULE:FREQ=WEEKLY;COUNT=2',
  'SUMMARY:Еженедельная встреча',
  'X-TEACHER:Алексеева А. А.',
  'LOCATION:Комната 4',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');

const parsed = qa.parseExternalCalendarIcs(ics);
assert.equal(parsed.calendarName, 'Личный календарь');
assert.equal(parsed.events.filter(event => event.uid === 'all-day-two-days').length, 2, 'All-day multi-day DTEND is exclusive');
assert.equal(parsed.events.filter(event => event.uid === 'weekly-meeting').length, 2, 'Weekly recurrence is expanded');
assert.equal(parsed.events.find(event => event.uid === 'all-day-two-days').allDay, true);
assert.equal(parsed.events.find(event => event.uid === 'weekly-meeting').teacher, 'Алексеева А. А.');
assert.equal(parsed.events.find(event => event.uid === 'weekly-meeting').room, 'Комната 4');

qa.setData({ tasks: [{ id: 'keep-task', title: 'Не заменять', duration: 30, priority: 2 }], focus: { sessions: [] }, university: { events: [] }, externalCalendars: [] });
const file = { name: 'personal.ics', type: 'text/calendar', size: 2000, contents: ics };
qa.importExternalCalendarFile(file);
let data = qa.getData();
assert.equal(data.tasks[0].title, 'Не заменять', 'Calendar import must not replace tasks');
assert.equal(data.externalCalendars.length, 1);
assert.equal(data.externalCalendars[0].sourceType, 'file');
assert.equal(data.externalCalendars[0].feedUrl, '');
assert.equal(data.externalCalendars[0].events.length, 4);
const isoDate = start.slice(0,4) + '-' + start.slice(4,6) + '-' + start.slice(6,8);
assert.equal(qa.allCalendarEventsForDate(isoDate).length, 1, 'The imported recurring event appears in the single calendar view');
const weekly = data.externalCalendars[0].events.find(event => event.uid === 'weekly-meeting');
const startMinutes = Number(weekly.start.slice(0, 2)) * 60 + Number(weekly.start.slice(3));
const endMinutes = Number(weekly.end.slice(0, 2)) * 60 + Number(weekly.end.slice(3));
assert.equal(qa.calendarConflict(weekly.date, startMinutes, endMinutes)?.uid, 'weekly-meeting', 'Imported event must block conflicting manual slots');

qa.importExternalCalendarFile(file);
data = qa.getData();
assert.equal(data.externalCalendars.length, 1, 'Re-importing the same file updates rather than duplicates the source');
assert.equal(data.externalCalendars[0].events.length, 4, 'Re-importing must not duplicate events');

console.log('Tavrimo local ICS parsing and import tests passed.');
