import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATIC_DIR = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);
const UPSTREAM = 'https://rasp.rea.ru/';
const CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_LIMIT_WINDOW = 60_000;
const REQUEST_LIMIT = 20;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, If-None-Match');
  res.setHeader('Access-Control-Expose-Headers', 'ETag');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
app.use(express.json({ limit: '32kb' }));

const cache = new Map();
const ipWindows = new Map();
const inflightByGroup = new Map();
let browserPromise = null;

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function allowedGroup(group) {
  const value = String(group || '').trim();
  return value.length >= 2 && value.length <= 80 && /^[0-9A-Za-zА-Яа-яЁё._/\\-\s]+$/.test(value);
}

function rateLimit(req, res, next) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const current = ipWindows.get(ip) || { start: now, count: 0 };
  if (now - current.start > REQUEST_LIMIT_WINDOW) { current.start = now; current.count = 0; }
  current.count += 1; ipWindows.set(ip, current);
  if (current.count > REQUEST_LIMIT) return res.status(429).json({ error: 'Слишком много запросов. Попробуйте позже.' });
  next();
}

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding'
      ]
    }).catch((error) => { browserPromise = null; throw error; });
  }
  return browserPromise;
}

async function clickIfVisible(locator) {
  try {
    if (await locator.count() && await locator.first().isVisible()) { await locator.first().click({ timeout: 3000 }); return true; }
  } catch { /* ignore */ }
  return false;
}

const LESSON_TYPE_PATTERNS = [
  /Диф\.?\s*зачет/i,
  /Лабораторная работа/i,
  /Практическое занятие/i,
  /Курсовая работа/i,
  /Самостоятельная работа/i,
  /Лекция/i,
  /Семинар/i,
  /Экзамен/i,
  /Зачет/i,
  /Практика/i
];

function cleanText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t\r]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeIcs(value) {
  return cleanText(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function formatIcsDateTime(dateKey, hhmm) {
  const [year, month, day] = dateKey.split('-');
  const [hour, minute] = hhmm.split(':');
  return `${year}${month}${day}T${hour}${minute}00`;
}

function dateKeyFromRuDate(value) {
  const [day, month, year] = String(value || '').split('.');
  if (!day || !month || !year) return null;
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const parsed = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

function parseLessonDetails(rawDetails) {
  let details = cleanText(rawDetails)
    .replace(/^(?:\||·)+/, '')
    .trim();
  if (!details) return null;

  let type = '';
  let typeIndex = -1;
  for (const pattern of LESSON_TYPE_PATTERNS) {
    const match = pattern.exec(details);
    if (match && (typeIndex < 0 || match.index < typeIndex)) {
      typeIndex = match.index;
      type = cleanText(match[0]);
    }
  }

  const subject = cleanText(typeIndex >= 0 ? details.slice(0, typeIndex) : details)
    .replace(/^[-–—:]+/, '')
    .trim();
  let tail = typeIndex >= 0 ? cleanText(details.slice(typeIndex + type.length)) : '';

  let room = '';
  let teacher = '';
  const roomMatch = tail.match(/((?:\d+\s+)?корпус\s*[-–—]?\s*[^,;]+|ауд(?:итория)?\.?\s*[^,;]+)/i);
  if (roomMatch) {
    room = cleanText(roomMatch[1]);
    tail = cleanText(`${tail.slice(0, roomMatch.index)} ${tail.slice(roomMatch.index + roomMatch[0].length)}`);
  }

  const teacherMatch = tail.match(/(?:преподаватель|преподаватель:|преподаватели:)\s*([^,;]+)/i);
  if (teacherMatch) {
    teacher = cleanText(teacherMatch[1]);
  } else {
    // Common compact export form: teacher names can appear after "пл." or at the end.
    const named = tail.match(/(?:^|[;|])\s*([А-ЯЁ][А-ЯЁа-яё\-]+\s+[А-ЯЁ]\.?\s*[А-ЯЁ]\.?)(?:$|[;|])/u);
    if (named) teacher = cleanText(named[1]);
  }

  if (!subject) return null;
  return { subject, type, room, teacher };
}

function parseScheduleText(text) {
  const normalized = String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return [];

  const dayHeader = /(ПОНЕДЕЛЬНИК|ВТОРНИК|СРЕДА|ЧЕТВЕРГ|ПЯТНИЦА|СУББОТА|ВОСКРЕСЕНЬЕ)\s*,?\s*(\d{1,2}\.\d{1,2}\.\d{4})/gi;
  const headers = [...normalized.matchAll(dayHeader)];
  const events = [];
  if (!headers.length) return events;

  const periodPattern = /(\d{1,2})\s*пара\s+(\d{1,2}:\d{2})\s*(?:[-–—]\s*)?(\d{1,2}:\d{2})\s+([\s\S]*?)(?=\s+\d{1,2}\s*пара\s+\d{1,2}:\d{2}|\s+(?:ПОНЕДЕЛЬНИК|ВТОРНИК|СРЕДА|ЧЕТВЕРГ|ПЯТНИЦА|СУББОТА|ВОСКРЕСЕНЬЕ)\s*,?\s*\d{1,2}\.\d{1,2}\.\d{4}|$)/gi;

  for (let i = 0; i < headers.length; i += 1) {
    const header = headers[i];
    const dateKey = dateKeyFromRuDate(header[2]);
    if (!dateKey) continue;
    const start = header.index + header[0].length;
    const end = i + 1 < headers.length ? headers[i + 1].index : normalized.length;
    const section = normalized.slice(start, end);
    for (const match of section.matchAll(periodPattern)) {
      const lesson = parseLessonDetails(match[4]);
      if (!lesson) continue;
      const slot = Number(match[1]);
      const startTime = match[2];
      const endTime = match[3];
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) continue;
      events.push({
        id: hash(`${dateKey}|${slot}|${startTime}|${endTime}|${lesson.subject}|${lesson.teacher}|${lesson.room}`).slice(0, 20),
        date: dateKey,
        slot,
        start: startTime,
        end: endTime,
        ...lesson
      });
    }
  }

  const seen = new Set();
  return events.filter((event) => {
    const key = `${event.date}|${event.start}|${event.end}|${event.subject}|${event.teacher}|${event.room}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scheduleEventsToIcs(group, events) {
  const now = new Date();
  const dtstamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tavrimo//REA Live Sync//RU',
    `X-WR-CALNAME:Tavrimo — ${cleanText(group)}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-TIMEZONE:Europe/Moscow'
  ];

  for (const event of events) {
    const summary = event.subject || 'Занятие';
    const description = [
      event.type ? `Тип: ${event.type}` : '',
      event.teacher ? `Преподаватель: ${event.teacher}` : '',
      `Группа: ${group}`
    ].filter(Boolean).join('\\n');
    const location = event.room || '';
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:tavrimo-rea-${event.id}@tavrimo`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART;TZID=Europe/Moscow:${formatIcsDateTime(event.date, event.start)}`);
    lines.push(`DTEND;TZID=Europe/Moscow:${formatIcsDateTime(event.date, event.end)}`);
    lines.push(`SUMMARY:${escapeIcs(summary)}`);
    if (description) lines.push(`DESCRIPTION:${escapeIcs(description)}`);
    if (location) lines.push(`LOCATION:${escapeIcs(location)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

async function extractClientGeneratedCalendar(page) {
  return page.evaluate(async () => {
    const candidates = [];
    const pushText = (value) => {
      if (typeof value === 'string' && /BEGIN:VCALENDAR/i.test(value)) candidates.push(value);
    };

    for (const url of (window.__tavrimoBlobUrls || [])) {
      try { pushText(await (await fetch(url)).text()); } catch { /* ignore */ }
    }
    for (const item of (window.__tavrimoDownloads || [])) {
      try {
        const href = String(item?.href || '');
        if (href.startsWith('blob:') || href.startsWith('data:')) pushText(await (await fetch(href)).text());
      } catch { /* ignore */ }
    }
    for (const anchor of Array.from(document.querySelectorAll('a[download], a[href^="blob:"], a[href^="data:"]'))) {
      try {
        const href = String(anchor.href || '');
        if (href.startsWith('blob:') || href.startsWith('data:')) pushText(await (await fetch(href)).text());
      } catch { /* ignore */ }
    }

    for (const store of [window.localStorage, window.sessionStorage]) {
      try {
        for (let i = 0; i < store.length; i += 1) {
          const value = store.getItem(store.key(i));
          pushText(value);
        }
      } catch { /* ignore */ }
    }
    return candidates.find((value) => /BEGIN:VCALENDAR/i.test(value)) || '';
  });
}

async function discoverCalendarUrls(page, context) {
  const hrefs = await page.locator('a[href], form[action], [data-url], [data-href]').evaluateAll((els) => els.map((el) => ({
    href: el.href || el.action || el.dataset?.url || el.dataset?.href || '',
    text: (el.textContent || '').trim(),
    onclick: el.getAttribute('onclick') || ''
  })));
  const performanceUrls = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name));
  const scripts = await page.evaluate(() => Array.from(document.scripts).map((s) => s.src).filter(Boolean));
  const candidates = [...hrefs.map((x) => x.href), ...performanceUrls]
    .filter((url) => /calendar|ical|ics|export|выгруз/i.test(String(url)) && !String(url).startsWith('blob:'));

  // Inspect loaded same-origin scripts for literal export endpoints when the site builds them dynamically.
  for (const scriptUrl of scripts.slice(0, 30)) {
    try {
      const source = await (await context.request.get(scriptUrl, { timeout: 10_000 })).text();
      const matches = source.match(/['"`]([^'"`]{0,220}(?:calendar|ical|ics|export)[^'"`]{0,220})['"`]/gi) || [];
      for (const raw of matches) {
        const candidate = raw.slice(1, -1);
        if (/^https?:\/\//i.test(candidate)) candidates.push(candidate);
        else if (candidate.startsWith('/')) candidates.push(new URL(candidate, UPSTREAM).href);
      }
    } catch { /* best effort */ }
  }
  return [...new Set(candidates)];
}

async function downloadOfficialIcs(group) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
    acceptDownloads: true,
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  const icsCandidates = [];
  const resourceCandidates = new Set();
  const networkCandidates = new Set();

  await page.addInitScript(() => {
    window.__tavrimoBlobUrls = [];
    window.__tavrimoDownloads = [];
    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (object) {
      const url = originalCreateObjectURL(object);
      try { window.__tavrimoBlobUrls.push(url); } catch { /* ignore */ }
      return url;
    };
    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      try { window.__tavrimoDownloads.push({ href: this.href || '', download: this.download || '' }); } catch { /* ignore */ }
      return originalAnchorClick.call(this);
    };
  });

  await page.route('**/*', async (route) => {
    const type = route.request().resourceType();
    if (['image', 'media', 'font'].includes(type)) return route.abort();
    return route.continue();
  });

  page.on('request', (request) => {
    const url = request.url();
    if (/calendar|ical|ics|export|schedule|raspis|выгруз/i.test(url)) networkCandidates.add(url);
  });
  const captureResponse = async (response) => {
    try {
      const url = response.url();
      const ct = String(response.headers()['content-type'] || '').toLowerCase();
      if (ct.includes('text/calendar') || ct.includes('application/ics') || /\.(ics|ical)(?:$|[?#])/i.test(url)) {
        const body = await response.body();
        const textBody = body.toString('utf8');
        if (/BEGIN:VCALENDAR/i.test(textBody)) icsCandidates.push({ url, text: textBody });
      }
      if (response.request().resourceType() === 'xhr' || response.request().resourceType() === 'fetch') {
        if (/calendar|ical|ics|export|schedule|raspis|выгруз/i.test(url)) resourceCandidates.add(url);
      }
    } catch { /* best effort */ }
  };
  page.on('response', captureResponse);

  try {
    await page.goto(UPSTREAM, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    const candidateSelectors = [
      'input[placeholder*="групп" i]',
      'input[placeholder*="номер" i]',
      'input[type="search"]',
      'input[type="text"]',
      'input:not([type])'
    ];
    let input = null;
    for (const selector of candidateSelectors) {
      const locator = page.locator(selector);
      const count = await locator.count();
      for (let i = 0; i < Math.min(count, 8); i += 1) {
        const candidate = locator.nth(i);
        if (await candidate.isVisible().catch(() => false)) { input = candidate; break; }
      }
      if (input) break;
    }
    if (!input) throw new Error('На портале не найдено поле поиска группы.');
    await input.fill(group);
    await input.press('Enter').catch(() => {});
    await page.waitForTimeout(800);

    const exact = page.getByText(group, { exact: true });
    if (await exact.count()) {
      for (let i = 0; i < Math.min(await exact.count(), 10); i += 1) {
        const item = exact.nth(i);
        if (await item.isVisible().catch(() => false)) {
          await item.click({ timeout: 3_000 }).catch(() => {});
          break;
        }
      }
    }

    await page.waitForFunction((groupCode) => {
      const body = document.body?.innerText || '';
      return body.includes(groupCode) && (/Экспорт расписания в календарь/i.test(body) || /Подробности/i.test(body));
    }, group, { timeout: 25_000 }).catch(() => {});

    // The portal can start in an offline/stale state, but still exposes the refresh button.
    const refreshes = page.getByRole('button', { name: /обновить/i });
    for (let i = 0; i < await refreshes.count(); i += 1) {
      const item = refreshes.nth(i);
      if (await item.isVisible().catch(() => false)) {
        await item.click({ timeout: 3_000 }).catch(() => {});
        await page.waitForTimeout(2_500);
        break;
      }
    }

    // Prefer the explicit export controls, but capture both browser downloads and client-generated blobs.
    const exportText = page.getByText('Экспорт расписания в календарь', { exact: false }).last();
    if (await exportText.count() && await exportText.isVisible().catch(() => false)) {
      await exportText.click({ timeout: 3_000 }).catch(() => {});
      await page.waitForTimeout(300);
    }

    const rangeLabels = page.locator('label').filter({ hasText: /За всё время/i });
    if (await rangeLabels.count()) await rangeLabels.last().click().catch(() => {});
    const rangeInputs = page.locator('input[type="radio"]');
    const checkedInput = await page.locator('label', { hasText: /За всё время/i }).last().locator('input').count().catch(() => 0);
    if (checkedInput) await page.locator('label', { hasText: /За всё время/i }).last().locator('input').check().catch(() => {});
    await page.waitForTimeout(200);

    const downloadPromise = page.waitForEvent('download', { timeout: 12_000 }).catch(() => null);
    const exportButton = page.getByRole('button', { name: /выгрузить/i }).last();
    if (await exportButton.count() && await exportButton.isVisible().catch(() => false)) {
      await exportButton.click({ timeout: 5_000 }).catch(() => {});
    } else {
      // Last resort: click any visible element containing the export action text.
      const clickable = page.locator('button, [role="button"], a').filter({ hasText: /выгрузить/i }).last();
      if (await clickable.count()) await clickable.evaluate((el) => el.click()).catch(() => {});
    }

    const download = await downloadPromise;
    if (download) {
      const stream = await download.createReadStream();
      const chunks = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString('utf8');
      if (/BEGIN:VCALENDAR/i.test(body)) return body;
    }

    await page.waitForTimeout(1_000);
    if (icsCandidates.length) return icsCandidates[icsCandidates.length - 1].text;

    const generatedCalendar = await extractClientGeneratedCalendar(page).catch(() => '');
    if (/BEGIN:VCALENDAR/i.test(generatedCalendar)) return generatedCalendar;

    const directUrls = await discoverCalendarUrls(page, context);
    for (const url of [...new Set([...directUrls, ...resourceCandidates, ...networkCandidates])]) {
      try {
        const response = await context.request.get(url, { timeout: 15_000, failOnStatusCode: false });
        const body = await response.body();
        const candidate = body.toString('utf8');
        if (response.ok() && /BEGIN:VCALENDAR/i.test(candidate)) return candidate;
      } catch { /* continue */ }
    }

    // Robust fallback: the current portal renders the timetable in the page itself.
    // When its download button is client-only, parse the rendered day/period text and build a standards-compliant ICS.
    const visibleText = await page.locator('body').innerText().catch(() => '');
    const events = parseScheduleText(visibleText);
    if (events.length) {
      return scheduleEventsToIcs(group, events);
    }

    const title = await page.title().catch(() => '');
    throw new Error(`Портал РЭУ открыл расписание, но календарь не выгружается и расписание не удалось разобрать. Страница: ${title || 'без заголовка'}. ${cleanText(visibleText).slice(0, 1200)}`);
  } finally {
    page.removeListener('response', captureResponse);
    await context.close();
  }
}

app.get('/api/rea/health', (_req, res) => {
  const executablePath = chromium.executablePath();
  const executableExists = fs.existsSync(executablePath);
  const ok = executableExists;
  res.status(ok ? 200 : 503).json({
    ok,
    source: UPSTREAM,
    cacheTtlMinutes: CACHE_TTL_MS / 60000,
    runtime: 'playwright',
    browserReady: Boolean(browserPromise),
    executableExists,
    executablePath
  });
});

app.get('/api/rea/schedule', rateLimit, async (req, res) => {
  const group = String(req.query.group || '').trim();
  res.set('Cache-Control', 'no-store');
  if (!allowedGroup(group)) return res.status(400).json({ error: 'Укажите корректный номер группы.' });
  const key = group.toLowerCase();
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    if (req.headers['if-none-match'] === cached.etag) return res.status(304).end();
    res.set('ETag', cached.etag);
    return res.json({ ics: cached.ics, hash: cached.etag, fetchedAt: new Date(cached.fetchedAt).toISOString(), source: UPSTREAM });
  }

  try {
    const existing = inflightByGroup.get(key);
    const fetchPromise = existing || (async () => {
      const ics = await downloadOfficialIcs(group);
      if (!/^BEGIN:VCALENDAR/i.test(ics.trim())) throw new Error('Получен ответ не в формате iCalendar.');
      const etag = `"${hash(ics)}"`;
      const fetchedAt = Date.now();
      cache.set(key, { ics, etag, fetchedAt });
      return { ics, etag, fetchedAt };
    })();
    if (!existing) inflightByGroup.set(key, fetchPromise);
    const fresh = await fetchPromise;
    if (inflightByGroup.get(key) === fetchPromise) inflightByGroup.delete(key);
    if (req.headers['if-none-match'] === fresh.etag) return res.status(304).end();
    res.set('ETag', fresh.etag);
    return res.json({ ics: fresh.ics, hash: fresh.etag, fetchedAt: new Date(fresh.fetchedAt).toISOString(), source: UPSTREAM });
  } catch (error) {
    if (inflightByGroup.get(key)) inflightByGroup.delete(key);
    console.error(`[REA_SYNC_502] group=${group} error=${String(error?.stack || error?.message || error)}`);
    return res.status(502).json({
      error: String(error?.message || 'Не удалось получить расписание РЭУ.'),
      code: 'REA_UPSTREAM_UNAVAILABLE'
    });
  }
});

app.use(express.static(STATIC_DIR, { extensions: ['html'] }));
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API route not found.' });
  res.sendFile(path.join(STATIC_DIR, 'index.html'));
});

const server = app.listen(PORT, () => console.log(`Tavrimo REA Sync Gateway listening on :${PORT}`));

function shutdown() {
  server.close(async () => { try { const browser = browserPromise && await browserPromise; await browser?.close(); } catch {} process.exit(0); });
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
