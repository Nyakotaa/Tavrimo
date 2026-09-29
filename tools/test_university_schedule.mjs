import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = ('globalThis.__TAVRIMO_QA__ = true;\n' + fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8')).replace('  boot();\n})();', '  // boot disabled for tests\n})();');
const storage = Object.create(null);
const dummyClassList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
const dummyStyle = { setProperty() {} };
const dummyElement = new Proxy({ classList: dummyClassList, style: dummyStyle, dataset: {}, hidden: false, value: '', checked: false, disabled: false, textContent: '', innerHTML: '', setAttribute() {}, focus() {}, addEventListener() {} }, { get: (target, prop) => target[prop] });
const context = {
  console, crypto: { randomUUID: () => 'test-id' },
  localStorage: { getItem: (key) => storage[key] ?? null, setItem: (key, value) => { storage[key] = String(value); }, removeItem: (key) => { delete storage[key]; } },
  Intl, Date, Math, Number, String, JSON, Array, Object, Set, RegExp, Blob, File, URL,
  isNaN, parseInt, parseFloat,
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  document: { documentElement: { dataset: {} }, body: { classList: dummyClassList }, querySelector: () => dummyElement, querySelectorAll: () => [] },
  setTimeout, clearTimeout, setInterval, clearInterval,
};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: 'app.js' });
const t = context.__TAVRIMO_TEST__;
assert.ok(t, 'QA hooks must be available');

const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:РЭУ · группа 24.03-ЭК-12\r\nBEGIN:VEVENT\r\nUID:a@rea\r\nDTSTART;TZID=Europe/Moscow:20261001T081500\r\nDTEND;TZID=Europe/Moscow:20261001T094500\r\nSUMMARY:Микроэкономика (Лекция)\r\nLOCATION:1 корпус, 312 ауд.\r\nDESCRIPTION:Преподаватель: Иванов Иван Иванович\\nЛекция\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:b@rea\r\nDTSTART;TZID=Europe/Moscow:20261001T095500\r\nDTEND;TZID=Europe/Moscow:20261001T112500\r\nSUMMARY:Математика\r\nLOCATION:3.14\r\nDESCRIPTION:Преподаватель — Петрова Анна Петровна\r\nCATEGORIES:Практическое занятие\r\nEND:VEVENT\r\nEND:VCALENDAR`;
const parsed = t.parseUniversityIcs(ics);
assert.equal(parsed.events.length, 2);
assert.equal(parsed.calendarName, 'РЭУ · группа 24.03-ЭК-12');
assert.equal(JSON.stringify(parsed.events[0]), JSON.stringify({ uid: 'a@rea', date: '2026-10-01', start: '08:15', end: '09:45', subject: 'Микроэкономика', type: 'Лекция', teacher: 'Иванов Иван Иванович', room: '1 корпус, 312 ауд.', note: 'Преподаватель: Иванов Иван Иванович\nЛекция' }));
assert.equal(parsed.events[1].type, 'Практическое занятие');
assert.equal(t.extractGroupCode(parsed.calendarName), '24.03-ЭК-12');

const base = { version: 14, settings: { workStart: 8, workEnd: 18, lunchStart: 13, lunchEnd: 14, buffer: 10, focusLength: 25, weekends: false, theme: 'system' }, tasks: [], focus: { totalMinutes: 0, sessions: [] }, university: { groupCode: '24.03-ЭК-12', groupName: '24.03-ЭК-12', importedAt: new Date().toISOString(), source: 'rasp.rea.ru', events: parsed.events } };
t.setData(base);
t.setCurrentDate(new Date(2026, 8, 27));

assert.match(t.validateManualSlot({ id: 'task-1', title: 'Подготовить семинар', duration: 60, priority: 2, deadline: '2026-10-01', deadlineTime: '17:00' }, '2026-10-01', '08:15', 30), /^В это время пара/);
assert.match(t.validateManualSlot({ id: 'task-1', title: 'Подготовить семинар', duration: 60, priority: 2, deadline: '2026-10-01', deadlineTime: '17:00' }, '2026-10-01', '09:45', 30), /^В это время пара/);
assert.equal(t.validateManualSlot({ id: 'task-1', title: 'Подготовить семинар', duration: 60, priority: 2, deadline: '2026-10-01', deadlineTime: '17:00' }, '2026-10-01', '11:30', 30), '');
assert.equal(t.validateManualSlot({ id: 'task-1', title: 'Подготовить семинар', duration: 60, priority: 2, deadline: '2026-10-01', deadlineTime: '17:00' }, '2026-10-01', '12:30', 30), 'Резерв после задачи пересекает перерыв.');
assert.equal(t.validateManualSlot({ id: 'task-1', title: 'Подготовить семинар', duration: 60, priority: 2, deadline: '2026-10-01', deadlineTime: '17:00' }, '2026-10-01', '14:00', 30), '');

const normalized = t.normalizeUniversity(base.university);
const reordered = t.normalizeUniversity({ ...base.university, events: [...parsed.events].reverse() });
const firstId = normalized.events.find((event) => event.uid === 'a@rea')?.id;
const reorderedId = reordered.events.find((event) => event.uid === 'a@rea')?.id;
assert.ok(firstId && firstId === reorderedId, 'University event IDs must be stable across reorder/reimport');
assert.equal(new Set(normalized.events.map((event) => event.id)).size, normalized.events.length, 'University event IDs must be unique');
const deduped = t.normalizeUniversity({ ...base.university, events: [parsed.events[0], parsed.events[0]] });
assert.equal(deduped.events.length, 1, 'Duplicate university events should be removed');

const customEvents = [{ id: 'custom', uid: 'custom', date: '2026-10-05', start: '10:00', end: '11:00', subject: 'Custom', type: 'Лекция', teacher: '', room: '' }];
assert.equal(t.universityEventsForDate('2026-10-05', customEvents).length, 1, 'universityEventsForDate must respect passed events');
assert.equal(t.universityEventsForDate('2026-10-06', customEvents).length, 0);

const utc = t.parseIcsDateTime('20261001T211500Z');
assert.equal(JSON.stringify(utc), JSON.stringify({ date: '2026-10-02', time: '00:15' }), 'UTC export must be normalized to Moscow time');
const allDay = t.parseUniversityIcs(`BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:day\nDTSTART;VALUE=DATE:20261001\nDTEND;VALUE=DATE:20261002\nSUMMARY:All day\nEND:VEVENT\nEND:VCALENDAR`);
assert.equal(allDay.events.length, 0, 'All-day events should not become fake lectures');

const loaded = t.normalizeData({ ...base, tasks: [{ id: 'linked', title: 'Подготовиться', duration: 30, priority: 2, deadline: '2026-10-01', linkedUniversityEventId: firstId, scheduledDate: '2026-10-01', scheduledStart: '11:30', locked: true }] });
assert.equal(loaded.tasks[0].linkedUniversityEventId, firstId, 'Task link must survive normalization');
const unlinked = t.normalizeData({ ...base, university: { ...base.university, events: [] }, tasks: [{ id: 'linked', title: 'Подготовиться', duration: 30, priority: 2, deadline: '2026-10-01', linkedUniversityEventId: firstId }] });
assert.equal(unlinked.tasks[0].linkedUniversityEventId, null, 'Task link to missing class must be cleared');

const load = t.dayLoad('2026-10-01');
assert.equal(load.classWork, 180, 'University class minutes must be part of day load');
assert.equal(load.occupied, 180 + 10 * load.tasks.length + load.work, 'Day occupied minutes must include classes, task work and reserve');
const agenda = t.getAgendaItemsForDate('2026-10-01');
assert.equal(agenda[0].kind, 'class', 'Agenda must merge university classes with tasks');
assert.equal(t.getNextAgendaItem('2026-10-01')?.kind, 'class', 'Next agenda item should see university classes');

const withConflict = t.normalizeData({ ...base, tasks: [{ id: 'task-2', title: 'Конфликт', duration: 60, priority: 2, deadline: '2026-10-01', deadlineTime: '17:00', scheduledDate: '2026-10-01', scheduledStart: '08:15', locked: true }] });
assert.equal(withConflict.tasks[0].scheduledDate, null, 'REA timetable conflict must move task to inbox');
assert.equal(withConflict.tasks[0].locked, false);

console.log('University schedule tests passed.');
