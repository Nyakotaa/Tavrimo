import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = ('globalThis.__TAVRIMO_QA__ = true;\n' + fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8')).replace('  boot();\n})();', '  // boot disabled for migration tests\n})();');
const classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
const makeElement = () => new Proxy({
  classList, style: { setProperty() {} }, dataset: {}, hidden: false, value: '', checked: false,
  disabled: false, textContent: '', innerHTML: '', setAttribute() {}, removeAttribute() {},
  addEventListener() {}, focus() {}, click() {}, scrollIntoView() {}, options: []
}, { get(target, key) { return key in target ? target[key] : undefined; }, set(target, key, value) { target[key] = value; return true; } });
const elements = new Map();
const getElement = selector => { if (!elements.has(selector)) elements.set(selector, makeElement()); return elements.get(selector); };
const storage = Object.create(null);
const context = {
  console, crypto: { randomUUID: () => 'migration-test-id' },
  localStorage: { getItem: key => storage[key] ?? null, setItem: (key, value) => { storage[key] = String(value); }, removeItem: key => { delete storage[key]; } },
  Intl, Date, Math, Number, String, JSON, Array, Object, Set, Map, RegExp, Blob, URL, Promise, Error, TypeError,
  isNaN, parseInt, parseFloat,
  document: { documentElement: { dataset: {} }, body: { classList }, querySelector: getElement, querySelectorAll: () => [], addEventListener() {}, createElement: () => makeElement() },
  window: { location: { href: 'https://example.test/Tavrimo/' }, addEventListener() {} },
  navigator: { onLine: false }, setTimeout, clearTimeout, setInterval, clearInterval, confirm: () => true
};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: 'app.js' });
const qa = context.__TAVRIMO_TEST__;
assert.ok(qa, 'QA hooks must be exposed');

function futureWeekdayKey(offset = 14) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}
const day = futureWeekdayKey();
const day2Date = new Date(day + 'T12:00:00');
day2Date.setDate(day2Date.getDate() + 1);
const day2 = [day2Date.getFullYear(), String(day2Date.getMonth() + 1).padStart(2, '0'), String(day2Date.getDate()).padStart(2, '0')].join('-');
const legacyEvents = [
  { id: 'rea-class-001', uid: 'rea-uid-001', date: day, start: '09:00', end: '10:30', subject: 'Логистика', type: 'Лекция', teacher: 'Иванов И. И.', room: '204', note: 'Корпус 2' },
  { id: 'rea-class-002', uid: 'rea-uid-002', date: day2, start: '11:00', end: '12:30', subject: 'Экономика', type: 'Практика', teacher: 'Петров П. П.', room: '401', note: '' }
];
const feedEvent = { id: 'google-snapshot-001', uid: 'google-uid-001', date: day, start: '14:00', end: '15:00', subject: 'Личная встреча', type: 'Внешний календарь', teacher: '', room: '', note: '', allDay: false, transparent: false };
const raw = {
  version: 17,
  settings: { workStart: 8, workEnd: 19, lunchStart: 13, lunchEnd: 14, buffer: 10, focusLength: 50, weekends: false, theme: 'dark', displayName: 'Даниил' },
  tasks: [{ id: 'task-linked', title: 'Подготовиться к логистике', duration: 30, priority: 3, category: 'Учёба', linkedUniversityEventId: 'rea-class-001', done: false }],
  focus: { totalMinutes: 45, sessions: [{ date: day, taskId: 'task-linked', minutes: 45, completedAt: new Date().toISOString() }] },
  university: { groupCode: '15.14Д-ГГ04/266', groupName: '15.14Д-ГГ04/266', importedAt: new Date().toISOString(), events: legacyEvents },
  externalCalendars: [{ id: 'legacy-google-feed', name: 'Google personal', provider: 'google', sourceType: 'feed', feedUrl: 'https://calendar.google.com/calendar/ical/private/basic.ics', enabled: true, color: '#539df5', events: [feedEvent] }],
  profile: { avatarDataUrl: 'data:image/jpeg;base64,AA==' }
};

const normalized = qa.normalizeData(raw);
assert.equal(raw.university.events.length, 2, 'Migration must not mutate the original object');
assert.equal(normalized.university.events.length, 0, 'Legacy university events must leave the separate collection');
const localCalendar = normalized.externalCalendars.find(calendar => calendar.id === 'legacy-rea-schedule');
assert.ok(localCalendar, 'A local calendar for former REA events must exist');
assert.equal(localCalendar.sourceType, 'file');
assert.equal(localCalendar.feedUrl, '');
assert.equal(localCalendar.events.length, 2);
assert.deepEqual(Array.from(localCalendar.events.map(event => event.id)), ['rea-class-001', 'rea-class-002']);
assert.equal(localCalendar.events[0].teacher, 'Иванов И. И.');
assert.equal(localCalendar.events[0].room, '204');
assert.equal(normalized.tasks[0].id, 'task-linked');
assert.equal(normalized.tasks[0].linkedUniversityEventId, 'rea-class-001', 'Task-to-event link must retain its original ID');
assert.equal(normalized.settings.displayName, 'Даниил');
assert.equal(normalized.profile.avatarDataUrl, 'data:image/jpeg;base64,AA==');
assert.equal(normalized.focus.totalMinutes, 45);
assert.equal(normalized.externalCalendars.find(calendar => calendar.id === 'legacy-google-feed').events[0].id, 'google-snapshot-001');
assert.equal(normalized.externalCalendars.find(calendar => calendar.id === 'legacy-google-feed').feedUrl, '');
assert.equal(normalized.externalCalendars.find(calendar => calendar.id === 'legacy-google-feed').sourceType, 'file');

qa.setData(raw);
assert.equal(qa.anyCalendarEventById('rea-class-001')?.id, 'rea-class-001');
assert.equal(qa.allCalendarEventsForDate(day).length, 2, 'Former REA and feed events must appear together');
assert.equal(qa.calendarConflict(day, 540, 600)?.id, 'rea-class-001', 'Former REA events must still block manual slots');
assert.match(qa.validateManualSlot({ id: 'new-task', deadline: null }, day, '09:00', 30), /занято: Логистика/);

const repeated = qa.normalizeData(normalized);
const countAfterFirstPass = normalized.externalCalendars.reduce((sum, calendar) => sum + calendar.events.length, 0);
const countAfterSecondPass = repeated.externalCalendars.reduce((sum, calendar) => sum + calendar.events.length, 0);
assert.equal(countAfterSecondPass, countAfterFirstPass, 'Migration must be idempotent');
assert.equal(repeated.tasks[0].linkedUniversityEventId, 'rea-class-001');

const backupRoundTrip = qa.parseBackupData(JSON.stringify(normalized));
assert.equal(backupRoundTrip.externalCalendars.reduce((sum, calendar) => sum + calendar.events.length, 0), countAfterFirstPass);
assert.equal(backupRoundTrip.tasks[0].linkedUniversityEventId, 'rea-class-001');
assert.equal(backupRoundTrip.profile.avatarDataUrl, normalized.profile.avatarDataUrl);

const collision = structuredClone(raw);
collision.externalCalendars.push({ id: 'other-calendar', name: 'Other', provider: 'ics', sourceType: 'file', events: [{ ...feedEvent, id: 'rea-class-001', subject: 'Different event' }] });
assert.throws(() => qa.migrateCalendarData(collision), /ID старого события/);

console.log('Tavrimo 12.4.0 data migration tests passed.');
