import assert from 'node:assert/strict';
import { fetchCalendarFeed, validateCalendarFeedUrl } from './calendar-feed.mjs';

assert.equal(validateCalendarFeedUrl('https://calendar.google.com/calendar/ical/test/basic.ics').hostname, 'calendar.google.com');
assert.equal(validateCalendarFeedUrl('webcal://p12-caldav.icloud.com/published/2/secret').hostname, 'p12-caldav.icloud.com');
assert.throws(() => validateCalendarFeedUrl('http://calendar.google.com/calendar.ics'), /HTTPS/);
assert.throws(() => validateCalendarFeedUrl('https://example.com/calendar.ics'), /Google Calendar/);
assert.throws(() => validateCalendarFeedUrl('https://calendar.google.com.evil.example/calendar.ics'), /Google Calendar/);
assert.throws(() => validateCalendarFeedUrl('https://user:pass@calendar.google.com/calendar.ics'), /Google Calendar/);
assert.throws(() => validateCalendarFeedUrl('https://127.0.0.1/calendar.ics'), /Google Calendar/);

const validIcs = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nSUMMARY:Test\r\nEND:VEVENT\r\nEND:VCALENDAR';
const direct = await fetchCalendarFeed('https://calendar.google.com/calendar/ical/demo/basic.ics', {
  fetchImpl: async (url, options) => {
    assert.match(url, /^https:\/\/calendar\.google\.com\//);
    assert.equal(options.redirect, 'manual');
    return new Response(validIcs, { status: 200, headers: { 'content-type': 'text/calendar' } });
  }
});
assert.equal(direct, validIcs);

let redirects = 0;
const redirected = await fetchCalendarFeed('https://outlook.office365.com/calendar.ics', {
  fetchImpl: async (url) => {
    redirects += 1;
    if (redirects === 1) return new Response('', { status: 302, headers: { location: 'https://outlook.live.com/calendar.ics' } });
    return new Response(validIcs, { status: 200, headers: { 'content-type': 'text/calendar' } });
  }
});
assert.equal(redirected, validIcs);
assert.equal(redirects, 2, 'Allowed provider redirects are followed after re-validation');

await assert.rejects(() => fetchCalendarFeed('https://calendar.google.com/calendar.ics', {
  fetchImpl: async () => new Response('', { status: 302, headers: { location: 'http://127.0.0.1/admin' } })
}), /HTTPS/);
await assert.rejects(() => fetchCalendarFeed('https://calendar.google.com/calendar.ics', {
  fetchImpl: async () => new Response('<html>login</html>', { status: 200, headers: { 'content-type': 'text/html' } })
}), /не файл календаря/);
await assert.rejects(() => fetchCalendarFeed('https://calendar.google.com/calendar.ics', {
  maxBytes: 1024,
  fetchImpl: async () => new Response(`BEGIN:VCALENDAR\n${'x'.repeat(1600)}\nEND:VCALENDAR`, { status: 200, headers: { 'content-type': 'text/calendar' } })
}), /2 МБ/);
console.log('Calendar feed security and upstream-fetch tests passed.');
