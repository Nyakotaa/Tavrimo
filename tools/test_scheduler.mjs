import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = (`globalThis.__FLOWDAY_QA__ = true;\n` + fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8')).replace('  boot();\n})();', '})();');
const storage = Object.create(null);
const context = {
  console,
  crypto: { randomUUID: () => 'test-id' },
  localStorage: { getItem: (key) => storage[key] ?? null, setItem: (key, value) => { storage[key] = String(value); }, removeItem: (key) => { delete storage[key]; } },
  Intl, Date, Math, Number, String, JSON, Array, Object, Set, RegExp,
  isNaN, parseInt, parseFloat,
  matchMedia: () => ({ matches: false }),
};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: 'app.js' });
const t = context.__FLOWDAY_TEST__;
assert.ok(t, 'QA hooks must be available');

const base = {
  version: 8,
  settings: { workStart: 9, workEnd: 18, lunchStart: 13, lunchEnd: 14, buffer: 10, focusLength: 25, weekends: true, theme: 'system' },
  tasks: [], focus: { totalMinutes: 0, sessions: [] },
};

const monday = new Date(2026, 8, 28, 12);
const mondayKey = '2026-09-28';
t.setData(base);
t.setCurrentDate(monday);

const task = { id: 'a', title: 'A', duration: 120, priority: 3, deadline: mondayKey, deadlineTime: '12:00', scheduledDate: null, scheduledStart: null, locked: false, done: false };
let slot = t.findSlot(task, monday, {});
assert.equal(slot.date, mondayKey);
assert.equal(slot.start, 540);

const shortTask = { ...task, duration: 45 };
slot = t.findSlot(shortTask, monday, { [mondayKey]: [{ s: 540, e: 670 }] });
assert.equal(slot.date, mondayKey);
assert.equal(slot.start, 675);

assert.equal(t.findSlot({ ...task, duration: 60, deadlineTime: '09:30' }, monday, {}), null);

const manual = { ...task, id: 'm', duration: 120, deadlineTime: '17:00' };
t.setData({ ...base, tasks: [manual] });
assert.equal(t.validateManualSlot(manual, mondayKey, '10:00', 120), '');

const other = { ...manual, id: 'o', scheduledDate: mondayKey, scheduledStart: '11:00', duration: 60, locked: true };
t.setData({ ...base, tasks: [manual, other] });
assert.match(t.validateManualSlot(manual, mondayKey, '10:30', 60), /другая задача/);

const urgent = { id: 'u', title: 'Urgent', duration: 30, priority: 1, deadline: mondayKey, deadlineTime: '11:00' };
const laterHigh = { id: 'h', title: 'High', duration: 30, priority: 3, deadline: mondayKey, deadlineTime: '12:00' };
assert.equal(t.sortForPlanning([laterHigh, urgent])[0].id, 'h');

assert.match(t.deadlineLabel({ ...task, deadline: mondayKey, deadlineTime: '09:00' }), /Завтра|Сегодня|Просрочено/);
assert.equal(t.workingCapacityMinutes(), 480);
assert.equal(t.isValidDateKey('2026-02-31'), false);
assert.match(t.validateManualSlot({ ...manual, id: 'bad', deadline: mondayKey }, mondayKey, '99:99', 30), /Неверное время/);

const malformed = t.normalizeData({
  settings: { workStart: 'nope', workEnd: 99, lunchStart: -4, lunchEnd: 99, buffer: 999, focusLength: 999 },
  tasks: [{ id: 1, title: 'Imported', createdAt: 123, deadline: '2026-02-31', deadlineTime: '99:99', scheduledDate: '2026-09-28', scheduledStart: '99:99', locked: true, duration: 60, priority: 3 }],
  focus: { sessions: [{ date: '2026-02-31', minutes: 0 }] }
});
assert.equal(malformed.settings.workStart, 9);
assert.equal(malformed.settings.workEnd, 18);
assert.equal(malformed.settings.buffer, 10);
assert.equal(typeof malformed.tasks[0].createdAt, 'string');
assert.equal(malformed.tasks[0].scheduledDate, null);
assert.equal(malformed.tasks[0].scheduledStart, null);
assert.equal(malformed.focus.sessions.length, 0);

console.log('Scheduler tests passed.');
