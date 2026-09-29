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

async function downloadOfficialIcs(group) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    acceptDownloads: true,
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  const icsCandidates = [];
  const resourceCandidates = new Set();

  // Keep the page lightweight on Render's small instances.
  await page.route('**/*', async (route) => {
    const type = route.request().resourceType();
    if (['image', 'media', 'font'].includes(type)) return route.abort();
    return route.continue();
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
        if (/calendar|ical|ics|export|schedule|raspis/i.test(url)) resourceCandidates.add(url);
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
      if (await locator.count()) {
        for (let i = 0; i < Math.min(await locator.count(), 8); i += 1) {
          const candidate = locator.nth(i);
          if (await candidate.isVisible().catch(() => false)) { input = candidate; break; }
        }
      }
      if (input) break;
    }
    if (!input) throw new Error('На портале не найдено поле поиска группы.');
    await input.fill(group);
    await input.press('Enter').catch(() => {});
    await page.waitForTimeout(800);

    // Some portal versions require choosing the found group from the suggestion list.
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

    // Wait for the schedule view/export controls, not an arbitrary sleep.
    await page.waitForFunction((groupCode) => {
      const body = document.body?.innerText || '';
      return body.includes(groupCode) && (/Экспорт расписания в календарь/i.test(body) || /Подробности/i.test(body));
    }, group, { timeout: 25_000 }).catch(() => {});

    // The official site has a refresh button that can be present in the stale/offline state.
    const refreshes = page.getByRole('button', { name: /обновить/i });
    if (await refreshes.count()) {
      for (let i = 0; i < await refreshes.count(); i += 1) {
        const item = refreshes.nth(i);
        if (await item.isVisible().catch(() => false)) {
          await item.click({ timeout: 3_000 }).catch(() => {});
          await page.waitForTimeout(1_500);
          break;
        }
      }
    }

    // Open export panel if the label is interactive; otherwise the export controls may already be visible.
    const exportText = page.getByText('Экспорт расписания в календарь', { exact: false });
    if (await exportText.count()) await clickIfVisible(exportText);
    await page.waitForTimeout(300);

    // Select the broadest range. Try label text first, then radio/checkbox labels.
    const allRange = page.getByText('За всё время', { exact: true });
    if (await allRange.count()) await clickIfVisible(allRange);
    const radioLabel = page.locator('label').filter({ hasText: 'За всё время' });
    if (await radioLabel.count()) await clickIfVisible(radioLabel);

    // First try the browser download event.
    const downloadWait = page.waitForEvent('download', { timeout: 18_000 }).catch(() => null);
    const exportButtons = page.getByRole('button', { name: /выгрузить/i });
    if (await exportButtons.count()) {
      for (let i = 0; i < await exportButtons.count(); i += 1) {
        const button = exportButtons.nth(i);
        if (await button.isVisible().catch(() => false)) {
          await button.click({ timeout: 5_000 }).catch(() => {});
          break;
        }
      }
    }
    const download = await downloadWait;
    if (download) {
      const stream = await download.createReadStream();
      const chunks = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString('utf8');
      if (/BEGIN:VCALENDAR/i.test(body)) return body;
    }

    // Export may be served as a normal response or blob, where Playwright emits no download event.
    await page.waitForTimeout(1_000);
    if (icsCandidates.length) return icsCandidates[icsCandidates.length - 1].text;

    // Look for direct export links in the DOM and fetch them using the same session/cookies.
    const hrefs = await page.locator('a[href], form[action]').evaluateAll((els) => els.map((el) => ({
      href: el.href || el.action || '',
      text: (el.textContent || '').trim()
    })));
    const directUrls = hrefs.map((x) => x.href).filter((href) => href && /\.((ics)|(ical))(?:$|[?#])|calendar|ical|export/i.test(href));
    for (const url of [...new Set(directUrls)]) {
      try {
        const response = await context.request.get(url, { timeout: 15_000 });
        const body = await response.body();
        const candidate = body.toString('utf8');
        if (response.ok() && /BEGIN:VCALENDAR/i.test(candidate)) return candidate;
      } catch { /* continue */ }
    }

    // Last chance: some builds expose the export URL in already-loaded resources.
    for (const url of [...resourceCandidates]) {
      if (!/calendar|ical|ics|export/i.test(url)) continue;
      try {
        const response = await context.request.get(url, { timeout: 15_000 });
        const body = await response.body();
        const candidate = body.toString('utf8');
        if (response.ok() && /BEGIN:VCALENDAR/i.test(candidate)) return candidate;
      } catch { /* continue */ }
    }

    const title = await page.title().catch(() => '');
    const visibleText = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 800);
    throw new Error(`Портал РЭУ открыл расписание, но не удалось получить iCalendar. Страница: ${title || 'без заголовка'}. ${visibleText}`);
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
