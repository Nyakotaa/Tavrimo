const MAX_ICS_BYTES = 2 * 1024 * 1024;
const ALLOWED_HOSTS = new Set([
  'calendar.google.com',
  'outlook.office365.com',
  'outlook.live.com',
  'caldav.icloud.com'
]);

function isAllowedHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return ALLOWED_HOSTS.has(host) || /^p\d+-caldav\.icloud\.com$/.test(host);
}

export function validateCalendarFeedUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim().replace(/^webcal:/i, 'https:')); }
  catch { throw Object.assign(new Error('Некорректная ссылка календаря.'), { code: 'INVALID_CALENDAR_URL' }); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !isAllowedHost(url.hostname)) {
    throw Object.assign(new Error('Поддерживаются только HTTPS iCalendar-ссылки Google Calendar, Outlook и iCloud.'), { code: 'INVALID_CALENDAR_URL' });
  }
  if (url.href.length > 2000) throw Object.assign(new Error('Ссылка календаря слишком длинная.'), { code: 'INVALID_CALENDAR_URL' });
  return url;
}

async function readResponseLimited(response, maxBytes) {
  const declared = Number(response.headers?.get?.('content-length') || 0);
  if (declared > maxBytes) throw Object.assign(new Error('Календарь превышает лимит 2 МБ.'), { code: 'CALENDAR_TOO_LARGE' });
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw Object.assign(new Error('Календарь превышает лимит 2 МБ.'), { code: 'CALENDAR_TOO_LARGE' });
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock?.(); }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: false }).decode(combined);
}

export async function fetchCalendarFeed(value, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = Math.max(1000, Math.min(30000, Number(options.timeoutMs) || 12000));
  const maxBytes = Math.max(1024, Math.min(MAX_ICS_BYTES, Number(options.maxBytes) || MAX_ICS_BYTES));
  const redirectValue = Number(options.maxRedirects);
  const maxRedirects = Number.isFinite(redirectValue) ? Math.max(0, Math.min(5, redirectValue)) : 3;
  if (typeof fetchImpl !== 'function') throw new Error('Сервер не поддерживает загрузку календарей.');

  let url = validateCalendarFeedUrl(value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response = null;
    for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
      response = await fetchImpl(url.href, {
        method: 'GET',
        redirect: 'manual',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          Accept: 'text/calendar, text/plain;q=0.9, application/octet-stream;q=0.5',
          'User-Agent': 'Tavrimo-Calendar-Reader/12.3'
        }
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      if (redirect === maxRedirects) throw Object.assign(new Error('Слишком много перенаправлений при загрузке календаря.'), { code: 'CALENDAR_REDIRECT_LIMIT' });
      const location = response.headers?.get?.('location');
      await response.body?.cancel?.().catch(() => {});
      if (!location) throw Object.assign(new Error('Источник календаря вернул некорректное перенаправление.'), { code: 'CALENDAR_REDIRECT_INVALID' });
      url = validateCalendarFeedUrl(new URL(location, url).href);
    }

    if (!response?.ok) throw Object.assign(new Error(`Источник календаря вернул HTTP ${response?.status || 502}.`), { code: 'CALENDAR_UPSTREAM_ERROR', upstreamStatus: response?.status || 502 });
    const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
    if (contentType && !/(calendar|text\/plain|octet-stream|application\/ics)/i.test(contentType)) {
      throw Object.assign(new Error('Источник вернул не файл календаря iCalendar.'), { code: 'CALENDAR_NOT_ICS' });
    }
    const text = (await readResponseLimited(response, maxBytes)).replace(/^\uFEFF/, '').trim();
    if (!/^BEGIN:VCALENDAR\b/i.test(text) || !/END:VCALENDAR\s*$/i.test(text)) {
      throw Object.assign(new Error('По этой ссылке не найден календарь в формате iCalendar.'), { code: 'CALENDAR_NOT_ICS' });
    }
    return text;
  } catch (error) {
    if (error?.name === 'AbortError') throw Object.assign(new Error('Источник календаря не ответил за 12 секунд.'), { code: 'CALENDAR_TIMEOUT' });
    throw error;
  } finally { clearTimeout(timer); }
}
