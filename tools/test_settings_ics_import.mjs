import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8').replace('  boot();\n})();', '  // boot disabled for import integration test\n})();');
const ics = fs.readFileSync(new URL('../data/schedules/rea-15-14d-gg04-266.ics', import.meta.url), 'utf8');
const storage = {};
const classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
const element = new Proxy({
  classList, style: { setProperty() {} }, dataset: {}, hidden: false, value: '', checked: false,
  disabled: false, textContent: '', innerHTML: '', setAttribute() {}, removeAttribute() {},
  focus() {}, addEventListener() {}, append() {}, querySelector() { return element; }, querySelectorAll() { return []; }, closest() { return element; },
  toggleAttribute() {}, click() {}
}, {
  get(target, property) {
    if (property in target) return target[property];
    if (property === 'options' || property === 'children' || property === 'childNodes') return [];
    return undefined;
  },
  set(target, property, value) { target[property] = value; return true; }
});
class MockFileReader {
  readAsText(file) { this.result = file.contents; this.onload?.(); }
}
const context = {
  console, crypto: { randomUUID: () => 'settings-ics-test' },
  localStorage: { getItem: (key) => storage[key] ?? null, setItem: (key, value) => { storage[key] = String(value); }, removeItem: (key) => { delete storage[key]; } },
  Intl, Date, Math, Number, String, JSON, Array, Object, Set, Map, RegExp, Blob, File, URL, AbortController, Promise, Error, TypeError,
  isNaN, parseInt, parseFloat, FileReader: MockFileReader,
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  document: {
    baseURI: 'https://example.github.io/tavrimo/', documentElement: { dataset: {} }, body: { classList }, visibilityState: 'visible',
    querySelector: () => element, querySelectorAll: () => [], addEventListener() {}, createElement: () => element
  },
  window: { location: { href: 'https://example.github.io/tavrimo/' }, addEventListener() {} },
  navigator: { onLine: false }, fetch: async () => { throw new Error('Network must not be used during local ICS import'); },
  setTimeout, clearTimeout, setInterval, clearInterval, confirm: () => true
};
context.globalThis = context;
vm.runInNewContext(`globalThis.__TAVRIMO_QA__ = true;\n${app}`, context, { filename: 'app.js' });
const qa = context.__TAVRIMO_TEST__;
assert.ok(qa);
assert.equal(qa.isIcsScheduleFile({ name: 'schedule.ics', type: 'application/octet-stream' }), true);
assert.equal(qa.isIcsScheduleFile({ name: 'backup.json', type: 'application/json' }), false);

qa.setData({
  version: 17, settings: { theme: 'dark' }, tasks: [{ id: 'keep-task', title: 'Keep me', duration: 30, priority: 2, done: false }],
  focus: { totalMinutes: 0, sessions: [] },
  university: { groupCode: '15.14Д-ГГ04/266', groupName: '15.14Д-ГГ04/266', events: [], syncMode: 'auto' }
});
qa.handleSettingsImportFile({ name: 'calendar.ics', type: 'application/octet-stream', size: Buffer.byteLength(ics), contents: ics });
const data = qa.getData();
assert.equal(data.university.events.length, 46, 'Settings import must load all 46 ICS events');
assert.equal(data.university.syncMode, 'manual', 'Imported ICS must be stored as a local calendar');
assert.equal(data.university.groupCode, '15.14Д-ГГ04/266');
assert.equal(data.tasks.length, 1, 'ICS import must not replace personal tasks');
assert.equal(data.tasks[0].title, 'Keep me');
console.log('Settings ICS import integration passed (46 classes imported; tasks preserved).');
