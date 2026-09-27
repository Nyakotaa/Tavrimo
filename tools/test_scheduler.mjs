import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8').replace(
  '  boot();\n})();',
  `  globalThis.__flowdayTest = {\n    setData: (raw) => { data = normalizeData(raw); },\n    setCurrentDate: (value) => { currentDate = startOfDay(value); },\n    findSlot, validateManualSlot, sortForPlanning, deadlineLabel, deadlineTimestamp, workingCapacityMinutes\n  };\n})();`
);

const storage = Object.create(null);
const context = {
  console,
  crypto: { randomUUID: () => 'test-id' },
  localStorage: {
    getItem: (key) => storage[key] ?? null,
    setItem: (key, value) => { storage[key] = String(value); },
    removeItem: (key) => { delete storage[key]; },
  },
  Intl, Date, Math, Number, String, JSON, Array, Object, Set, RegExp,
  isNaN, parseInt, parseFloat, matchMedia: () => ({ matches: false }),
};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: 'app.js' });
const t = context.__flowdayTest;

const base = {
  version: 7,
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

const urgent = { id: 'u', title: 'Urgent', duration: 30, priority: 1, deadline: mondayKey, deadlineTime: '10:00' };
const laterHigh = { id: 'h', title: 'High', duration: 30, priority: 3, deadline: mondayKey, deadlineTime: '17:00' };
assert.equal(t.sortForPlanning([laterHigh, urgent])[0].id, 'u');

assert.match(t.deadlineLabel({ ...task, deadline: mondayKey, deadlineTime: '09:00' }), /Завтра|Сегодня|Просрочено/);
assert.equal(t.workingCapacityMinutes(), 480);

console.log('Scheduler tests passed.');
