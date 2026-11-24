import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const appPath = new URL('../app.js', import.meta.url);
const manifestPath = new URL('../data/schedules/manifest.json', import.meta.url);
const icsPath = new URL('../data/schedules/rea-15-14d-mm05-26b.ics', import.meta.url);
const app = ('globalThis.__TAVRIMO_QA__ = true;\n' + fs.readFileSync(appPath, 'utf8')).replace('  boot();\n})();', '  // boot disabled for integration test\n})();');
const storage = {};
const classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
const element = new Proxy({
  classList, style: { setProperty() {} }, dataset: {}, hidden: false, value: '', checked: false,
  disabled: false, textContent: '', innerHTML: '', setAttribute() {}, removeAttribute() {},
  focus() {}, addEventListener() {}, append() {}, querySelector() { return element; }, closest() { return element; }
}, {
  get(target, property) { if (property in target) return target[property]; if (['options', 'children', 'childNodes'].includes(property)) return []; return undefined; },
  set(target, property, value) { target[property] = value; return true; }
});
const context = {
  console,
  crypto: { randomUUID: () => 'mm05-test-id' },
  localStorage: { getItem: (key) => storage[key] ?? null, setItem: (key, value) => { storage[key] = String(value); }, removeItem: (key) => { delete storage[key]; } },
  Intl, Date, Math, Number, String, JSON, Array, Object, Set, Map, RegExp, Blob, File, URL,
  AbortController, Promise, Error, TypeError,
  isNaN, parseInt, parseFloat,
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  document: { baseURI: 'https://example.github.io/tavrimo/', documentElement: { dataset: {} }, body: { classList }, visibilityState: 'visible', querySelector: () => element, querySelectorAll: () => [], addEventListener() {}, createElement: () => element },
  window: { location: { href: 'https://example.github.io/tavrimo/' }, addEventListener() {} },
  navigator: { onLine: false },
  fetch: async (url) => {
    const target = String(url);
    if (target.endsWith('/data/schedules/manifest.json')) return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(manifestPath, 'utf8')) };
    if (target.includes('/data/schedules/rea-15-14d-mm05-26b.ics?v=vuzio-20261116-132120z-48-events')) return { ok: true, status: 200, text: async () => ics };
    return { ok: false, status: 503, json: async () => ({ error: 'gateway should not be called for a registered snapshot' }) };
  },
  setTimeout, clearTimeout, setInterval, clearInterval
};
context.globalThis = context;
vm.runInNewContext(app, context, { filename: 'app.js' });
const qa = context.__TAVRIMO_TEST__;
assert.ok(qa, 'QA hooks must be available');

const ics = fs.readFileSync(icsPath, 'utf8');
const parsed = qa.parseUniversityIcs(ics);
assert.equal(parsed.calendarName, 'Расписание 15.14Д-ММ05/26б');
assert.equal(parsed.events.length, 48, 'All 48 MM05 events should be parsed');
assert.equal(parsed.events[0].date, '2026-11-16');
assert.equal(parsed.events.at(-1).date, '2026-11-30');
assert.equal(qa.inspectScheduleIcsCompatibility(ics).compatible, true);

const rawManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const manifest = qa.normalizeScheduleSnapshotManifest(rawManifest);
assert.equal(manifest.snapshots.length, 2);
const mm05 = qa.findScheduleSnapshot(manifest, '15.14Д-ММ05/26б');
assert.ok(mm05, 'Canonical Cyrillic group must resolve');
assert.equal(qa.findScheduleSnapshot(manifest, '15.14D-MM05/26b')?.groupCode, '15.14Д-ММ05/26б', 'Latin keyboard group spelling must resolve');
assert.equal(mm05.minimumEvents, 48);
assert.equal(mm05.coverageStart, '2026-11-16');
assert.equal(mm05.coverageEnd, '2026-11-30');

const fetchCalls = [];
const fetchImpl = async (url) => {
  fetchCalls.push(String(url));
  if (String(url).endsWith('/data/schedules/manifest.json')) {
    return { ok: true, status: 200, json: async () => rawManifest };
  }
  if (String(url).includes('/data/schedules/rea-15-14d-mm05-26b.ics?v=vuzio-20261116-132120z-48-events')) {
    return { ok: true, status: 200, text: async () => ics };
  }
  return { ok: false, status: 404 };
};
const loaded = await qa.loadStaticScheduleSnapshot('15.14Д-ММ05/26б', { fetchImpl, baseHref: 'https://example.github.io/tavrimo/' });
assert.equal(loaded.found, true);
assert.equal(loaded.entry.groupCode, '15.14Д-ММ05/26б');
assert.equal(loaded.parsed.events.length, 48);
assert.ok(fetchCalls[0].includes('/tavrimo/data/schedules/manifest.json'));
assert.ok(fetchCalls[1].includes('/tavrimo/data/schedules/rea-15-14d-mm05-26b.ics?v='));

// Exercise the existing sync flow for MM05: it must load the snapshot and must not contact the gateway.
qa.setData({
  version: 17,
  settings: { theme: 'dark', workStart: 9, workEnd: 18, lunchStart: 13, lunchEnd: 14, buffer: 10, focusLength: 25 },
  tasks: [], focus: { totalMinutes: 0, sessions: [] },
  university: { groupCode: '15.14Д-ММ05/26б', groupName: '15.14Д-ММ05/26б', importedAt: null, source: 'rasp.rea.ru', events: [], syncHash: '', lastSyncAt: null, lastSnapshotCheckAt: null, snapshotCapturedAt: null, snapshotRevision: '', syncError: '', syncMode: 'auto' }
});
const syncResult = await qa.syncUniversitySchedule({ force: true, silent: true });
assert.equal(syncResult.ok, true);
assert.equal(syncResult.snapshot, true);
assert.equal(qa.getData().university.events.length, 48);
assert.equal(qa.getData().university.syncMode, 'snapshot');
assert.equal(qa.getData().university.groupCode, '15.14Д-ММ05/26б');

// Verify that the group selector receives the available snapshots as suggestions.
const suggestions = await qa.refreshUniversityGroupSuggestions({ fetchImpl, baseHref: 'https://example.github.io/tavrimo/' });
assert.equal(suggestions.length, 2, 'Only the two verified groups should be suggested');
assert.ok(element.innerHTML.includes('15.14Д-ММ05/26б'));
assert.ok(element.innerHTML.includes('15.14Д-ГГ04/266'));

console.log('Vuzio MM05 snapshot passed (48 events, two registered groups, Latin alias, cached static asset and group suggestions).');
