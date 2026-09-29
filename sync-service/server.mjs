import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
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
    browserPromise = chromium.launch({ headless: true }).catch((error) => { browserPromise = null; throw error; });
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
  const context = await browser.newContext({ locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
  const page = await context.newPage();
  try {
    await page.goto(UPSTREAM, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const inputs = await page.locator('input[type="text"], input:not([type])').evaluateAll((els) => els.map((el) => ({ placeholder: el.getAttribute('placeholder') || '', value: el.value || '' })));
    const targetIndex = inputs.findIndex((item) => /номер группы|фио преподавателя|подразделения/i.test(item.placeholder));
    const candidates = page.locator('input[type="text"], input:not([type])');
    const input = targetIndex >= 0 ? candidates.nth(targetIndex) : candidates.first();
    await input.waitFor({ state: 'visible', timeout: 10_000 });
    await input.fill(group);
    await input.press('Enter').catch(() => {});
    await page.waitForTimeout(1_800);

    // The portal exposes an explicit refresh control when its local cache is stale/offline.
    await clickIfVisible(page.getByRole('button', { name: /обновить/i }));
    await page.waitForTimeout(2_500);

    // Open the official calendar export panel and request the broadest range.
    const exportButton = page.getByRole('button', { name: /выгрузить/i });
    if (!(await exportButton.count())) {
      throw new Error('На портале не найден экспорт календаря после выбора группы.');
    }
    // Some builds open the export panel by clicking a nearby text label first.
    const exportText = page.getByText('Экспорт расписания в календарь', { exact: false });
    await clickIfVisible(exportText);
    await page.waitForTimeout(250);
    const allRange = page.getByText('За всё время', { exact: true });
    await clickIfVisible(allRange);
    const downloadWait = page.waitForEvent('download', { timeout: 12_000 }).catch(() => null);
    await exportButton.last().click({ timeout: 4_000 });
    const download = await downloadWait;
    if (!download) throw new Error('Портал не отдал файл календаря.');
    return await download.createReadStream().then(async (stream) => {
      const chunks = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks).toString('utf8');
    });
  } finally {
    await context.close();
  }
}

app.get('/api/rea/health', (_req, res) => res.json({ ok: true, source: UPSTREAM, cacheTtlMinutes: CACHE_TTL_MS / 60000 }));

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
    return res.status(502).json({ error: String(error?.message || 'Не удалось получить расписание РЭУ.') });
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
