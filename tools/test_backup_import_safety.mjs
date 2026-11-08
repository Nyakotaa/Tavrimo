import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = ('globalThis.__TAVRIMO_QA__ = true;\n' + fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8')).replace('  boot();\n})();', '  // boot disabled for tests\n})();');
const dummyClassList = { add() {}, remove() {}, toggle() {}, contains() {} };
const dummyElement = new Proxy({ classList: dummyClassList, style: { setProperty() {} }, dataset: {}, hidden: false, value: '', checked: false, disabled: false, textContent: '', innerHTML: '', setAttribute() {}, focus() {}, addEventListener() {} }, { get: (target, prop) => target[prop] });
const context = {
  console, crypto: { randomUUID: () => 'qa-id' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  Intl, Date, Math, Number, String, JSON, Array, Object, Set, RegExp, Blob, File, URL,
  isNaN, parseInt, parseFloat,
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  document: { documentElement: { dataset: {} }, body: { classList: dummyClassList }, querySelector: () => dummyElement, querySelectorAll: () => [] },
  setTimeout, clearTimeout, setInterval, clearInterval,
};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: 'app.js' });
const api = context.__TAVRIMO_TEST__;
assert.ok(api, 'QA hooks must be available');

const valid = JSON.stringify({ tasks: [{ id: 'a', title: 'Подготовить отчёт', duration: 30, priority: 2 }] });
const parsed = api.parseBackupData(valid);
assert.equal(parsed.tasks.length, 1);
assert.equal(parsed.tasks[0].title, 'Подготовить отчёт');
assert.throws(() => api.parseBackupData('{broken json'), 'Malformed JSON must be rejected');
assert.throws(() => api.parseBackupData(JSON.stringify({ tasks: 'not-array' })), 'Invalid task collection must be rejected');
assert.throws(() => api.parseBackupData(JSON.stringify({ tasks: Array.from({ length: 10001 }, () => ({})) })), 'Oversized task collection must be rejected');

const importStart = source.indexOf('function importData(file)');
const importEnd = source.indexOf('function showToast(message)', importStart);
const importSource = source.slice(importStart, importEnd);
assert.ok(importSource.indexOf('confirm(') < importSource.indexOf('data = parsed'), 'User confirmation must happen before data replacement');
assert.match(importSource, /const previousData = data/);
assert.match(importSource, /if \(!saveData\(\)\) \{\s*data = previousData/s, 'Failed persistence must roll back in-memory state');

console.log('Backup import safety tests passed.');
