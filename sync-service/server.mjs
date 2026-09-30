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
  const timePattern = /(\d{1,2}:\d{2})\s*(?:[-–—]\s*)?(\d{1,2}:\d{2})/g;
  const officialSlots = new Map([
    ['08:30|10:00', 1], ['10:10|11:40', 2], ['11:50|13:20', 3], ['14:00|15:30', 4],
    ['15:40|17:10', 5], ['17:20|18:50', 6], ['18:55|20:25', 7], ['20:30|22:00', 8]
  ]);

  for (let i = 0; i < headers.length; i += 1) {
    const header = headers[i];
    const dateKey = dateKeyFromRuDate(header[2]);
    if (!dateKey) continue;
    const start = header.index + header[0].length;
    const end = i + 1 < headers.length ? headers[i + 1].index : normalized.length;
    const section = normalized.slice(start, end);

    // First, use the most precise representation when the portal exposes the slot number.
    for (const match of section.matchAll(periodPattern)) {
      const lesson = parseLessonDetails(match[4]);
      if (!lesson) continue;
      const startTime = match[2];
      const endTime = match[3];
      const mappedSlot = officialSlots.get(`${startTime}|${endTime}`);
      const slot = mappedSlot || Number(match[1]);
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) continue;
      events.push({
        id: hash(`${dateKey}|${slot}|${startTime}|${endTime}|${lesson.subject}|${lesson.teacher}|${lesson.room}`).slice(0, 20),
        date: dateKey, slot, start: startTime, end: endTime, ...lesson
      });
    }

    // The current portal also renders period labels and lesson cells separately. In that
    // layout the text reads like "1 пара 2 пара 11:50 13:20 Предмет ...". Recover the
    // actual lesson from every visible time pair and map standard REA bell times to a slot.
    {
      const matches = [...section.matchAll(timePattern)];
      for (let j = 0; j < matches.length; j += 1) {
        const startTime = matches[j][1];
        const endTime = matches[j][2];
        const key = `${startTime}|${endTime}`;
        const slot = officialSlots.get(key);
        if (!slot) continue;
        const contentStart = matches[j].index + matches[j][0].length;
        const contentEnd = j + 1 < matches.length ? matches[j + 1].index : section.length;
        let detailsText = section.slice(contentStart, contentEnd)
          .replace(/^\s*(?:\d{1,2}\s*пара\s*)+/i, '')
          .replace(/\s+(?:Подробнее|Подробности|Экспорт расписания в календарь|Выберите экспортируемый диапазон|Экспортируемые типы занятий).*$/i, '')
          .trim();
        // Ignore isolated UI times and avoid swallowing the next day/portal navigation.
        if (!detailsText || /^(?:Сегодня|Назад|Далее|Обновить|Закрыть)$/i.test(detailsText)) continue;
        const lesson = parseLessonDetails(detailsText);
        if (!lesson) continue;
        events.push({
          id: hash(`${dateKey}|${slot}|${startTime}|${endTime}|${lesson.subject}|${lesson.teacher}|${lesson.room}`).slice(0, 20),
          date: dateKey, slot, start: startTime, end: endTime, ...lesson
        });
      }
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


async function clickPortalRefresh(page) {
  const buttons = [
    page.getByRole('button', { name: /^обновить$/i }),
    page.locator('button[title*="обновить" i], button[aria-label*="обновить" i]'),
    page.locator('[role="button"]').filter({ hasText: /^обновить$/i })
  ];
  for (const locator of buttons) {
    const count = await locator.count();
    for (let i = 0; i < count; i += 1) {
      const button = locator.nth(i);
      if (await button.isVisible().catch(() => false)) {
        await button.click({ timeout: 4_000 }).catch(() => {});
        await page.waitForTimeout(1_500);
        return true;
      }
    }
  }
  return false;
}

async function clickPortalSearch(page, input) {
  const selectors = [
    'button[aria-label*="поиск" i]',
    'button[title*="поиск" i]',
    'button[aria-label*="search" i]',
    'button[title*="search" i]',
    '[role="button"][aria-label*="поиск" i]',
    '[role="button"][title*="поиск" i]',
    '[role="button"][aria-label*="search" i]',
    '[role="button"][title*="search" i]',
    'form button[type="submit"]',
    'input[type="submit"]'
  ];
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = Math.min(await locator.count(), 10);
    for (let i = 0; i < count; i += 1) {
      const button = locator.nth(i);
      if (!await button.isVisible().catch(() => false)) continue;
      await button.click({ timeout: 4_000 }).catch(() => {});
      return true;
    }
  }
  const iconCandidates = page.locator('.material-icons, i, span').filter({ hasText: /^search$/i });
  for (let i = 0; i < Math.min(await iconCandidates.count(), 20); i += 1) {
    const button = iconCandidates.nth(i);
    if (!await button.isVisible().catch(() => false)) continue;
    await button.click({ timeout: 4_000 }).catch(() => {});
    return true;
  }
  await input.press('Enter').catch(() => {});
  return false;
}

async function selectGroupTab(page) {
  const candidates = [
    page.getByText('Группы', { exact: true }),
    page.locator('[role="tab"]').filter({ hasText: /^Группы$/i }),
    page.locator('button, a, [role="button"]').filter({ hasText: /^Группы$/i })
  ];
  for (const locator of candidates) {
    const count = Math.min(await locator.count(), 10);
    for (let i = 0; i < count; i += 1) {
      const item = locator.nth(i);
      if (!await item.isVisible().catch(() => false)) continue;
      await item.click({ timeout: 3_000 }).catch(() => {});
      await page.waitForTimeout(250);
      return true;
    }
  }
  return false;
}

async function selectGroupOption(page, group) {
  const normalize = (value) => String(value || '')
    .toLocaleLowerCase('ru-RU')
    .replace(/[–—−]/g, '-')
    .replace(/ё/g, 'е')
    .replace(/[^0-9a-zа-я]+/gi, '');
  const target = normalize(group);
  const selects = page.locator('select');
  for (let i = 0; i < Math.min(await selects.count(), 12); i += 1) {
    const select = selects.nth(i);
    if (!await select.isVisible().catch(() => false)) continue;
    const options = await select.locator('option').evaluateAll((els) => els.map((el) => ({ value: el.value, text: el.textContent || '' }))).catch(() => []);
    const hit = options.find((o) => normalize(o.text) === target || normalize(o.value) === target);
    if (hit) {
      await select.selectOption(hit.value).catch(() => {});
      await page.waitForTimeout(700);
      return true;
    }
  }
  return false;
}


async function pageHasTimetable(page) {
  const body = cleanText(await page.locator('body').innerText().catch(() => ''));
  const day = /(ПОНЕДЕЛЬНИК|ВТОРНИК|СРЕДА|ЧЕТВЕРГ|ПЯТНИЦА|СУББОТА|ВОСКРЕСЕНЬЕ)/i.test(body);
  const datedDay = /(?:ПОНЕДЕЛЬНИК|ВТОРНИК|СРЕДА|ЧЕТВЕРГ|ПЯТНИЦА|СУББОТА|ВОСКРЕСЕНЬЕ)\s*,?\s*\d{1,2}\.\d{1,2}\.\d{4}/i.test(body);
  const time = /\d{1,2}:\d{2}\s*(?:[-–—]\s*)\d{1,2}:\d{2}/.test(body);
  const lessonLike = /(\d{1,2}\s*пара|Лекция|Практическое занятие|Семинар|Лабораторная работа|Зачет|Экзамен)/i.test(body);
  const offlineSearchOnly = /Найденные результаты/i.test(body) && !datedDay && !time;
  return Boolean(day && time && lessonLike && !offlineSearchOnly);
}

async function findGroupInResults(page, group) {
  const normalize = (value) => String(value || '')
    .toLowerCase()
    .replace(/[–—−]/g, '-')
    .replace(/ё/g, 'е')
    .replace(/[^0-9a-zа-я]+/gi, '');
  const target = normalize(group);
  const selectors = [
    'a', 'button', 'li', '[role="option"]', '[role="link"]'
  ];
  for (const selector of selectors) {
    const candidates = page.locator(selector);
    const count = Math.min(await candidates.count(), 300);
    for (let i = 0; i < count; i += 1) {
      const item = candidates.nth(i);
      if (!await item.isVisible().catch(() => false)) continue;
      const text = cleanText(await item.innerText().catch(() => ''));
      const compact = normalize(text);
      if (!compact || compact.length > 180) continue;
      if (compact === target || compact.includes(target)) {
        await item.scrollIntoViewIfNeeded().catch(() => {});
        await item.click({ timeout: 4_000 }).catch(async () => { await item.evaluate((el) => el.click()).catch(() => {}); });
        await page.waitForTimeout(1_200);
        if (await pageHasTimetable(page)) return true;
      }
    }
  }
  return false;
}


async function tryDirectGroupUrl(page, group) {
  const raw = String(group || '').trim();
  const variants = [
    raw,
    raw.replace(/[–—−]/g, '-'),
    raw.replace(/[–—−]/g, '-').replace(/\s+/g, ' '),
    raw.replace(/[–—−]/g, '-').replace(/\s+/g, '')
  ];
  for (const variant of [...new Set(variants)].slice(0, 4)) {
    const url = `${UPSTREAM}?q=${encodeURIComponent(variant)}`;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
      await page.waitForTimeout(1_000);
      const directBody = cleanText(await page.locator('body').innerText().catch(() => ''));
      const directEvents = parseScheduleText(directBody);
      if (directEvents.length || await pageHasTimetable(page)) {
        console.info(`[REA_DIRECT_OK] group=${group} variant=${variant} url=${page.url()} parsed=${directEvents.length}`);
        return true;
      }
      // Sometimes the direct query leaves the result list open. Try clicking an exact visible match.
      if (await clickExactGroupText(page, variant)) {
        console.info(`[REA_DIRECT_SELECT_OK] group=${group} variant=${variant} url=${page.url()}`);
        return true;
      }
    } catch (error) {
      console.warn(`[REA_DIRECT_FAIL] group=${group} variant=${variant} error=${String(error?.message || error)}`);
    }
  }
  return false;
}

async function clickExactGroupText(page, group) {
  const normalize = (value) => String(value || '')
    .toLocaleLowerCase('ru-RU')
    .replace(/[–—−]/g, '-')
    .replace(/ё/g, 'е')
    .replace(/[^0-9a-zа-я]+/gi, '');
  const target = normalize(group);
  if (!target) return false;

  const locators = [
    page.getByText(group, { exact: true }),
    page.getByText(String(group).replace(/[–—−]/g, '-'), { exact: true }),
    page.getByText(group, { exact: false })
  ];
  for (const locator of locators) {
    const count = Math.min(await locator.count().catch(() => 0), 60);
    const hits = [];
    for (let i = 0; i < count; i += 1) {
      const item = locator.nth(i);
      if (!await item.isVisible().catch(() => false)) continue;
      const text = cleanText(await item.innerText().catch(() => ''));
      if (normalize(text) === target || normalize(text).includes(target)) hits.push({ item, len: text.length });
    }
    hits.sort((a,b) => a.len - b.len);
    for (const { item } of hits.slice(0, 12)) {
      try {
        await item.scrollIntoViewIfNeeded().catch(() => {});
        await item.click({ timeout: 3_500, force: true }).catch(async () => {
          await item.evaluate((el) => {
            const clickable = el.closest('a,button,[role="option"],[role="link"],[role="button"],li') || el;
            clickable.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
            clickable.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
            clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          });
        });
        await page.waitForTimeout(1_500);
        if (await pageHasTimetable(page)) return true;
        const afterText = cleanText(await page.locator('body').innerText().catch(() => ''));
        if (parseScheduleText(afterText).length) return true;
      } catch {}
    }
  }

  // Some portal builds use anchors carrying the query directly and render little or no text.
  const links = page.locator('a[href]');
  const linkCount = Math.min(await links.count().catch(() => 0), 300);
  for (let i = 0; i < linkCount; i += 1) {
    const link = links.nth(i);
    if (!await link.isVisible().catch(() => false)) continue;
    const href = String(await link.getAttribute('href').catch(() => '') || '');
    let decoded = href;
    try { decoded = decodeURIComponent(href); } catch {}
    if (!normalize(decoded).includes(target)) continue;
    await link.click({ timeout: 3_500, force: true }).catch(async () => {
      await link.evaluate((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))).catch(() => {});
    });
    await page.waitForTimeout(1_500);
    if (await pageHasTimetable(page)) return true;
    if (parseScheduleText(cleanText(await page.locator('body').innerText().catch(() => ''))).length) return true;
  }
  return false;
}


async function clickFirstLikelyGroupResult(page, group) {
  const normalize = (value) => String(value || '')
    .toLocaleLowerCase('ru-RU')
    .replace(/[–—−]/g, '-')
    .replace(/ё/g, 'е')
    .replace(/[^0-9a-zа-я]+/gi, '');
  const target = normalize(group);
  const candidates = page.locator('a,button,li,[role="option"],[role="link"],[role="button"],div,span');
  const count = Math.min(await candidates.count().catch(() => 0), 800);
  const scored = [];
  for (let i = 0; i < count; i += 1) {
    const item = candidates.nth(i);
    if (!await item.isVisible().catch(() => false)) continue;
    const text = cleanText(await item.innerText().catch(() => ''));
    const compact = normalize(text);
    if (!compact || text.length > 180) continue;
    if (compact === target) scored.push({ item, score: 1000 - text.length });
    else if (compact.includes(target)) scored.push({ item, score: 500 - text.length });
  }
  scored.sort((a, b) => b.score - a.score);
  for (const { item } of scored.slice(0, 20)) {
    try {
      await item.scrollIntoViewIfNeeded().catch(() => {});
      await item.click({ timeout: 3_500, force: true }).catch(async () => {
        await item.evaluate((el) => {
          const clickable = el.closest('a,button,[role="option"],[role="link"],[role="button"],li') || el;
          clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        });
      });
      await page.waitForTimeout(1_500);
      if (await pageHasTimetable(page)) return true;
      if (parseScheduleText(cleanText(await page.locator('body').innerText().catch(() => ''))).length) return true;
    } catch {}
  }
  return false;
}


async function searchForGroup(page, group) {
  // First try the portal's documented query URL. This avoids relying on the current
  // autocomplete implementation, which has changed on rasp.rea.ru several times.
  if (await tryDirectGroupUrl(page, group)) return true;

  const inputCandidates = [
    'input[placeholder*="групп" i]',
    'input[placeholder*="номер" i]',
    'input[type="search"]',
    'input[type="text"]',
    'input:not([type])'
  ];
  let input = null;
  for (const selector of inputCandidates) {
    const locator = page.locator(selector);
    const count = Math.min(await locator.count(), 10);
    for (let i = 0; i < count; i += 1) {
      const candidate = locator.nth(i);
      if (await candidate.isVisible().catch(() => false)) { input = candidate; break; }
    }
    if (input) break;
  }
  if (!input) throw new Error('На портале не найдено поле поиска группы.');

  await selectGroupTab(page);
  await input.fill(group);
  await page.waitForTimeout(800);
  await clickPortalSearch(page, input);
  await page.waitForTimeout(1_800);

  if (await selectGroupOption(page, group)) {
    await page.waitForTimeout(1_000);
    if (await pageHasTimetable(page)) return true;
  }
  if (await findGroupInResults(page, group)) return true;
  if (await clickExactGroupText(page, group)) {
    await page.waitForTimeout(1_000);
    if (await pageHasTimetable(page)) return true;
  }
  if (await clickFirstLikelyGroupResult(page, group)) return true;
  if (await pageHasTimetable(page)) return true;

  // Keyboard selection handles Material/ARIA autocomplete controls that are not ordinary links.
  for (const presses of [1, 2, 3]) {
    await input.press('ArrowDown').catch(() => {});
  }
  await input.press('Enter').catch(() => {});
  await page.waitForTimeout(2_000);
  if (await pageHasTimetable(page)) return true;
  if (await findGroupInResults(page, group)) return true;

  // One final direct URL attempt after the search UI has been primed.
  return await tryDirectGroupUrl(page, group);
}


async function downloadOfficialIcs(group) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
    acceptDownloads: true,
    serviceWorkers: 'allow'
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
      try { window.__tavrimoBlobUrls.push(url); } catch {}
      return url;
    };
    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      try { window.__tavrimoDownloads.push({ href: this.href || '', download: this.download || '' }); } catch {}
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
    } catch {}
  };
  page.on('response', captureResponse);

  try {
    await page.goto(UPSTREAM, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    // Try the requested group using several strategies. Do not click the portal's own
    // "Обновить" button automatically: on the current PWA it can reset a selected query.
    const searched = await searchForGroup(page, group);

    await page.waitForTimeout(800);
    const bodyBeforeExport = await page.locator('body').innerText().catch(() => '');
    const timetableLike = await pageHasTimetable(page);
    console.info(`[REA_SEARCH_STATE] group=${group} url=${page.url()} selected=${searched} timetable=${timetableLike}`);

    // The rendered timetable itself is now the primary source. If we can see it, parse it
    // immediately and build a deterministic ICS. This avoids depending on the portal's
    // private download/blob implementation.
    const renderedEvents = parseScheduleText(bodyBeforeExport);
    if (renderedEvents.length) {
      console.info(`[REA_RENDERED_PRIMARY] group=${group} parsed=${renderedEvents.length}`);
      return scheduleEventsToIcs(group, renderedEvents);
    }

    if (!searched) {
      const visibleText = bodyBeforeExport;
      const hasNoResults = /не найдено результатов/i.test(visibleText);
      throw new Error(hasNoResults
        ? `Портал РЭУ не открыл расписание группы «${group}». URL: ${page.url()}.`
        : `Портал РЭУ не открыл расписание группы «${group}». URL: ${page.url()}.`);
    }

    // Prefer the explicit export controls, but capture browser downloads and client-generated blobs.
    const exportText = page.getByText('Экспорт расписания в календарь', { exact: false }).last();
    if (await exportText.count() && await exportText.isVisible().catch(() => false)) {
      await exportText.click({ timeout: 3_000 }).catch(() => {});
      await page.waitForTimeout(300);
    }

    const rangeLabels = page.locator('label').filter({ hasText: /За всё время/i });
    if (await rangeLabels.count()) await rangeLabels.last().click().catch(() => {});
    const checkedInput = await page.locator('label', { hasText: /За всё время/i }).last().locator('input').count().catch(() => 0);
    if (checkedInput) await page.locator('label', { hasText: /За всё время/i }).last().locator('input').check().catch(() => {});
    await page.waitForTimeout(200);

    const downloadPromise = page.waitForEvent('download', { timeout: 12_000 }).catch(() => null);
    const exportButton = page.getByRole('button', { name: /выгрузить/i }).last();
    if (await exportButton.count() && await exportButton.isVisible().catch(() => false)) {
      await exportButton.click({ timeout: 5_000 }).catch(() => {});
    } else {
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
      } catch {}
    }

    const visibleText = await page.locator('body').innerText().catch(() => '');
    const events = parseScheduleText(visibleText);
    if (events.length) {
      console.info(`[REA_SYNC_FALLBACK] group=${group} parsed=${events.length} events from rendered timetable`);
      return scheduleEventsToIcs(group, events);
    }

    const title = await page.title().catch(() => '');
    throw new Error(`Портал РЭУ открыл страницу группы, но расписание не удалось извлечь. Страница: ${title || 'без заголовка'}. ${cleanText(visibleText).slice(0, 1200)}`);
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
  const force = /^(1|true|yes)$/i.test(String(req.query.force || ''));
  res.set('X-Tavrimo-Refresh-Mode', force ? 'force' : 'normal');
  const cached = cache.get(key);
  if (!force && cached && now - cached.fetchedAt < CACHE_TTL_MS) {
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
