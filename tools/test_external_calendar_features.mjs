import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8').replace('  boot();\n})();', '  // boot disabled for calendar tests\n})();');
const classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
const element = new Proxy({ classList, style: { setProperty() {} }, dataset: {}, hidden: false, value: '', checked: false, disabled: false, textContent: '', innerHTML: '', setAttribute() {}, addEventListener() {}, focus() {} }, { get: (target, key) => key in target ? target[key] : undefined, set: (target, key, value) => (target[key] = value, true) });
const storage = {};
const context = {
  console, crypto: { randomUUID: () => 'test-id' },
  localStorage: { getItem: (key) => storage[key] ?? null, setItem: (key, value) => { storage[key] = String(value); }, removeItem: (key) => { delete storage[key]; } },
  Intl, Date, Math, Number, String, JSON, Array, Object, Set, Map, RegExp, Blob, File, URL, AbortController, Promise, Error, TypeError, Response,
  isNaN, parseInt, parseFloat,
  document: { documentElement: { dataset: {} }, body: { classList }, querySelector: () => element, querySelectorAll: () => [], addEventListener() {}, createElement: () => element },
  window: { location: { href: 'https://nyakotaa.github.io/Tavrimo/' }, addEventListener() {} },
  navigator: { onLine: false }, fetch: undefined, setTimeout, clearTimeout, setInterval, clearInterval, confirm: () => true
};
context.globalThis = context;
vm.runInNewContext(`globalThis.__TAVRIMO_QA__ = true;\n${app}`, context, { filename: 'app.js' });
const qa = context.__TAVRIMO_TEST__;
assert.ok(qa);

assert.equal(qa.getGreeting(7, 'Даниил'), 'Доброе утро, Даниил!');
assert.equal(qa.getGreeting(13, ''), 'Добрый день!');
assert.equal(qa.getGreeting(20, 'Даня'), 'Добрый вечер, Даня!');
assert.equal(qa.getGreeting(2, ''), 'Доброй ночи!');
assert.equal(qa.normalizeData({ settings: { displayName: ' <Danya>\n ' }, tasks: [] }).settings.displayName, 'Danya');
assert.equal(qa.normalizeCalendarFeedUrl('webcal://calendar.google.com/calendar/ical/secret/basic.ics')?.startsWith('https://calendar.google.com/'), true);
assert.equal(qa.normalizeCalendarFeedUrl('https://evil.example/calendar.ics'), '');
assert.equal(qa.externalCalendarProviderFromUrl('https://outlook.office365.com/owa/calendar/test/calendar.ics'), 'outlook');
assert.equal(qa.externalCalendarProviderFromUrl('https://p12-caldav.icloud.com/published/2/test'), 'apple');
assert.equal(qa.externalCalendarProviderFromUrl('https://outlook.com/unknown.ics'), 'other', 'Only documented provider feed hosts are accepted');

const today = new Date();
const key = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
const [year, month, day] = key.split('-');
const dayCode = ['SU','MO','TU','WE','TH','FR','SA'][today.getDay()];
const utcStamp = `${year}${month}${day}T100000Z`;
const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:Work calendar\r\nBEGIN:VEVENT\r\nUID:all-day-event\r\nDTSTART;VALUE=DATE:${year}${month}${day}\r\nDTEND;VALUE=DATE:${year}${month}${String(Number(day)+2).padStart(2,'0')}\r\nSUMMARY:Conference\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:weekly-meeting\r\nDTSTART:${year}${month}${day}T100000\r\nDTEND:${year}${month}${day}T110000\r\nRRULE:FREQ=WEEKLY;COUNT=3;BYDAY=${dayCode}\r\nSUMMARY:Weekly meeting\r\nLOCATION:Room 4\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:transparent-event\r\nDTSTART:${utcStamp}\r\nDTEND:${year}${month}${day}T110000Z\r\nSUMMARY:Optional\r\nTRANSP:TRANSPARENT\r\nEND:VEVENT\r\nEND:VCALENDAR`;
const parsed = qa.parseExternalCalendarIcs(ics);
assert.equal(parsed.calendarName, 'Work calendar');
assert.equal(parsed.events.filter(e => e.uid === 'all-day-event').length, 2, 'DTEND date is exclusive for multi-day all-day events');
assert.equal(parsed.events.filter(e => e.uid === 'weekly-meeting').length, 3, 'Weekly recurring events expand three occurrences');
assert.equal(parsed.events.find(e => e.uid === 'transparent-event').transparent, true);
assert.equal(parsed.events.find(e => e.uid === 'all-day-event').allDay, true);

const utcEvent = qa.parseExternalCalendarIcs(`BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:utc\nDTSTART:${utcStamp}\nDTEND:${year}${month}${day}T110000Z\nSUMMARY:UTC event\nEND:VEVENT\nEND:VCALENDAR`).events[0];
const expectedLocal = new Date(Date.UTC(Number(year), Number(month)-1, Number(day), 10, 0));
assert.equal(utcEvent.date, `${expectedLocal.getFullYear()}-${String(expectedLocal.getMonth()+1).padStart(2,'0')}-${String(expectedLocal.getDate()).padStart(2,'0')}`);
assert.equal(utcEvent.start, `${String(expectedLocal.getHours()).padStart(2,'0')}:${String(expectedLocal.getMinutes()).padStart(2,'0')}`);

const nextWorkday = new Date();
nextWorkday.setHours(12,0,0,0);
do { nextWorkday.setDate(nextWorkday.getDate()+1); } while (nextWorkday.getDay() === 0 || nextWorkday.getDay() === 6);
const futureKey = `${nextWorkday.getFullYear()}-${String(nextWorkday.getMonth()+1).padStart(2,'0')}-${String(nextWorkday.getDate()).padStart(2,'0')}`;
const event = { id: 'cal-conflict-event', uid: 'busy', date: futureKey, start: '10:00', end: '11:00', subject: 'Busy', type: 'Calendar', allDay: false, transparent: false };
qa.setData({ tasks: [], focus: { sessions: [] }, university: { events: [] }, externalCalendars: [{ id: 'calendar-1', name: 'Work', provider: 'google', sourceType: 'file', enabled: true, events: [event] }] });
assert.equal(qa.calendarConflict(futureKey, 600, 630).id, event.id, 'Opaque external event blocks manual planning');
assert.match(qa.validateManualSlot({ id: 'new-task', deadline: null }, futureKey, '10:00', 30), /В это время занято: Busy/);
const allItems = qa.allCalendarEventsForDate(futureKey);
assert.equal(allItems.length, 1);
assert.equal(allItems[0].calendarKind, 'external');

qa.setData({ tasks: [], focus: { sessions: [] }, university: { events: [] }, externalCalendars: [{ id: 'calendar-2', name: 'Optional', enabled: true, events: [{ ...event, id: 'transparent', transparent: true }] }] });
assert.equal(qa.calendarConflict(futureKey, 600, 630), null, 'Transparent events do not block manual planning');
qa.setData({ tasks: [{ id: 'keep', title: 'Keep', duration: 30, priority: 2 }], focus: { sessions: [] }, university: { events: [] }, externalCalendars: [{ id: 'file-1', name: 'Imported', sourceType: 'file', provider: 'ics', events: [event] }] });
const backup = qa.normalizeData(qa.getData());
assert.equal(backup.externalCalendars.length, 1, 'External calendar survives normalize/export shape');
assert.equal(backup.tasks[0].title, 'Keep', 'Calendar data does not overwrite tasks');
const legacyBackup = qa.normalizeData({ tasks: [], focus: { sessions: [] }, university: { events: [] } });
assert.deepEqual(Array.from(legacyBackup.externalCalendars), [], 'Old v17 backups remain compatible');

// Refreshing a feed must preserve stable event identifiers so task links survive.
const feedEventDate = futureKey.replace(/-/g, '');
const feedIcs = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:stable-feed-event\nDTSTART:${feedEventDate}T120000\nDTEND:${feedEventDate}T130000\nSUMMARY:Stable feed event\nEND:VEVENT\nEND:VCALENDAR`;
const feedCalendar = { id: 'feed-stable', name: 'Stable feed', provider: 'google', sourceType: 'feed', feedUrl: 'https://calendar.google.com/calendar/ical/demo/basic.ics', enabled: true, events: [] };
const baseFeedEvent = qa.parseExternalCalendarIcs(feedIcs).events[0];
feedCalendar.events = [{ ...baseFeedEvent, id: `${feedCalendar.id}-${baseFeedEvent.id}`, calendarId: feedCalendar.id, calendarName: feedCalendar.name }];
const stableFeedId = feedCalendar.events[0].id;
qa.setData({ tasks: [{ id: 'linked-feed-task', title: 'Task linked to feed', duration: 30, priority: 2, deadline: futureKey, linkedUniversityEventId: stableFeedId }], focus: { sessions: [] }, university: { events: [] }, externalCalendars: [feedCalendar] });
context.navigator.onLine = true;
context.window.TAVRIMO_CONFIG = { calendarFeedEndpoint: 'https://gateway.example/api/calendar/feed' };
context.fetch = async () => new Response(JSON.stringify({ ics: feedIcs }), { status: 200, headers: { 'content-type': 'application/json' } });
assert.equal(await qa.refreshExternalCalendarById(feedCalendar.id, { silent: true }), true);
assert.equal(qa.getData().externalCalendars[0].events[0].id, stableFeedId, 'Feed refresh must not change event ids');
assert.equal(qa.getData().tasks[0].linkedUniversityEventId, stableFeedId, 'A task link remains valid after refresh');

console.log('External calendar and personalized greeting tests passed.');
