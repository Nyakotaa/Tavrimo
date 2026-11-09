import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = ('globalThis.__TAVRIMO_QA__ = true;\n' + fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8')).replace('  boot();\n})();', '  // boot disabled for tests\n})();');
const storage = Object.create(null);
const dummyClassList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
const dummyElement = new Proxy({ classList: dummyClassList, style: { setProperty() {} }, dataset: {}, hidden: false, value: '', checked: false, disabled: false, textContent: '', innerHTML: '', setAttribute() {}, focus() {}, addEventListener() {} }, { get: (target, prop) => target[prop] });
const context = {
  console,
  crypto: { randomUUID: () => 'snapshot-test-id' },
  localStorage: { getItem: (key) => storage[key] ?? null, setItem: (key, value) => { storage[key] = String(value); }, removeItem: (key) => { delete storage[key]; } },
  Intl, Date, Math, Number, String, JSON, Array, Object, Set, RegExp, Blob, File, URL,
  isNaN, parseInt, parseFloat,
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  document: { baseURI: 'https://example.github.io/tavrimo/', documentElement: { dataset: {} }, body: { classList: dummyClassList }, querySelector: () => dummyElement, querySelectorAll: () => [] },
  window: { location: { href: 'https://example.github.io/tavrimo/' } },
  setTimeout, clearTimeout, setInterval, clearInterval
};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: 'app.js' });
const t = context.__TAVRIMO_TEST__;
assert.ok(t, 'QA hooks must be available');

const manifest = t.normalizeScheduleSnapshotManifest({
  schemaVersion: 1,
  snapshots: [
    { groupCode: '15.14Д-ГГ04/266', file: 'data/schedules/rea-group.ics', revision: 'r1', capturedAt: '2026-11-09T12:00:00+03:00', source: 'Vuzio · календарный снимок', minimumEvents: 2 },
    { groupCode: '24.01/01', file: '../private.ics', revision: 'bad', capturedAt: '2026-11-09T12:00:00+03:00' },
    { groupCode: '15.14Д-ГГ04/266', file: 'data/schedules/duplicate.ics', revision: 'r2', capturedAt: '2026-11-09T12:00:00+03:00' }
  ]
});
assert.equal(manifest.snapshots.length, 1, 'Manifest must reject traversal and duplicate group mappings');
assert.equal(t.findScheduleSnapshot(manifest, ' 15.14д-ГГ04/266 '), manifest.snapshots[0], 'Group matching should be case/whitespace insensitive');
assert.equal(t.findScheduleSnapshot(manifest, '15.14Д-ГГ04/999'), null, 'Unknown group must not receive another group’s file');

const ics = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'X-WR-CALNAME:РЭУ · 15.14Д-ГГ04/266',
  'BEGIN:VEVENT',
  'UID:rea-1',
  'DTSTART;TZID=Europe/Moscow:20261110T083000',
  'DTEND;TZID=Europe/Moscow:20261110T100000',
  'SUMMARY:Экономика',
  'LOCATION:3 корпус, 214',
  'DESCRIPTION:Преподаватель: Иванов Иван Иванович',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:rea-2',
  'DTSTART;TZID=Europe/Moscow:20261111T101000',
  'DTEND;TZID=Europe/Moscow:20261111T114000',
  'SUMMARY:История',
  'LOCATION:2 корпус, 117',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');

const parsed = t.parseStaticScheduleSnapshot(ics, '15.14Д-ГГ04/266', manifest.snapshots[0]);
assert.equal(parsed.events.length, 2);
assert.equal(parsed.events[0].teacher, 'Иванов Иван Иванович');
assert.equal(parsed.events[0].room, '3 корпус, 214');
assert.equal(parsed.calendarName, 'РЭУ · 15.14Д-ГГ04/266');
assert.equal(parsed.compatibility.compatible, true);

assert.throws(() => t.parseStaticScheduleSnapshot(ics.replace('TZID=Europe/Moscow', 'TZID=Europe/London'), '15.14Д-ГГ04/266', manifest.snapshots[0]), /неподдерживаемые конструкции/i, 'Unknown timezone must be rejected');
assert.throws(() => t.parseStaticScheduleSnapshot(ics.replace('UID:rea-2', 'UID:rea-2\r\nRRULE:FREQ=WEEKLY'), '15.14Д-ГГ04/266', manifest.snapshots[0]), /неподдерживаемые конструкции/i, 'Recurring events must not be silently truncated');
assert.throws(() => t.parseStaticScheduleSnapshot(ics.replace('DTSTART;TZID=Europe/Moscow:20261111T101000', 'DTSTART;VALUE=DATE:20261111'), '15.14Д-ГГ04/266', manifest.snapshots[0]), /не все занятия/i, 'Unsupported all-day lessons must prevent partial import');

const calls = [];
const fetchImpl = async (url, options) => {
  calls.push({ url: String(url), options });
  if (String(url).endsWith('/data/schedules/manifest.json')) {
    return { ok: true, status: 200, json: async () => ({ schemaVersion: 1, snapshots: [{ ...manifest.snapshots[0], calendarNameIncludes: '15.14Д-ГГ04/266' }] }) };
  }
  if (String(url).includes('/data/schedules/rea-group.ics?v=r1')) {
    return { ok: true, status: 200, text: async () => ics };
  }
  return { ok: false, status: 404 };
};
const loaded = await t.loadStaticScheduleSnapshot('15.14Д-ГГ04/266', { fetchImpl, baseHref: 'https://example.github.io/tavrimo/' });
assert.equal(loaded.found, true);
assert.equal(loaded.parsed.events.length, 2);
assert.equal(calls[0].url, 'https://example.github.io/tavrimo/data/schedules/manifest.json', 'Asset URLs must respect GitHub Pages project base path');
assert.equal(calls[1].url, 'https://example.github.io/tavrimo/data/schedules/rea-group.ics?v=r1', 'Revision must be included in snapshot URL for cache invalidation');

const missing = await t.loadStaticScheduleSnapshot('24.01/01', { fetchImpl, baseHref: 'https://example.github.io/tavrimo/' });
assert.equal(missing.found, false, 'Unmapped group must fall back to the existing live provider');

const normalizedSnapshot = t.normalizeUniversity({ groupCode: '15.14Д-ГГ04/266', source: 'Vuzio', syncMode: 'snapshot', snapshotCapturedAt: '2026-11-09T12:00:00+03:00', snapshotRevision: 'r1', events: parsed.events });
assert.equal(normalizedSnapshot.syncMode, 'snapshot');
assert.equal(normalizedSnapshot.source, 'Vuzio');
assert.equal(normalizedSnapshot.snapshotRevision, 'r1');

console.log('Static schedule provider tests passed.');
