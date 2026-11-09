import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const appPath = new URL('../app.js', import.meta.url);
const icsPath = new URL('../data/schedules/rea-15-14d-gg04-266.ics', import.meta.url);
const manifestPath = new URL('../data/schedules/manifest.json', import.meta.url);
const source = ('globalThis.__TAVRIMO_QA__ = true;\n' + fs.readFileSync(appPath, 'utf8')).replace('  boot();\n})();', '  // boot disabled for tests\n})();');
const dummyClassList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
const dummyElement = new Proxy({ classList: dummyClassList, style: { setProperty() {} }, dataset: {}, hidden: false, value: '', checked: false, disabled: false, textContent: '', innerHTML: '', setAttribute() {}, focus() {}, addEventListener() {} }, { get: (target, prop) => target[prop] });
const context = {
  console,
  crypto: { randomUUID: () => 'vuzio-test-id' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
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

const ics = fs.readFileSync(icsPath, 'utf8');
const manifestRaw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const manifest = t.normalizeScheduleSnapshotManifest(manifestRaw);
assert.equal(manifest.snapshots.length, 1, 'Exactly one known group is mapped to a static snapshot');
const entry = manifest.snapshots[0];
assert.equal(entry.groupCode, '15.14Д-ГГ04/266');
assert.equal(t.findScheduleSnapshot(manifest, '15.14Д-ГГ04/266'), entry);
assert.equal(t.findScheduleSnapshot(manifest, '15.14Д-ГГ04/999'), null);

const parsed = t.parseStaticScheduleSnapshot(ics, entry.groupCode, entry);
assert.equal(parsed.events.length, 46, 'Every VEVENT from the feed must be parsed');
assert.equal(parsed.compatibility.eventCount, 46);
assert.equal(parsed.compatibility.unsupported.length, 0);
assert.equal(parsed.compatibility.unsupportedTimezones.length, 0);
assert.equal(parsed.calendarName, 'Расписание 15.14Д-ГГ04/26б');
assert.equal(parsed.events[0].date, '2026-11-09');
assert.equal(parsed.events[0].start, '08:30', 'UTC 05:30Z must be converted to Moscow 08:30');
assert.equal(parsed.events[0].end, '10:00');
const monday = parsed.events.filter((event) => event.date === '2026-11-09').map((event) => `${event.start}-${event.end}`);
assert.equal(monday.join(','), '08:30-10:00,10:10-11:40,11:50-13:20,14:00-15:30', 'The four Monday lessons must match the Vuzio timetable screenshot');

const sports = parsed.events.filter((event) => event.date === '2026-11-09' && event.start === '08:30');
assert.equal(sports.length, 1);
assert.equal(sports[0].subject, 'Физическая культура и спорт', 'Abbreviated teacher suffix should not remain in subject');
assert.equal(sports[0].teacher, 'Артамонов Дмитрий Валерьевич');
assert.equal(sports[0].room, 'с/з №3 · 4 корпус');
assert.equal(sports[0].type, 'Практика');

const parallelSports = parsed.events.filter((event) => event.date === '2026-11-16' && event.start === '10:10' && event.subject === 'Физическая культура и спорт');
assert.equal(parallelSports.length, 2, 'Two simultaneous sport stream events with different teachers/gyms must both be preserved');
assert.deepEqual(new Set(parallelSports.map((event) => event.teacher)), new Set(['Артамонов Дмитрий Валерьевич', 'Внукова Елена Юрьевна']));
assert.equal(new Set(parsed.events.map((event) => event.uid)).size, 46, 'UID values must remain unique');
assert.equal(parsed.events[parsed.events.length - 1].date, '2026-11-23');

// Exercise the same fetch path used by the app, including GitHub Pages base path.
const loaded = await t.loadStaticScheduleSnapshot('15.14Д-ГГ04/266', {
  baseHref: 'https://example.github.io/tavrimo/',
  fetchImpl: async (url) => {
    const href = String(url);
    if (href.endsWith('/data/schedules/manifest.json')) return { ok: true, status: 200, json: async () => manifestRaw };
    if (href.includes('/data/schedules/rea-15-14d-gg04-266.ics?v=vuzio-20261109-071932z-46-events')) return { ok: true, status: 200, text: async () => ics };
    return { ok: false, status: 404 };
  }
});
assert.equal(loaded.found, true);
assert.equal(loaded.parsed.events.length, 46);

assert.throws(() => t.parseStaticScheduleSnapshot(ics.replace('DTSTART:20261109T053000Z', 'DTSTART;VALUE=DATE:20261109'), entry.groupCode, entry), /не все занятия/i, 'Partial parsing must fail closed');
assert.throws(() => t.parseStaticScheduleSnapshot(ics.replace('UID:6bbda23682db6bc772fa577a@schedule.mrdis.one', 'UID:6bbda23682db6bc772fa577a@schedule.mrdis.one\r\nRRULE:FREQ=WEEKLY'), entry.groupCode, entry), /неподдерживаемые конструкции/i, 'Unsupported recurrence must fail closed');

console.log('Real Vuzio ICS snapshot tests passed (46 events, 2026-11-09 through 2026-11-23).');
