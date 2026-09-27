import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = (`globalThis.__FLOWDAY_QA__ = true;\n` + fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8')).replace('  boot();\n})();', '})();');
const storage = Object.create(null);
const dummyClassList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
const dummyStyle = { setProperty() {} };
const dummyElement = new Proxy({ classList: dummyClassList, style: dummyStyle, dataset: {}, hidden: false, value: '', checked: false, disabled: false, textContent: '', innerHTML: '', setAttribute() {}, focus() {} }, { get: (target, prop) => target[prop] });
const context = {
  console,
  crypto: { randomUUID: () => 'test-id' },
  localStorage: { getItem: (key) => storage[key] ?? null, setItem: (key, value) => { storage[key] = String(value); }, removeItem: (key) => { delete storage[key]; } },
  Intl, Date, Math, Number, String, JSON, Array, Object, Set, RegExp, Blob, File, URL,
  isNaN, parseInt, parseFloat,
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  document: { documentElement: { dataset: {} }, body: { classList: dummyClassList }, querySelector: () => dummyElement, querySelectorAll: () => [] },
  setTimeout, clearTimeout, setInterval, clearInterval,
};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: 'app.js' });
const t = context.__FLOWDAY_TEST__;
assert.ok(t, 'QA hooks must be available');

const base = {
  version: 8,
  settings: { workStart: 9, workEnd: 18, lunchStart: 13, lunchEnd: 14, buffer: 0, focusLength: 25, weekends: false, theme: 'system' },
  tasks: [], focus: { totalMinutes: 0, sessions: [] },
};

const monday = new Date(2026, 8, 28, 12);
const mondayKey = '2026-09-28';
t.setData(base);
t.setCurrentDate(monday);

// Core slot search / deadline.
const task = { id: 'a', title: 'A', duration: 120, priority: 3, deadline: mondayKey, deadlineTime: '12:00', scheduledDate: null, scheduledStart: null, locked: false, done: false };
let slot = t.findSlot(task, monday, {});
assert.equal(slot.date, mondayKey);
assert.equal(slot.start, 540);

const shortTask = { ...task, duration: 45 };
slot = t.findSlot(shortTask, monday, { [mondayKey]: [{ s: 540, e: 670 }] });
assert.equal(slot.date, mondayKey);
assert.equal(slot.start, 675);
assert.equal(t.findSlot({ ...task, duration: 60, deadlineTime: '09:30' }, monday, {}), null);
assert.equal(t.findSlot({ ...task, deadline: null, duration: 60 }, monday, {}).start, 540);

// FD8-01: priority must not starve an earlier deadline.
const lowUrgent = { id: 'u', title: 'Urgent', duration: 60, priority: 1, deadline: mondayKey, deadlineTime: '10:00', scheduledDate: null, scheduledStart: null, locked: false, done: false, createdAt: '2026-09-27T08:00:00.000Z' };
const highLater = { id: 'h', title: 'High', duration: 60, priority: 3, deadline: mondayKey, deadlineTime: '11:00', scheduledDate: null, scheduledStart: null, locked: false, done: false, createdAt: '2026-09-27T09:00:00.000Z' };
const plannerData = { ...base, tasks: [lowUrgent, highLater] };
t.setData(plannerData);
const planned = t.autoPlanAll(false);
const afterPriority = t.getData();
assert.equal(planned.placed, 2);
assert.equal(afterPriority.tasks.find(x => x.id === 'u').scheduledStart, '09:00');
assert.equal(afterPriority.tasks.find(x => x.id === 'h').scheduledStart, '10:00');

// Priority still has meaning when it can be applied safely.
const lowSame = { ...lowUrgent, id: 'u2', deadlineTime: '11:00' };
const highSame = { ...highLater, id: 'h2', deadlineTime: '11:00' };
t.setData({ ...base, tasks: [lowSame, highSame] });
const sameResult = t.autoPlanAll(false);
const sameData = t.getData();
assert.equal(sameResult.placed, 2);
assert.equal(sameData.tasks.find(x => x.id === 'h2').scheduledStart, '09:00');

// FD8-02: manual task + reserve cannot cross lunch.
t.setData({ ...base, settings: { ...base.settings, buffer: 10 }, tasks: [] });
const manual = { ...task, id: 'm', duration: 30, deadline: mondayKey, deadlineTime: '17:00' };
assert.equal(t.validateManualSlot(manual, mondayKey, '12:30', 30), 'Резерв после задачи пересекает перерыв.');
assert.equal(t.validateManualSlot(manual, mondayKey, '12:00', 60), 'Резерв после задачи пересекает перерыв.');
assert.equal(t.validateManualSlot(manual, mondayKey, '11:45', 45), '');

// Persisted slot past its deadline is invalid.
assert.equal(t.validatePersistedSlot({ ...manual, scheduledDate: mondayKey, scheduledStart: '16:00', duration: 120 }).ok, false);

// FD8-03: imported IDs become unique.
const duplicated = t.normalizeData({ ...base, tasks: [
  { id: 'same', title: 'A', duration: 30, priority: 2, deadline: mondayKey },
  { id: 'same', title: 'B', duration: 30, priority: 2, deadline: mondayKey },
  { id: 'same-2', title: 'C', duration: 30, priority: 2, deadline: mondayKey },
] });
assert.deepEqual(duplicated.tasks.map(x => x.id), ['same', 'same-2', 'same-2-2']);

// FD8-04: invalid focus dates are dropped, not moved to today.
const invalidFocus = t.normalizeData({ ...base, focus: { sessions: [
  { date: '2026-02-31', minutes: 25 },
  { date: mondayKey, minutes: 25 },
] } });
assert.equal(invalidFocus.focus.sessions.length, 1);
assert.equal(invalidFocus.focus.sessions[0].date, mondayKey);

// FD8-05: missing deadline stays missing; label is meaningful.
const noDeadline = t.normalizeData({ ...base, tasks: [{ id: 'n', title: 'No deadline', duration: 30, priority: 2, deadline: '' }] });
assert.equal(noDeadline.tasks[0].deadline, null);
assert.equal(t.deadlineLabel(noDeadline.tasks[0]), 'Без дедлайна');

// No-deadline tasks are still auto-plannable within finite horizon.
t.setData({ ...base, tasks: [{ id: 'n', title: 'No deadline', duration: 30, priority: 2, deadline: null }] });
const ndResult = t.autoPlanAll(false);
assert.equal(ndResult.placed, 1);
assert.equal(t.getData().tasks[0].scheduledDate, mondayKey);

// FD8-06: conflicting locked slots are repaired; first manual one wins.
const conflict = t.normalizeData({ ...base, tasks: [
  { id: 'lock1', title: 'Manual A', duration: 60, priority: 2, deadline: mondayKey, scheduledDate: mondayKey, scheduledStart: '09:00', locked: true },
  { id: 'lock2', title: 'Manual B', duration: 60, priority: 2, deadline: mondayKey, scheduledDate: mondayKey, scheduledStart: '09:00', locked: true },
] });
const repairedConflict = conflict.tasks.filter(x => x.scheduledDate === mondayKey && x.scheduledStart === '09:00');
assert.equal(repairedConflict.length, 1);
assert.equal(conflict.tasks.filter(x => x.id === 'lock2')[0].locked, false);

// FD8-07: completed overdue is not labelled overdue.
assert.equal(t.deadlineLabel({ id: 'done', title: 'Done', duration: 30, priority: 2, deadline: '2020-01-01', deadlineTime: null, done: true }), 'Выполнено');

// Settings / weekends / malformed values.
t.setData(base);
assert.equal(t.workingCapacityMinutes(), 480);
assert.equal(t.isValidDateKey('2026-02-31'), false);
assert.match(t.validateManualSlot({ ...manual, id: 'bad', deadline: mondayKey }, mondayKey, '99:99', 30), /Неверное время/);
const malformed = t.normalizeData({
  settings: { workStart: 'nope', workEnd: 99, lunchStart: -4, lunchEnd: 99, buffer: 999, focusLength: 999 },
  tasks: [{ id: 1, title: 'Imported', createdAt: 123, deadline: '2026-02-31', deadlineTime: '99:99', scheduledDate: mondayKey, scheduledStart: '99:99', locked: true, duration: 60, priority: 3 }],
  focus: { sessions: [{ date: '2026-02-31', minutes: 0 }] }
});
assert.equal(malformed.settings.workStart, 9);
assert.equal(malformed.settings.workEnd, 18);
assert.equal(malformed.settings.buffer, 10);
assert.equal(typeof malformed.tasks[0].createdAt, 'string');
assert.equal(malformed.tasks[0].deadline, null);
assert.equal(malformed.tasks[0].scheduledDate, null);
assert.equal(malformed.tasks[0].scheduledStart, null);
assert.equal(malformed.focus.sessions.length, 0);

console.log('Scheduler regression tests passed.');
