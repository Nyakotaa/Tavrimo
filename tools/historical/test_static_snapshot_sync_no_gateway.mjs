import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8')
  .replace('  boot();\n})();', '  // boot disabled for integration test\n})();');
const state = {
  version: 17,
  settings: { theme: 'dark' },
  tasks: [],
  focus: { totalMinutes: 0, sessions: [] },
  university: {
    groupCode: '15.14Д-ГГ04/266', groupName: '15.14Д-ГГ04/266',
    events: [], syncMode: 'auto'
  }
};
const storage = { 'tavrimo-planner-v17': JSON.stringify(state) };
const classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
const element = new Proxy({
  classList, style: { setProperty() {} }, dataset: {}, hidden: false, value: '', checked: false,
  disabled: false, textContent: '', innerHTML: '', setAttribute() {}, removeAttribute() {},
  focus() {}, addEventListener() {}, append() {}, querySelector() { return element; }, closest() { return element; }
}, {
  get(target, property) {
    if (property in target) return target[property];
    if (property === 'options' || property === 'children' || property === 'childNodes') return [];
    return undefined;
  },
  set(target, property, value) { target[property] = value; return true; }
});
let networkCalls = 0;
const context = {
  console,
  crypto: { randomUUID: () => 'static-snapshot-sync-test' },
  localStorage: {
    getItem: (key) => storage[key] ?? null,
    setItem: (key, value) => { storage[key] = String(value); },
    removeItem: (key) => { delete storage[key]; }
  },
  Intl, Date, Math, Number, String, JSON, Array, Object, Set, Map, RegExp, Blob, File, URL,
  AbortController, Promise, Error, TypeError,
  isNaN, parseInt, parseFloat,
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  document: {
    baseURI: 'https://example.github.io/tavrimo/',
    documentElement: { dataset: {} }, body: { classList }, visibilityState: 'visible',
    querySelector: () => element, querySelectorAll: () => [], addEventListener() {}, createElement: () => element
  },
  window: { location: { href: 'https://example.github.io/tavrimo/' }, addEventListener() {} },
  navigator: { onLine: false },
  fetch: async () => { networkCalls += 1; return { ok: false, status: 503, json: async () => ({ error: 'Офлайн' }) }; },
  setTimeout, clearTimeout, setInterval, clearInterval
};
context.globalThis = context;
vm.runInNewContext(`globalThis.__TAVRIMO_QA__ = true;\n${app}`, context, { filename: 'app.js' });
const qa = context.__TAVRIMO_TEST__;
assert.ok(qa, 'QA hooks must be available');

const result = await qa.syncUniversitySchedule({ force: true, silent: true });
assert.equal(result.ok, true, 'The known group should load despite an unavailable Sync Gateway');
assert.equal(result.snapshot, true, 'The known group must use the bundled ICS snapshot');
assert.equal(qa.getData().university.events.length, 46, 'All 46 lessons must be applied');
assert.equal(qa.getData().university.syncMode, 'snapshot');
assert.equal(qa.getData().university.syncError, '');
assert.equal(networkCalls, 0, 'No request should be sent to the 503 Sync Gateway');

// A group typed with Latin letters on an English keyboard must resolve to the same demo snapshot.
qa.setData({ ...state, university: { ...state.university, groupCode: '15.14D-GG04/266', groupName: '15.14D-GG04/266', events: [], syncMode: 'auto' } });
const latinResult = await qa.syncUniversitySchedule({ force: true, silent: true });
assert.equal(latinResult.ok, true, 'English-keyboard group spelling should resolve to the built-in snapshot');
assert.equal(latinResult.snapshot, true);
assert.equal(qa.getData().university.events.length, 46);
assert.equal(networkCalls, 0);

// A manually imported ICS stays local even for the built-in demo group; refresh must not overwrite it or hit the gateway.
qa.setData({ ...state, university: { ...state.university, groupCode: '15.14Д-ГГ04/266', events: [{ date: '2026-11-09', start: '08:30', end: '10:00', subject: 'Imported class' }], syncMode: 'manual', syncError: 'old 403' } });
const localResult = await qa.syncUniversitySchedule({ force: true, silent: true });
assert.equal(localResult.ok, true);
assert.equal(localResult.local, true);
assert.equal(networkCalls, 0);
assert.equal(qa.getData().university.events.length, 1);
assert.equal(qa.getData().university.events[0].subject, 'Imported class', 'Manual ICS must not be overwritten by the bundled snapshot');
assert.equal(qa.getData().university.syncError, '', 'Stale 403 must be cleared in local mode');

console.log('Built-in snapshot sync integration passed (46 lessons, alias matching, manual ICS local mode, 0 gateway requests).');
