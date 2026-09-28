import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = (`globalThis.__TAVRIMO_QA__ = true;\n` + fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8')).replace('  boot();\n})();', '  // boot disabled for tests\n})();');
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

const monday = new Date(2026, 8, 30, 12);
const mondayKey = '2026-09-30';
const base = {
  version: 11,
  settings: { workStart: 9, workEnd: 18, lunchStart: 13, lunchEnd: 14, buffer: 10, focusLength: 25, weekends: false, theme: 'system' },
  tasks: [], focus: { totalMinutes: 0, sessions: [] },
};

// Manual slot is the only scheduling primitive.
t.setData({ ...base, tasks: [] });
const task = { id: 'a', title: 'Manual', duration: 60, priority: 3, deadline: mondayKey, deadlineTime: '17:00', scheduledDate: null, scheduledStart: null, locked: false, done: false };
assert.equal(t.validateManualSlot(task, mondayKey, '10:00', 60), '');
assert.equal(t.validateManualSlot(task, mondayKey, '12:30', 30), 'Резерв после задачи пересекает перерыв.');
assert.equal(t.validateManualSlot(task, mondayKey, '18:00', 15), 'Слот выходит за пределы рабочего дня.');
assert.match(t.validateManualSlot(task, mondayKey, '10:07', 15), /кратно 15/);
assert.equal(t.validateManualSlot(task, '2026-02-31', '10:00', 30), 'Выбери существующую дату.');

// Existing scheduled slots are normalized to manual, even if imported as auto.
const migrated = t.normalizeData({ ...base, tasks: [{ ...task, scheduledDate: mondayKey, scheduledStart: '10:00', locked: false }] });
assert.equal(migrated.tasks[0].locked, true);
assert.equal(migrated.tasks[0].scheduledStart, '10:00');

// No automatic scheduling occurs through data normalization: an unscheduled task stays in inbox.
assert.equal(t.normalizeData({ ...base, tasks: [{ ...task, scheduledDate: null, scheduledStart: null, locked: false }] }).tasks[0].scheduledDate, null);

// Conflicts and buffer are enforced consistently.
const conflictData = { ...base, tasks: [{ ...task, id: 'busy', scheduledDate: mondayKey, scheduledStart: '10:00', locked: true }] };
t.setData(conflictData);
assert.equal(t.validateManualSlot({ ...task, id: 'new' }, mondayKey, '10:30', 30), 'На это время уже стоит другая задача.');
assert.equal(t.validateManualSlot({ ...task, id: 'new' }, mondayKey, '12:30', 30), 'Резерв после задачи пересекает перерыв.');
assert.equal(t.validateManualSlot({ ...task, id: 'new' }, mondayKey, '11:15', 30), '');

// Duplicate IDs are repaired on import.
const duplicated = t.normalizeData({ ...base, tasks: [
  { id: 'same', title: 'A', duration: 30, priority: 2 },
  { id: 'same', title: 'B', duration: 30, priority: 2 },
  { id: 'same-2', title: 'C', duration: 30, priority: 2 },
] });
assert.deepEqual(duplicated.tasks.map(x => x.id), ['same', 'same-2', 'same-2-2']);

// Historical scheduled tasks remain visible after they pass; users can manually edit them instead of losing them.
t.setData({ ...base, tasks: [{ ...task, scheduledDate: '2026-09-25', scheduledStart: '10:00', locked: true, deadline: '2026-09-25', deadlineTime: '17:00' }] });
const historical = t.normalizeData(t.getData());
assert.equal(historical.tasks[0].scheduledDate, '2026-09-25');
assert.equal(historical.tasks[0].locked, true);

// Completed overdue tasks are completed, not overdue.
assert.equal(t.deadlineLabel({ id: 'done', title: 'Done', duration: 30, priority: 2, deadline: '2020-01-01', deadlineTime: null, done: true }), 'Выполнено');

// Urgency score orders overdue/deadline/priority without invoking any auto-placement.
const urgentLow = { ...task, id: 'u', priority: 1, deadline: mondayKey, deadlineTime: '10:00' };
const urgentHigh = { ...task, id: 'h', priority: 3, deadline: mondayKey, deadlineTime: '10:00' };
assert.ok(t.taskUrgencyScore(urgentHigh) < t.taskUrgencyScore(urgentLow));

console.log('Manual scheduling regression tests passed.');
