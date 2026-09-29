(() => {
  'use strict';

  const APP_VERSION = '11.0.0';
  const SCHEMA_VERSION = 14;
  const STORAGE_KEY = 'tavrimo-planner-v14';
  const LEGACY_KEYS = [
    'tavrimo-planner-v13', 'tavrimo-planner-v12', 'tavrimo-planner-v11', 'flowday-planner-v12', 'flowday-planner-v11', 'flowday-planner-v10', 'flowday-planner-v9', 'flowday-planner-v8', 'flowday-planner-v7', 'flowday-planner-v6', 'flowday-planner-v5',
    'flowday-planner-v4', 'flowday-planner-v3', 'flowday-planner-v2'
  ];
  const DEMO_TITLES = new Set([
    'Собрать структуру презентации', 'Ответить на важные письма',
    'Подготовить идеи для проекта', 'Записаться на стоматолога', 'Изучить 2 главы курса'
  ]);
  const ALLOWED_DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];
  const ALLOWED_PRIORITIES = [1, 2, 3];
  const ALLOWED_BUFFERS = [0, 5, 10, 15];
  const ALLOWED_FOCUS = [25, 50, 90, 120];
  const ALLOWED_CATEGORIES = ['Учёба', 'Работа', 'Личное', 'Дом', 'Другое'];
  const APP_NAME = 'Tavrimo';
  const ONBOARDING_KEY = 'tavrimo-onboarding-v1';
  const ONBOARDING_STEPS = [
    { target: '#todayView .hero-card', view: 'today', icon: '📈', title: 'День перед глазами', text: 'Здесь видно, сколько времени уже занято и сколько свободного пространства осталось в выбранном дне.' },
    { target: '#todayDateChip', view: 'today', icon: '📅', title: 'Переключай дату', text: 'Нажми на дату, чтобы открыть другой день. На неделю можно смотреть отдельно в разделе «Неделя».' },
    { target: '#tabAdd', view: 'today', icon: '➕', title: 'Добавляй задачи одной кнопкой', text: 'Это единственная кнопка создания. Задачу можно оставить без времени или сразу назначить дату и время вручную.' },
    { target: '[data-view="calendar"]', view: 'today', icon: '🎓', title: 'Пары и план в одном месте', text: 'В «Неделе» переключайся между своим планом и расписанием РЭУ. Пары блокируют это время, участвуют в загрузке дня и могут иметь привязанные задачи.' },
    { target: '[data-view="tasks"]', view: 'tasks', icon: '✅', title: 'Все задачи', text: 'Здесь можно искать задачи и фильтровать их по состоянию: в плане, без времени, с дедлайном, просроченные и готовые.' },
    { target: '[data-view="more"]', view: 'more', icon: '🧩', title: 'Дополнительные инструменты', text: 'В «Ещё» находятся расписание РЭУ, Фокус, Статистика, Состояние плана и Настройки — без лишних кнопок на главном экране.' },
    { target: '#moreUniversity', view: 'more', icon: '🎓', title: 'Подключи группу РЭУ', text: 'Открой «Моя группа», укажи номер группы и импортируй официальный календарь .ics с rasp.rea.ru. После этого пары появятся в неделе и начнут блокировать задачи.' },
    { target: '#moreSettings', view: 'more', icon: '⚙️', title: 'Настрой под себя', text: 'В настройках задаются рабочие часы, обед, резерв между задачами, выходные и тема интерфейса. Отсюда же можно сделать резервную копию данных.' },
  ];
  let onboardingStep = 0;
  let onboardingTimer = null;
  let onboardingOpen = false;

  const DEFAULTS = {
    version: SCHEMA_VERSION,
    settings: {
      workStart: 9, workEnd: 18, lunchStart: 13, lunchEnd: 14,
      buffer: 10, focusLength: 25, weekends: false, theme: 'system'
    },
    tasks: [],
    focus: { totalMinutes: 0, sessions: [] },
    university: { groupCode: '', groupName: '', importedAt: null, source: 'rasp.rea.ru', events: [] }
  };

  let data = loadData();
  let currentDate = startOfDay(new Date());
  let currentView = 'today';
  let calendarMode = 'plan';
  let selectedUniversityEventId = null;
  let activeFilter = 'all';
  let editingId = null;
  let toastTimer = null;
  let modalCloseTimers = new Map();
  let focusTimer = null;
  let focusRunning = false;
  let focusEndAt = null;
  let focusRemaining = Math.max(1, Number(data.settings.focusLength) || 25) * 60;
  let focusTaskId = null;
  let focusPlannedMinutes = Number(data.settings.focusLength) || 25;
  let focusSessionDate = null;
  let draftLinkedUniversityEventId = null;
  let swRegistration = null;

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const byId = (id) => data.tasks.find((task) => String(task.id) === String(id));

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function uid() {
    return globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
  function hashString(value) {
    let hash = 2166136261;
    for (const char of String(value || '')) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(36);
  }
  function universityEventFingerprint(event) {
    return [event?.uid || '', event?.date || '', event?.start || '', event?.end || '', event?.subject || '', event?.room || ''].join('|').trim().toLowerCase();
  }
  function stableUniversityEventId(event) {
    return `rea-${hashString(universityEventFingerprint(event))}`;
  }
  function startOfDay(value) { const d = new Date(value); d.setHours(0, 0, 0, 0); return d; }
  function dateKey(value) {
    const d = startOfDay(value);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function parseDateKey(key) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
    if (!match) return null;
    const y = Number(match[1]); const m = Number(match[2]); const d = Number(match[3]);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const result = new Date(y, m - 1, d, 12);
    return result.getFullYear() === y && result.getMonth() === m - 1 && result.getDate() === d ? result : null;
  }
  function dateFromKey(key) { return parseDateKey(key) || startOfDay(new Date()); }
  function isValidDateKey(key) { return Boolean(parseDateKey(key)); }
  function addDays(value, days) { const d = new Date(value); d.setDate(d.getDate() + days); return d; }
  function daysBetween(a, b) { return Math.round((startOfDay(b) - startOfDay(a)) / 86400000); }
  function toMinutes(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const raw = String(value || '');
    if (!/^\d{2}:\d{2}$/.test(raw)) return NaN;
    const [hours, minutes] = raw.split(':').map(Number);
    if (hours > 23 || minutes > 59) return NaN;
    return hours * 60 + minutes;
  }
  function hm(minutes) {
    const value = Math.max(0, Math.round(Number(minutes) || 0));
    return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  }
  function shortDate(value) { return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(value).replace('.', ''); }
  function longDate(value) { return new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(value); }
  function weekdayShort(value) { return new Intl.DateTimeFormat('ru-RU', { weekday: 'short' }).format(value).replace('.', ''); }
  function formatDuration(minutes) {
    const m = Math.max(0, Math.round(Number(minutes) || 0));
    const hours = Math.floor(m / 60); const mins = m % 60;
    if (hours && mins) return `${hours}ч ${mins}м`;
    if (hours) return `${hours}ч`;
    return `${mins}м`;
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }
  function todayKey() { return dateKey(new Date()); }
  function nowMinutes() { const now = new Date(); return now.getHours() * 60 + now.getMinutes(); }
  function formatCount(count, one, few, many) {
    const n = Math.abs(count) % 100; const n10 = n % 10;
    if (n >= 11 && n <= 19) return many;
    if (n10 === 1) return one;
    if (n10 >= 2 && n10 <= 4) return few;
    return many;
  }

  function safeIso(value, fallback = null) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
  }

  function normalizeTime(value) {
    const minutes = toMinutes(value);
    return Number.isFinite(minutes) ? hm(minutes) : null;
  }

  function normalizeTask(task, index = 0, usedIds = new Set()) {
    const candidateDeadline = String(task?.deadline || '').trim();
    const deadline = candidateDeadline ? (isValidDateKey(candidateDeadline) ? candidateDeadline : null) : null;
    const deadlineTime = normalizeTime(task?.deadlineTime);
    const scheduledDateRaw = String(task?.scheduledDate || '');
    const scheduledStart = normalizeTime(task?.scheduledStart);
    const scheduledDate = isValidDateKey(scheduledDateRaw) && scheduledStart ? scheduledDateRaw : null;
    const createdAt = safeIso(task?.createdAt, new Date().toISOString());
    const completedAt = task?.done ? safeIso(task?.completedAt, createdAt) : null;
    const category = ALLOWED_CATEGORIES.includes(String(task?.category || '')) ? String(task.category) : 'Учёба';
    const rawId = task?.id != null && String(task.id).trim() ? String(task.id) : `task-${index + 1}`;
    let id = rawId; let suffix = 2;
    while (usedIds.has(id)) id = `${rawId}-${suffix++}`;
    usedIds.add(id);
    return {
      id,
      title: String(task?.title || '').trim().slice(0, 120),
      duration: ALLOWED_DURATIONS.includes(Number(task?.duration)) ? Number(task.duration) : 30,
      priority: ALLOWED_PRIORITIES.includes(Number(task?.priority)) ? Number(task.priority) : 2,
      deadline,
      deadlineTime: deadline ? deadlineTime : null,
      category,
      note: String(task?.note || '').slice(0, 300),
      linkedUniversityEventId: task?.linkedUniversityEventId != null && String(task.linkedUniversityEventId).trim() ? String(task.linkedUniversityEventId) : null,
      scheduledDate,
      scheduledStart,
      locked: Boolean(scheduledDate && scheduledStart),
      done: Boolean(task?.done),
      createdAt,
      completedAt
    };
  }

  function normalizeUniversityEvent(event, index = 0, usedIds = new Set()) {
    const date = isValidDateKey(event?.date) ? String(event.date) : null;
    const start = normalizeTime(event?.start || event?.scheduledStart);
    const end = normalizeTime(event?.end || event?.scheduledEnd);
    if (!date || !start || !end || toMinutes(end) <= toMinutes(start)) return null;
    const uidValue = String(event?.uid || '').trim();
    const normalized = {
      uid: uidValue, date, start, end,
      subject: String(event?.subject || event?.title || 'Занятие').trim().slice(0, 160) || 'Занятие',
      type: String(event?.type || 'Занятие').trim().slice(0, 80) || 'Занятие',
      teacher: String(event?.teacher || '').trim().slice(0, 160),
      room: String(event?.room || event?.location || '').trim().slice(0, 120),
      note: String(event?.note || event?.description || '').trim().slice(0, 500)
    };
    const rawId = String(event?.id || '').trim() || stableUniversityEventId(normalized);
    let id = rawId; let suffix = 2;
    while (usedIds.has(id)) id = `${rawId}-${suffix++}`;
    usedIds.add(id);
    return { id, ...normalized };
  }

  function normalizeUniversity(rawUniversity) {
    const raw = rawUniversity && typeof rawUniversity === 'object' ? rawUniversity : {};
    const usedIds = new Set(); const fingerprints = new Set();
    const events = [];
    const rawEvents = Array.isArray(raw.events) ? raw.events : [];
    for (let index = 0; index < rawEvents.length; index += 1) {
      const event = normalizeUniversityEvent(rawEvents[index], index, usedIds);
      if (!event) continue;
      const fingerprint = universityEventFingerprint(event);
      if (fingerprints.has(fingerprint)) continue;
      fingerprints.add(fingerprint); events.push(event);
    }
    events.sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`, 'ru') || a.subject.localeCompare(b.subject, 'ru'));
    return {
      groupCode: String(raw.groupCode || raw.groupName || '').trim().slice(0, 80),
      groupName: String(raw.groupName || raw.groupCode || '').trim().slice(0, 120),
      importedAt: safeIso(raw.importedAt, null),
      source: 'rasp.rea.ru',
      events
    };
  }

  function parseIcsLines(text) {
    return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').reduce((out, line) => {
      if (/^[ \t]/.test(line) && out.length) out[out.length - 1] += line.slice(1);
      else out.push(line);
      return out;
    }, []);
  }

  function icsUnescape(value) {
    return String(value || '').replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
  }

  function cleanIcsText(value) {
    return icsUnescape(value).replace(/<br\s*\/?>(\s*)/gi, '\n').replace(/<[^>]+>/g, '').trim();
  }

  function parseIcsProperty(line) {
    const idx = String(line).indexOf(':');
    if (idx < 0) return null;
    const left = line.slice(0, idx); const value = icsUnescape(line.slice(idx + 1));
    const parts = left.split(';'); const name = parts.shift().toUpperCase(); const params = {};
    for (const part of parts) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
    }
    return { name, params, value };
  }

  function parseIcsDateTime(value, params = {}) {
    if (String(params.VALUE || '').toUpperCase() === 'DATE') return null;
    const raw = String(value || '').trim();
    let match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(raw);
    if (!match) match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z)?$/.exec(raw);
    if (!match) return null;
    const y = Number(match[1]); const m = Number(match[2]); const d = Number(match[3]); const hh = Number(match[4] || 0); const mm = Number(match[5] || 0); const ss = Number(match[6] || 0);
    const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (!isValidDateKey(key) || hh > 23 || mm > 59 || ss > 59) return null;
    if (match[7] === 'Z') {
      // REA timetable is Moscow time (UTC+3). Convert absolute UTC timestamps to Europe/Moscow wall time.
      const total = hh * 60 + mm + 180; const dayShift = Math.floor(total / 1440); const adjusted = ((total % 1440) + 1440) % 1440;
      const shifted = addDays(dateFromKey(key), dayShift);
      return { date: dateKey(shifted), time: hm(adjusted) };
    }
    return { date: key, time: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` };
  }

  function guessUniversityType(summary, description = '') {
    const text = `${summary} ${description}`.toLowerCase();
    if (text.includes('лаборатор')) return 'Лабораторная';
    if (text.includes('семинар')) return 'Семинар';
    if (text.includes('практич')) return 'Практика';
    if (text.includes('лекц')) return 'Лекция';
    if (text.includes('экзам')) return 'Экзамен';
    if (text.includes('зачет') || text.includes('зачёт')) return 'Зачет';
    if (text.includes('курсов')) return 'Курсовая';
    return 'Занятие';
  }

  function stripUniversityType(summary) {
    return String(summary || 'Занятие').replace(/\s*[([{—-]\s*(лекция|практическое? занятие|практика|семинар|лабораторная работа|экзамен|зач[её]т|курсовая работа)\s*[)\]}]?\s*$/i, '').trim() || 'Занятие';
  }

  function extractTeacher(description) {
    const source = icsUnescape(description).replace(/\\n/g, '\n');
    const labeled = source.match(/(?:преподаватель|преп\.?|препод\.?)[^:—-]*[:—-]\s*([^\n;]+)/i);
    if (labeled?.[1]) return labeled[1].trim();
    const fio = source.match(/([А-ЯЁA-Z][А-ЯЁA-Zа-яёa-z-]{2,})\s+([А-ЯЁA-Z][а-яёa-z-]{2,})(?:\s+([А-ЯЁA-Z][а-яёa-z-]{2,}))?/);
    return fio ? fio[0].trim() : '';
  }

  function parseUniversityIcs(text) {
    const lines = parseIcsLines(text); const events = []; let current = null; let calendarName = '';
    for (const line of lines) {
      const property = parseIcsProperty(line); if (!property) continue;
      if (property.name === 'X-WR-CALNAME' && !calendarName) calendarName = property.value;
      if (line.toUpperCase() === 'BEGIN:VEVENT') { current = {}; continue; }
      if (line.toUpperCase() === 'END:VEVENT') {
        if (current) {
          const start = parseIcsDateTime(current.dtstart, current.dtstartParams); const end = parseIcsDateTime(current.dtend, current.dtendParams);
          if (start && end && start.date === end.date && toMinutes(end.time) > toMinutes(start.time)) {
            const description = cleanIcsText(current.description || ''); const summary = cleanIcsText(current.summary || 'Занятие');
            const type = current.type || guessUniversityType(summary, description);
            events.push({ uid: current.uid || '', date: start.date, start: start.time, end: end.time, subject: stripUniversityType(summary), type, teacher: current.teacher || extractTeacher(description), room: current.location || current.room || '', note: description });
          }
        }
        current = null; continue;
      }
      if (!current) continue;
      if (property.name === 'DTSTART') { current.dtstart = property.value; current.dtstartParams = property.params; }
      if (property.name === 'DTEND') { current.dtend = property.value; current.dtendParams = property.params; }
      if (property.name === 'SUMMARY') current.summary = property.value;
      if (property.name === 'DESCRIPTION') current.description = property.value;
      if (property.name === 'LOCATION') current.location = property.value;
      if (property.name === 'UID') current.uid = property.value;
      if (property.name === 'CATEGORIES') current.type = property.value.split(',')[0]?.trim();
      if (property.name === 'X-TEACHER' || property.name === 'TEACHER') current.teacher = property.value;
      if (property.name === 'X-ROOM' || property.name === 'ROOM') current.room = property.value;
    }
    return { calendarName, events };
  }

  function universityEventsForDate(date, events = data.university.events) {
    const key = typeof date === 'string' ? date : dateKey(date);
    const source = Array.isArray(events) ? events : [];
    return source.filter((event) => event.date === key).sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  }

  function universityEventById(id) { return data.university.events.find((event) => String(event.id) === String(id)); }

  function universityConflict(taskDate, start, end, events = data.university.events) {
    return universityEventsForDate(taskDate, events).find((event) => start < toMinutes(event.end) && end > toMinutes(event.start)) || null;
  }

  function repairUniversityTaskConflicts() {
    let count = 0;
    for (const task of data.tasks) {
      if (task.done || !task.scheduledDate || !task.scheduledStart) continue;
      const start = toMinutes(task.scheduledStart); const end = start + task.duration + Number(data.settings.buffer || 0);
      if (universityConflict(task.scheduledDate, start, end)) {
        task.scheduledDate = null; task.scheduledStart = null; task.locked = false; count += 1;
      }
    }
    return count;
  }

  function normalizeQuarterHour(value, fallback, min = 0, max = 23.75) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max) return fallback;
    return Math.round(number * 4) / 4;
  }

  function normalizeData(raw) {
    const base = clone(DEFAULTS);
    if (!raw || typeof raw !== 'object') return base;

    const rawSettings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    const settings = { ...base.settings, ...rawSettings };
    settings.workStart = normalizeQuarterHour(settings.workStart, 9);
    settings.workEnd = normalizeQuarterHour(settings.workEnd, 18);
    settings.lunchStart = normalizeQuarterHour(settings.lunchStart, 13);
    settings.lunchEnd = normalizeQuarterHour(settings.lunchEnd, 14);
    if (!(settings.workEnd > settings.workStart)) { settings.workStart = 9; settings.workEnd = 18; }
    if (!(settings.lunchEnd > settings.lunchStart) || settings.lunchStart < settings.workStart || settings.lunchEnd > settings.workEnd) { settings.lunchStart = 13; settings.lunchEnd = 14; }
    settings.buffer = ALLOWED_BUFFERS.includes(Number(settings.buffer)) ? Number(settings.buffer) : 10;
    settings.focusLength = ALLOWED_FOCUS.includes(Number(settings.focusLength)) ? Number(settings.focusLength) : 25;
    settings.weekends = Boolean(settings.weekends);
    settings.theme = ['system', 'light', 'dark'].includes(settings.theme) ? settings.theme : 'system';

    const rawTasks = Array.isArray(raw.tasks) ? raw.tasks : [];
    const usedIds = new Set();
    const tasks = rawTasks.map((task, index) => normalizeTask(task, index, usedIds)).filter((task) => task.title);
    const taskIds = new Set(tasks.map((task) => String(task.id)));
    const focusRaw = raw.focus && typeof raw.focus === 'object' ? raw.focus : {};
    const sessions = Array.isArray(focusRaw.sessions) ? focusRaw.sessions.slice(-500).map((session) => {
      const minutes = Math.round(Number(session?.minutes) || 0);
      const date = isValidDateKey(session?.date) ? String(session.date) : null;
      if (minutes <= 0 || !date) return null;
      return {
        date,
        taskId: session?.taskId != null && taskIds.has(String(session.taskId)) ? String(session.taskId) : null,
        minutes: Math.min(1440, minutes),
        completedAt: safeIso(session?.completedAt, new Date().toISOString())
      };
    }).filter(Boolean) : [];
    const totalMinutes = sessions.reduce((sum, session) => sum + session.minutes, 0);

    const university = normalizeUniversity(raw.university);
    const universityIds = new Set(university.events.map((event) => String(event.id)));
    for (const task of tasks) {
      if (task.linkedUniversityEventId && !universityIds.has(String(task.linkedUniversityEventId))) task.linkedUniversityEventId = null;
    }
    const normalized = {
      version: SCHEMA_VERSION,
      settings,
      tasks,
      focus: { totalMinutes, sessions },
      university
    };
    return repairData(normalized, normalized.settings).data;
  }

  function repairData(input, settings = data?.settings || DEFAULTS.settings) {
    const repaired = clone(input);
    let changed = false;
    const seenSlots = {};

    const sorted = [...repaired.tasks].sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (Boolean(a.locked) !== Boolean(b.locked)) return a.locked ? -1 : 1;
      const ad = `${a.scheduledDate || '9999-99-99'} ${a.scheduledStart || '99:99'}`;
      const bd = `${b.scheduledDate || '9999-99-99'} ${b.scheduledStart || '99:99'}`;
      return ad.localeCompare(bd) || String(a.createdAt).localeCompare(String(b.createdAt));
    });

    for (const task of sorted) {
      if (task.done) {
        if (!task.completedAt) { task.completedAt = safeIso(task.createdAt, new Date().toISOString()); changed = true; }
        continue;
      }
      if (task.scheduledDate && task.scheduledStart) {
        const validSlot = validatePersistedSlot(task, settings, { allowPast: true });
        if (!validSlot.ok) {
          task.scheduledDate = null; task.scheduledStart = null; task.locked = false; changed = true;
          continue;
        }
        const start = toMinutes(task.scheduledStart);
        const end = start + task.duration + Number(settings.buffer || 0);
        const day = task.scheduledDate;
        const list = (seenSlots[day] ||= []);
        const conflict = list.some((item) => start < item.e && end > item.s);
        if (conflict) {
          task.scheduledDate = null; task.scheduledStart = null; task.locked = false; changed = true;
          continue;
        }
        list.push({ s: start, e: end, locked: Boolean(task.locked) });
      } else if (task.scheduledDate || task.scheduledStart || task.locked) {
        task.scheduledDate = null; task.scheduledStart = null; task.locked = false; changed = true;
      }
    }

    if (Array.isArray(repaired.university?.events) && repaired.university.events.length) {
      for (const task of repaired.tasks) {
        if (task.done || !task.scheduledDate || !task.scheduledStart) continue;
        const start = toMinutes(task.scheduledStart); const end = start + task.duration + Number(repaired.settings.buffer || 0);
        if (universityConflict(task.scheduledDate, start, end, repaired.university.events)) {
          task.scheduledDate = null; task.scheduledStart = null; task.locked = false; changed = true;
        }
      }
    }

    if (repaired.focus.totalMinutes !== repaired.focus.sessions.reduce((sum, session) => sum + session.minutes, 0)) {
      repaired.focus.totalMinutes = repaired.focus.sessions.reduce((sum, session) => sum + session.minutes, 0);
      changed = true;
    }
    return { data: repaired, changed };
  }

  function isOnlyLegacyDemo(value) {
    return value.tasks?.length === 5 && value.tasks.every((task) => DEMO_TITLES.has(task.title)) &&
      value.tasks.every((task) => !task.done) && Number(value.focus?.totalMinutes || 0) === 0;
  }

  function loadData() {
    try {
      for (const key of [STORAGE_KEY, ...LEGACY_KEYS]) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = normalizeData(JSON.parse(raw));
        if (isOnlyLegacyDemo(parsed)) {
          [STORAGE_KEY, ...LEGACY_KEYS].forEach((legacy) => localStorage.removeItem(legacy));
          return clone(DEFAULTS);
        }
        if (key !== STORAGE_KEY) localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
        return parsed;
      }
    } catch {
      // clean start
    }
    return clone(DEFAULTS);
  }

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch {
      showToast('Не удалось сохранить данные на устройстве.');
      return false;
    }
  }

  function settingsMinutes() {
    return {
      workStart: Math.round(data.settings.workStart * 60),
      workEnd: Math.round(data.settings.workEnd * 60),
      lunchStart: Math.round(data.settings.lunchStart * 60),
      lunchEnd: Math.round(data.settings.lunchEnd * 60)
    };
  }

  function isWorkingDay(value) {
    const day = startOfDay(value).getDay();
    return data.settings.weekends || (day !== 0 && day !== 6);
  }

  function workingCapacityMinutes() {
    const s = settingsMinutes();
    return Math.max(0, (s.workEnd - s.workStart) - Math.max(0, s.lunchEnd - s.lunchStart));
  }

  function priorityLabel(priority) { return priority === 3 ? 'Высокий' : priority === 1 ? 'Низкий' : 'Средний'; }
  function priorityClass(priority) { return priority === 3 ? 'priority-high' : priority === 1 ? 'priority-low' : 'priority-mid'; }
  function deadlineMinutes(task) { return task.deadlineTime ? toMinutes(task.deadlineTime) : 1439; }
  function deadlineTimestamp(task) { return task.deadline ? startOfDay(dateFromKey(task.deadline)).getTime() + deadlineMinutes(task) * 60000 : Infinity; }
  function deadlineLabel(task) {
    if (task.done) return 'Выполнено';
    if (!task.deadline) return 'Без дедлайна';
    const diff = daysBetween(new Date(), dateFromKey(task.deadline));
    const now = Date.now();
    const deadlineAt = deadlineTimestamp(task);
    const time = task.deadlineTime ? ` до ${task.deadlineTime}` : '';
    if (deadlineAt < now) return diff === 0 ? `Просрочено${task.deadlineTime ? ` · ${task.deadlineTime}` : ''}` : `Просрочено · ${Math.abs(diff)}д`;
    if (diff === 0) return `Сегодня${time}`;
    if (diff === 1) return `Завтра${time}`;
    return `До ${shortDate(dateFromKey(task.deadline))}${time}`;
  }
  function scheduleLabel(task) {
    return task.scheduledDate && task.scheduledStart ? `${shortDate(dateFromKey(task.scheduledDate))}, ${task.scheduledStart}` : 'Без времени';
  }
  function getScheduled(date, includeDone = true) {
    const key = typeof date === 'string' ? date : dateKey(date);
    return data.tasks.filter((task) => task.scheduledDate === key && task.scheduledStart && (includeDone || !task.done))
      .sort((a, b) => toMinutes(a.scheduledStart) - toMinutes(b.scheduledStart) || a.title.localeCompare(b.title, 'ru'));
  }
  function getOpenInbox() {
    return data.tasks.filter((task) => !task.done && !task.scheduledDate)
      .sort((a, b) => taskUrgencyScore(a) - taskUrgencyScore(b) || b.priority - a.priority || String(a.createdAt).localeCompare(String(b.createdAt)));
  }
  function getWeekStart(date) {
    const d = startOfDay(date); const day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return d;
  }

  function validatePersistedSlot(task, settingsOverride = data?.settings || DEFAULTS.settings, options = {}) {
    if (!isValidDateKey(task.scheduledDate) || !normalizeTime(task.scheduledStart)) return { ok: false, reason: 'Неполный слот.' };
    const day = dateFromKey(task.scheduledDate);
    const dayOfWeek = day.getDay();
    if (Boolean(settingsOverride.weekends) === false && (dayOfWeek === 0 || dayOfWeek === 6)) return { ok: false, reason: 'Выходной.' };
    if (!options.allowPast && dateFromKey(task.scheduledDate) < startOfDay(new Date()) && !task.done) return { ok: false, reason: 'Дата в прошлом.' };
    const start = toMinutes(task.scheduledStart);
    const s = {
      workStart: Math.round(Number(settingsOverride.workStart) * 60),
      workEnd: Math.round(Number(settingsOverride.workEnd) * 60),
      lunchStart: Math.round(Number(settingsOverride.lunchStart) * 60),
      lunchEnd: Math.round(Number(settingsOverride.lunchEnd) * 60)
    };
    const end = start + task.duration; const buffer = Number(settingsOverride.buffer ?? data.settings.buffer ?? 0); const reservedEnd = end + buffer;
    if (!options.allowPast && !task.done && dateKey(day) === todayKey() && start < nowMinutes()) return { ok: false, reason: 'Время уже прошло.' };
    if (start % 15 !== 0) return { ok: false, reason: 'Некратное время.' };
    if (start < s.workStart || end > s.workEnd || reservedEnd > s.workEnd) return { ok: false, reason: 'За пределами рабочего дня.' };
    if (start < s.lunchEnd && end > s.lunchStart) return { ok: false, reason: 'Перерыв.' };
    if (start < s.lunchEnd && reservedEnd > s.lunchStart) return { ok: false, reason: 'Резерв пересекает перерыв.' };
    if (task.deadline && day > dateFromKey(task.deadline)) return { ok: false, reason: 'Дата позже дедлайна.' };
    if (task.deadline && dateKey(day) === task.deadline && end > deadlineMinutes(task)) return { ok: false, reason: 'После дедлайна.' };
    return { ok: true };
  }

  function taskUrgencyScore(task) {
    const deadline = task.deadline ? deadlineTimestamp(task) : Infinity;
    const overdueLead = taskIsOverdue(task) ? -(10 ** 14) : 0;
    const priorityLead = task.priority === 3 ? -2_000_000 : task.priority === 2 ? -1_000_000 : 0;
    return deadline + priorityLead + overdueLead + Number(task.duration || 0) * 10;
  }

  function validateManualSlot(task, scheduledDate, scheduledStart, duration) {
    if (!scheduledDate || !scheduledStart) return 'Укажи дату и время.';
    const date = parseDateKey(scheduledDate); const today = startOfDay(new Date());
    if (!date) return 'Выбери существующую дату.';
    if (!isWorkingDay(date)) return 'Этот день не входит в рабочие дни.';
    if (date < today) return 'Нельзя поставить задачу в прошлое.';
    if (task.deadline && date > dateFromKey(task.deadline)) return 'Слот позже дедлайна.';
    const start = toMinutes(scheduledStart); const end = start + duration;
    const s = settingsMinutes(); const buffer = Number(data.settings.buffer || 0);
    if (!Number.isFinite(start)) return 'Неверное время.';
    if (start % 15 !== 0) return 'Время должно быть кратно 15 минутам.';
    if (dateKey(date) === todayKey() && start < nowMinutes()) return 'Это время уже прошло.';
    if (start < s.workStart || end > s.workEnd || end + buffer > s.workEnd) return 'Слот выходит за пределы рабочего дня.';
    if (start < s.lunchEnd && end > s.lunchStart) return 'Слот пересекается с перерывом.';
    if (start < s.lunchEnd && end + buffer > s.lunchStart) return 'Резерв после задачи пересекает перерыв.';
    if (task.deadline && dateKey(date) === task.deadline && end > deadlineMinutes(task)) return task.deadlineTime ? `Слот заканчивается позже ${task.deadlineTime}.` : 'Слот заканчивается после дедлайна.';

    const newStart = start; const newEnd = end + buffer;
    const universityBlock = universityConflict(scheduledDate, newStart, newEnd);
    if (universityBlock) return `В это время пара: ${universityBlock.subject}${universityBlock.room ? ` · ${universityBlock.room}` : ''}.`;
    const conflict = data.tasks.some((other) => {
      if (String(other.id) === String(task.id) || other.done || other.scheduledDate !== scheduledDate || !other.scheduledStart) return false;
      const otherStart = toMinutes(other.scheduledStart);
      const otherEnd = otherStart + other.duration + buffer;
      return newStart < otherEnd && newEnd > otherStart;
    });
    return conflict ? 'На это время уже стоит другая задача.' : '';
  }

  function slotValidationText(task) {
    const date = $('#taskScheduleDate')?.value || ''; const time = $('#taskScheduleTime')?.value || ''; const duration = Number($('#taskDuration')?.value || 0);
    if (!date && !time) return 'Без времени — задача останется во входящих.';
    if (!date || !time) return 'Укажи и дату, и время или очисти оба поля.';
    const taskLike = task || { id: editingId || '__new__', deadline: $('#taskDeadline')?.value || null, deadlineTime: $('#taskDeadlineTime')?.value || null };
    const error = validateManualSlot(taskLike, date, time, duration);
    return error || `Свободно · ${time}–${hm(toMinutes(time) + duration)} · резерв ${Number(data.settings.buffer || 0)}м`;
  }

  function completeTask(id) {
    const task = byId(id); if (!task) return;
    if (!task.done) {
      task.done = true;
      task.completedAt = new Date().toISOString();
    } else {
      task.done = false;
      task.completedAt = null;
      const slotStillValid = task.scheduledDate && task.scheduledStart && validatePersistedSlot(task).ok && (task.deadline == null || deadlineTimestamp(task) >= Date.now());
      if (!slotStillValid) {
        task.scheduledDate = null; task.scheduledStart = null;
        task.locked = false;
      }
      // Returning a completed task must not silently change manual/auto mode if the slot is still valid.
    }
    saveData(); renderAll();
    showToast(task.done ? 'Задача выполнена.' : task.scheduledDate ? 'Задача снова в расписании.' : 'Задача возвращена в план.');
  }

  function deleteTask(id) {
    data.tasks = data.tasks.filter((task) => String(task.id) !== String(id));
    if (focusTaskId === String(id)) resetFocusTimer();
    saveData(); closeAllModals(); renderAll(); showToast('Задача удалена.');
  }


  function resetAllData() {
    data = clone(DEFAULTS);
    [STORAGE_KEY, ...LEGACY_KEYS].forEach((key) => localStorage.removeItem(key));
    currentDate = startOfDay(new Date()); activeFilter = 'all'; resetFocusTimer(); closeAllModals(); saveData(); renderAll();
    showToast('Данные очищены.');
  }

  function applyTheme() {
    const requested = data.settings.theme || 'system';
    const actual = requested === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : requested;
    document.documentElement.dataset.theme = actual;
  }

  function renderAll() {
    applyTheme(); renderChrome(); renderToday(); renderCalendar(); renderCalendarMode(); renderTasks(); renderSettings();
    populateFocusTasks(); updateAppVersion(); updateManualHint(); updateFocusUI();
  }

  function renderChrome() {
    $('#headerContext').textContent = currentView === 'today' ? shortDate(currentDate) : ({ calendar: 'Неделя', tasks: 'Задачи', more: 'Ещё' }[currentView] || APP_NAME);
    $$('.tab[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === currentView));
    $$('.view').forEach((view) => view.classList.toggle('active', view.dataset.view === currentView));
  }


  function dayLoad(date) {
    const tasks = getScheduled(date, false);
    const classes = universityEventsForDate(date);
    const buffer = Number(data.settings.buffer || 0);
    const work = tasks.reduce((sum, task) => sum + task.duration, 0);
    const reserve = tasks.length * buffer;
    const classWork = classes.reduce((sum, event) => sum + Math.max(0, toMinutes(event.end) - toMinutes(event.start)), 0);
    return { tasks, classes, work, reserve, classWork, occupied: work + reserve + classWork };
  }

  function taskIsOverdue(task) {
    return !task.done && Boolean(task.deadline) && deadlineTimestamp(task) < Date.now();
  }


  function clearTaskSchedule(id) {
    const task = byId(id);
    if (!task) return false;
    task.scheduledDate = null; task.scheduledStart = null; task.locked = false;
    saveData(); renderAll();
    return true;
  }

  function getAgendaItemsForDate(date, includeDone = false) {
    const taskItems = getScheduled(date, includeDone).map((task) => ({ kind: 'task', item: task, start: toMinutes(task.scheduledStart), end: toMinutes(task.scheduledStart) + task.duration }));
    const classItems = universityEventsForDate(date).map((event) => ({ kind: 'class', item: event, start: toMinutes(event.start), end: toMinutes(event.end) }));
    return [...taskItems, ...classItems].sort((a, b) => a.start - b.start || a.end - b.end || (a.kind === 'class' ? -1 : 1));
  }

  function getNextAgendaItem(date = currentDate) {
    const items = getAgendaItemsForDate(date, false);
    if (!items.length) return null;
    const key = typeof date === 'string' ? date : dateKey(date);
    if (key !== todayKey()) return items[0];
    const now = nowMinutes();
    return items.find((entry) => now >= entry.start && now < entry.end) || items.find((entry) => entry.start >= now) || null;
  }

  function getNextUpTask(date = currentDate) {
    const next = getNextAgendaItem(date);
    return next?.kind === 'task' ? next.item : null;
  }

  function getPlanHealth() {
    const open = data.tasks.filter((task) => !task.done);
    const overdue = open.filter(taskIsOverdue).length;
    const inbox = open.filter((task) => !task.scheduledDate).length;
    const next7 = Array.from({ length: 7 }, (_, index) => addDays(startOfDay(new Date()), index));
    const overloaded = next7.filter((day) => {
      if (!isWorkingDay(day)) return false;
      const load = dayLoad(day);
      return load.occupied > workingCapacityMinutes();
    }).length;
    const due48h = open.filter((task) => task.deadline && deadlineTimestamp(task) >= Date.now() && deadlineTimestamp(task) <= Date.now() + 48 * 3600000).length;
    return { open: open.length, overdue, inbox, overloaded, due48h };
  }

  function formatImportedAt(value) {
    if (!value) return 'Расписание ещё не импортировано.';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Расписание ещё не импортировано.';
    return `Обновлено ${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} в ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  }

  function renderUniversityEventCard(event, compact = false) {
    const meta = [event.type, event.teacher, event.room].filter(Boolean).join(' · ');
    return `<div class="uni-event-card ${compact ? 'compact' : ''}" data-uni-event="${escapeHtml(event.id)}">\n      <button class="uni-event-main" type="button" data-open-uni-event="${escapeHtml(event.id)}">\n        <span class="uni-event-time"><strong>${escapeHtml(event.start)}</strong><small>${escapeHtml(event.end)}</small></span>\n        <span class="uni-event-copy"><strong>${escapeHtml(event.subject)}</strong><small>${escapeHtml(meta || 'Занятие')}</small></span>\n      </button>\n      <button class="uni-event-task" type="button" data-add-task-uni="${escapeHtml(event.id)}" aria-label="Добавить задачу к паре">＋</button>\n    </div>`;
  }

  function renderUniversityWeek() {
    const group = data.university.groupCode || '';
    $('#universityGroupLabel').textContent = group || 'Группа не выбрана';
    $('#universityManageBtn').textContent = group ? 'Настроить' : 'Подключить';
    $('#universitySyncLabel').textContent = data.university.events.length ? `${formatImportedAt(data.university.importedAt)} · ${data.university.events.length} занятий` : 'Подключи расписание РЭУ, чтобы видеть пары здесь.';
    const monday = getWeekStart(currentDate);
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    const total = days.reduce((sum, day) => sum + universityEventsForDate(day).length, 0);
    const todayCount = universityEventsForDate(currentDate).length;
    const hours = days.reduce((sum, day) => sum + universityEventsForDate(day).reduce((acc, event) => acc + Math.max(0, toMinutes(event.end) - toMinutes(event.start)), 0), 0);
    $('#universityWeekSummary').innerHTML = `\n      <div><strong>${total}</strong><span>занятий за неделю</span></div>\n      <div><strong>${formatDuration(hours)}</strong><span>учебного времени</span></div>\n      <div><strong>${todayCount}</strong><span>в выбранный день</span></div>`;
    $('#universityAgenda').innerHTML = days.map((day) => {
      const events = universityEventsForDate(day);
      const key = dateKey(day); const selected = key === dateKey(currentDate); const isToday = key === todayKey();
      return `<section class="uni-day ${selected ? 'selected' : ''}"><button class="uni-day-head" data-day="${key}" type="button"><span><strong>${escapeHtml(weekdayShort(day))}</strong><b>${day.getDate()}</b>${isToday ? '<em>сегодня</em>' : ''}</span><small>${events.length ? `${events.length} ${formatCount(events.length, 'пара', 'пары', 'пар')}` : 'свободно'}</small></button><div class="uni-day-events">${events.length ? events.map((event) => renderUniversityEventCard(event)).join('') : `<div class="uni-empty">Нет занятий</div>`}</div></section>`;
    }).join('');
  }

  function renderCalendarMode() {
    const uni = calendarMode === 'university';
    $('#calendarPlanPanel')?.classList.toggle('hidden', uni);
    $('#universityCalendarPanel')?.classList.toggle('hidden', !uni);
    $$('.calendar-mode-btn').forEach((button) => {
      const active = button.dataset.calendarMode === calendarMode;
      button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active));
    });
    if (uni) renderUniversityWeek();
  }

  function openUniversitySetup() {
    $('#universityGroupInput').value = data.university.groupCode || '';
    $('#universityImportStatus').textContent = data.university.events.length ? `${data.university.events.length} занятий загружено. ${formatImportedAt(data.university.importedAt)}.` : 'После импорта пары появятся во вкладке «РЭУ».';
    openModal('universitySetupBackdrop');
    setTimeout(() => $('#universityGroupInput').focus(), 100);
  }

  function openOfficialReaSchedule() {
    const popup = window.open('https://rasp.rea.ru/', '_blank', 'noopener,noreferrer');
    if (!popup) showToast('Safari заблокировал новое окно. Открой rasp.rea.ru вручную.');
  }

  function extractGroupCode(value) {
    const text = String(value || '').trim();
    const labeled = text.match(/(?:группа|group)\s*[:#\-]?\s*([^|,]+)/i)?.[1]?.trim();
    return (labeled || text).slice(0, 80);
  }

  function saveUniversityGroup() {
    const value = extractGroupCode($('#universityGroupInput').value);
    if (!value) { showToast('Укажи номер группы.'); return; }
    const changed = value !== data.university.groupCode;
    if (changed && data.university.events.length && !confirm('Сменить группу? Старое расписание будет удалено, чтобы не смешать группы.')) return;
    data.university.groupCode = value; data.university.groupName = value; data.university.source = 'rasp.rea.ru';
    if (changed) { data.university.events = []; data.university.importedAt = null; }
    repairAndPersist(); saveData(); closeModal('universitySetupBackdrop'); renderAll();
    showToast(changed && data.university.events.length === 0 ? `Группа ${value} сохранена. Теперь импортируй её расписание.` : `Группа ${value} сохранена.`);
  }

  function importUniversityIcs(file) {
    if (file.size > 5_000_000) { showToast('Файл расписания слишком большой.'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const result = parseUniversityIcs(String(reader.result || ''));
        if (!result.events.length) throw new Error('empty');
        const normalizedEvents = normalizeUniversity(result).events;
        data.university.events = normalizedEvents; data.university.importedAt = new Date().toISOString();
        const groupFromCalendar = extractGroupCode(result.calendarName);
        if (groupFromCalendar && !data.university.groupCode) data.university.groupCode = groupFromCalendar;
        const conflicts = repairUniversityTaskConflicts();
        saveData(); closeModal('universitySetupBackdrop'); calendarMode = 'university'; renderAll();
        showToast(conflicts ? `Расписание загружено. ${conflicts} задач${formatCount(conflicts, 'а', 'и', '')} перенесено во входящие из-за конфликтов.` : `Расписание загружено: ${normalizedEvents.length} занятий.`);
      } catch { showToast('Не удалось прочитать .ics. Экспортируй календарь заново из расписания РЭУ.'); }
    };
    reader.onerror = () => showToast('Не удалось прочитать файл расписания.');
    reader.readAsText(file);
  }

  function openUniversityEvent(id) {
    const event = universityEventById(id); if (!event) return;
    selectedUniversityEventId = String(id);
    $('#universityEventKicker').textContent = event.type || 'ПАРА';
    $('#universityEventTitle').textContent = event.subject;
    $('#universityEventDetails').innerHTML = `\n      <div><span>Дата</span><strong>${escapeHtml(longDate(dateFromKey(event.date)))}</strong></div>\n      <div><span>Время</span><strong>${escapeHtml(event.start)}–${escapeHtml(event.end)}</strong></div>\n      ${event.teacher ? `<div><span>Преподаватель</span><strong>${escapeHtml(event.teacher)}</strong></div>` : ''}\n      ${event.room ? `<div><span>Аудитория</span><strong>${escapeHtml(event.room)}</strong></div>` : ''}\n      ${event.note ? `<div class="uni-detail-note"><span>Примечание</span><small>${escapeHtml(event.note).slice(0, 400)}</small></div>` : ''}`;
    openModal('universityEventBackdrop');
  }

  function addTaskFromUniversityEvent(id) {
    const event = universityEventById(id); if (!event) return;
    closeModal('universityEventBackdrop');
    openTaskSheet(null, {
      title: `Подготовиться к «${event.subject}»`,
      category: 'Учёба',
      deadline: event.date,
      deadlineTime: event.start,
      note: `К паре: ${event.subject}${event.teacher ? ` · ${event.teacher}` : ''}${event.room ? ` · ${event.room}` : ''}`,
      linkedUniversityEventId: event.id
    });
  }

  function renderToday() {
    const key = dateKey(currentDate); const load = dayLoad(key); const inbox = getOpenInbox();
    const capacity = workingCapacityMinutes(); const pctRaw = capacity ? Math.round((load.occupied / capacity) * 100) : 0; const pct = Math.min(100, Math.max(0, pctRaw));
    const isToday = key === todayKey(); const working = isWorkingDay(currentDate);
    const dueToday = data.tasks.filter((task) => !task.done && task.deadline === key).length;
    const overdue = isToday ? data.tasks.filter(taskIsOverdue).length : 0;
    $('#todayEyebrow').textContent = isToday ? 'СЕГОДНЯ' : longDate(currentDate).toUpperCase();
    $('#todayTitle').textContent = isToday ? 'Твой день.' : `План на ${shortDate(currentDate)}.`;
    const summaryBits = [];
    if (!working) summaryBits.push('Выходной. Можно включить выходные в настройках или выбрать рабочий день.');
    else if (!data.tasks.length && !data.university.events.length) summaryBits.push('Добавь задачу или подключи расписание РЭУ.');
    else {
      if (dueToday) summaryBits.push(`${dueToday} ${formatCount(dueToday, 'задача', 'задачи', 'задач')} с дедлайном сегодня.`);
      if (overdue) summaryBits.push(`${overdue} просрочено.`);
      if (!summaryBits.length) summaryBits.push('Пары и ручные задачи вместе формируют загрузку дня.');
    }
    $('#todaySubtitle').textContent = summaryBits.join(' ');
    $('#todayDateText').textContent = shortDate(currentDate);
    $('#focusValue').textContent = `${pct}%`; $('#focusRingValue').textContent = `${pct}%`;
    const taskLoadLabel = `${formatDuration(load.work)} задачи${load.reserve ? ` + ${formatDuration(load.reserve)} резерв` : ''}`;
    const classLabel = load.classWork ? ` + ${formatDuration(load.classWork)} пары` : '';
    $('#focusLabel').textContent = `${taskLoadLabel}${classLabel} из ${formatDuration(capacity)} · ${load.tasks.length} ${formatCount(load.tasks.length, 'задача', 'задачи', 'задач')} · ${load.classes.length} ${formatCount(load.classes.length, 'пара', 'пары', 'пар')}${pctRaw > 100 ? ` · перегруз ${pctRaw - 100}%` : ''}`;
    $('#focusProgress').style.width = `${pct}%`; $('#focusRing').style.setProperty('--ring-pct', `${pct * 3.6}deg`);
    $('#focusProgress').dataset.over = pctRaw > 100 ? 'true' : 'false'; $('#focusRing').dataset.over = pctRaw > 100 ? 'true' : 'false';
    $('#dayStatusText').textContent = !working ? 'ВЫХОДНОЙ' : pctRaw > 100 ? 'ПЕРЕГРУЗ' : load.tasks.length || load.classes.length ? 'ПЛАН ДНЯ' : 'СВОБОДНЫЙ ДЕНЬ';
    $('#statusDot').dataset.state = !working ? 'off' : pctRaw > 100 ? 'over' : load.tasks.length || load.classes.length ? 'on' : 'idle';
    const next = getNextAgendaItem(currentDate);
    if (next) {
      $('#nextUpCard').classList.remove('hidden');
      const item = next.item;
      if (next.kind === 'class') {
        const live = key === todayKey() && nowMinutes() >= next.start && nowMinutes() < next.end;
        $('#nextUpTitle').textContent = live ? `Сейчас · ${item.subject}` : item.subject;
        $('#nextUpMeta').textContent = `${item.start}–${item.end} · ${item.type}${item.teacher ? ` · ${item.teacher}` : ''}${item.room ? ` · ${item.room}` : ''}`;
        $('#nextUpAction').textContent = 'Открыть'; $('#nextUpAction').dataset.kind = 'class'; $('#nextUpAction').dataset.uniId = item.id; $('#nextUpAction').dataset.taskId = '';
      } else {
        const live = key === todayKey() && nowMinutes() >= next.start && nowMinutes() < next.end;
        $('#nextUpTitle').textContent = live ? `Сейчас · ${item.title}` : item.title;
        $('#nextUpMeta').textContent = `${item.scheduledStart}–${scheduleEnd(item)} · ${formatDuration(item.duration)} · вручную`;
        $('#nextUpAction').textContent = 'Открыть'; $('#nextUpAction').dataset.kind = 'task'; $('#nextUpAction').dataset.taskId = item.id; $('#nextUpAction').dataset.uniId = '';
      }
    } else {
      $('#nextUpCard').classList.add('hidden'); $('#nextUpAction').dataset.taskId = ''; $('#nextUpAction').dataset.uniId = ''; $('#nextUpAction').dataset.kind = '';
    }
    const agenda = getAgendaItemsForDate(currentDate, true);
    $('#todayAgenda').innerHTML = agenda.length ? agenda.slice(0, 14).map((entry) => entry.kind === 'class' ? renderAgendaUniversityCard(entry.item) : renderAgendaCard(entry.item)).join('') : emptyState('Здесь появится расписание.', inbox.length ? 'Открытые задачи без времени ждут ручного назначения.' : 'Добавь первую задачу через + или подключи расписание РЭУ.');
    $('#inboxCount').textContent = String(inbox.length);
    $('#todayInbox').innerHTML = inbox.length ? inbox.slice(0, 8).map(renderInboxRow).join('') : emptyState('Входящих задач нет.', 'Все открытые задачи уже имеют время.');
  }

  function scheduleEnd(task) { return hm(toMinutes(task.scheduledStart) + task.duration); }
  function renderAgendaUniversityCard(event) {
    const meta = [event.type, event.teacher, event.room].filter(Boolean).join(' · ');
    return `<button class="agenda-card university" data-open-uni-event="${escapeHtml(event.id)}" type="button"><span class="agenda-time"><strong>${escapeHtml(event.start)}</strong><small>${escapeHtml(event.end)}</small></span><span class="agenda-main"><strong class="agenda-title">${escapeHtml(event.subject)}</strong><small class="agenda-meta">🎓 ${escapeHtml(meta || 'Пара')}</small></span><span class="chevron">›</span></button>`;
  }

  function renderAgendaCard(task) {
    return `<button class="agenda-card manual" data-edit-task="${escapeHtml(task.id)}" type="button"><span class="agenda-time">${escapeHtml(task.scheduledStart)}<small>${escapeHtml(scheduleEnd(task))}</small></span><span class="agenda-main"><strong class="agenda-title">${escapeHtml(task.title)}</strong><small class="agenda-meta">${formatDuration(task.duration)} · ${escapeHtml(task.category)} · вручную · ${escapeHtml(deadlineLabel(task))}</small></span><span class="chevron">›</span></button>`;
  }
  function renderInboxRow(task) {
    return `<div class="inbox-row"><button class="task-check" data-toggle-task="${escapeHtml(task.id)}" type="button" aria-label="Отметить выполненной">✓</button><button class="row-main" data-edit-task="${escapeHtml(task.id)}" type="button"><strong class="inbox-title">${escapeHtml(task.title)}</strong><small class="inbox-meta">${deadlineLabel(task)} · ${formatDuration(task.duration)} · ${priorityLabel(task.priority)}${taskIsOverdue(task) ? ' · нужен перенос' : ''}</small></button></div>`;
  }
  function emptyState(title, subtitle) { return `<div class="empty-card"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(subtitle)}</span></div>`; }

  function renderCalendar() {
    const monday = getWeekStart(currentDate);
    $('#weekRange').textContent = `${shortDate(monday)} — ${shortDate(addDays(monday, 6))}`;
    $('#weekStrip').innerHTML = Array.from({ length: 7 }, (_, index) => {
      const day = addDays(monday, index); const key = dateKey(day); const count = getAgendaItemsForDate(key, false).length;
      const load = dayLoad(day); const cap = workingCapacityMinutes(); const pct = cap ? Math.min(100, Math.round(load.occupied / cap * 100)) : 0;
      return `<button class="week-day ${key === dateKey(currentDate) ? 'active' : ''} ${key === todayKey() ? 'today' : ''} ${count ? 'has-task' : ''}" data-day="${key}" type="button"><span class="dow">${escapeHtml(weekdayShort(day))}</span><span class="num">${day.getDate()}</span><span class="load-mini"><span style="width:${Math.min(100,pct)}%"></span></span></button>`;
    }).join('');
    const load = dayLoad(currentDate); const pctRaw = workingCapacityMinutes() ? Math.round((load.occupied / workingCapacityMinutes()) * 100) : 0;
    $('#calendarDateLabel').textContent = dateKey(currentDate) === todayKey() ? 'Сегодня' : longDate(currentDate);
    $('#calendarLoadLabel').textContent = `${formatDuration(load.work)} задачи${load.classWork ? ` + ${formatDuration(load.classWork)} пары` : ''}${load.reserve ? ` + ${formatDuration(load.reserve)} резерв` : ''} · ${load.tasks.length} задач · ${load.classes.length} пар${pctRaw > 100 ? ` · перегруз ${pctRaw - 100}%` : ''}`;
    $('#calendarLoadValue').textContent = `${Math.min(100, Math.max(0, pctRaw))}%`;
    const agenda = getAgendaItemsForDate(currentDate, true);
    $('#calendarAgenda').innerHTML = agenda.length ? agenda.map((entry) => entry.kind === 'class' ? renderCalendarUniversityBlock(entry.item) : `<button class="calendar-block" data-edit-task="${escapeHtml(entry.item.id)}" type="button"><span class="calendar-time">${escapeHtml(entry.item.scheduledStart)}<small>${escapeHtml(scheduleEnd(entry.item))}</small></span><span class="calendar-slot manual ${entry.item.done ? 'done' : ''} ${taskIsOverdue(entry.item) ? 'overdue' : ''}"><strong>${escapeHtml(entry.item.title)}</strong><small>${formatDuration(entry.item.duration)} · вручную · ${escapeHtml(deadlineLabel(entry.item))}${entry.item.category ? ` · ${escapeHtml(entry.item.category)}` : ''}</small></span></button>`).join('') : emptyState('На этот день пусто.', 'Выбери другой день или добавь задачу через +.');
  }

  function renderCalendarUniversityBlock(event) {
    return `<button class="calendar-block university" data-open-uni-event="${escapeHtml(event.id)}" type="button"><span class="calendar-time">${escapeHtml(event.start)}<small>${escapeHtml(event.end)}</small></span><span class="calendar-slot university"><strong>${escapeHtml(event.subject)}</strong><small>🎓 ${escapeHtml([event.type, event.teacher, event.room].filter(Boolean).join(' · ') || 'Пара')}</small></span></button>`;
  }

  function renderTasks() {
    const search = ($('#taskSearch')?.value || '').trim().toLowerCase();
    const tasks = data.tasks.filter((task) => {
      const matchesFilter = activeFilter === 'all' || (activeFilter === 'open' && !task.done) || (activeFilter === 'planned' && !task.done && !!task.scheduledDate) || (activeFilter === 'due' && !task.done && !!task.deadline) || (activeFilter === 'inbox' && !task.done && !task.scheduledDate) || (activeFilter === 'overdue' && taskIsOverdue(task)) || (activeFilter === 'done' && task.done);
      const haystack = `${task.title} ${task.note} ${task.category}`.toLowerCase();
      return matchesFilter && (!search || haystack.includes(search));
    }).sort((a, b) => { if (a.done !== b.done) return a.done ? 1 : -1; return taskUrgencyScore(a) - taskUrgencyScore(b) || b.priority - a.priority; });
    const open = data.tasks.filter((task) => !task.done).length;
    $('#taskSummary').textContent = `${open} ${formatCount(open, 'открытая задача', 'открытые задачи', 'открытых задач')}`;
    $('#filterCount').textContent = activeFilter === 'all' ? '' : `· ${filterLabel(activeFilter)}`;
    $$('#filterPopover button').forEach((button) => button.classList.toggle('active', button.dataset.filter === activeFilter));
    $('#allTaskList').innerHTML = tasks.length ? tasks.map(renderTaskRow).join('') : emptyState(search ? 'Ничего не найдено.' : 'Задач пока нет.', search ? 'Попробуй другой запрос.' : 'Добавь первую задачу через +.');
  }
  function filterLabel(filter) { return ({ open: 'открытые', planned: 'в плане', due: 'с дедлайном', inbox: 'без времени', overdue: 'просроченные', done: 'готово' }[filter] || 'все'); }
  function renderTaskRow(task) {
    const priority = priorityLabel(task.priority); const deadline = deadlineLabel(task); const schedule = scheduleLabel(task);
    const status = task.done ? 'Готово' : taskIsOverdue(task) ? 'Нужен перенос' : (!task.scheduledDate ? 'Без времени' : 'Вручную');
    const linkedClass = task.linkedUniversityEventId && universityEventById(task.linkedUniversityEventId) ? '🎓 К паре' : '';
    return `<div class="task-row ${task.done ? 'done' : ''}"><button class="task-check ${task.done ? 'done' : ''}" data-toggle-task="${escapeHtml(task.id)}" type="button" aria-label="${task.done ? 'Вернуть в работу' : 'Выполнить'}">${task.done ? '✓' : ''}</button><button class="task-main" data-edit-task="${escapeHtml(task.id)}" type="button"><strong class="task-title">${escapeHtml(task.title)}</strong><span class="task-badges"><span class="badge ${priorityClass(task.priority)}">${escapeHtml(priority)}</span><span class="badge">${escapeHtml(formatDuration(task.duration))}</span><span class="badge">${escapeHtml(deadline)}</span><span class="badge">${escapeHtml(status)}</span>${linkedClass ? `<span class="badge">${escapeHtml(linkedClass)}</span>` : ''}</span></button></div>`;
  }

  function renderSettings() {
    $('#workStartInput').value = hm(data.settings.workStart * 60); $('#workEndInput').value = hm(data.settings.workEnd * 60);
    $('#lunchStartInput').value = hm(data.settings.lunchStart * 60); $('#lunchEndInput').value = hm(data.settings.lunchEnd * 60);
    $('#bufferInput').value = String(data.settings.buffer); $('#blockInput').value = String(data.settings.focusLength);
    $('#weekendsInput').checked = data.settings.weekends; $('#appearanceInput').value = data.settings.theme;
  }

  function updateAppVersion() { $('#appVersionLabel').textContent = `v${APP_VERSION}`; }

  function openModal(id) {
    const modal = $(`#${id}`); if (!modal) return;
    if (modalCloseTimers.has(id)) { clearTimeout(modalCloseTimers.get(id)); modalCloseTimers.delete(id); }
    modal.hidden = false;
    requestAnimationFrame(() => modal.classList.add('open'));
    document.body.classList.add('modal-open');
  }

  function closeModal(id) {
    const modal = $(`#${id}`); if (!modal) return;
    modal.classList.remove('open');
    if (modalCloseTimers.has(id)) clearTimeout(modalCloseTimers.get(id));
    modalCloseTimers.set(id, setTimeout(() => {
      modal.hidden = true; modalCloseTimers.delete(id);
      if (!$$('.modal-backdrop.open').length) document.body.classList.remove('modal-open');
    }, 220));
  }

  function closeAllModals() {
    modalCloseTimers.forEach((timer) => clearTimeout(timer)); modalCloseTimers.clear();
    $$('.modal-backdrop').forEach((modal) => { modal.classList.remove('open'); modal.hidden = true; });
    document.body.classList.remove('modal-open'); editingId = null;
  }

  function openTaskSheet(id = null, preset = null) {
    editingId = id ? String(id) : null;
    const task = id ? byId(id) : null;
    $('#taskForm').reset();
    $('#taskSheetKicker').textContent = task ? 'РЕДАКТИРОВАНИЕ' : 'НОВАЯ ЗАДАЧА';
    $('#taskSheetTitle').textContent = task ? 'Измени задачу' : 'Что нужно сделать?';
    $('#saveTaskBtn').textContent = task ? 'Сохранить' : 'Добавить'; $('#deleteTaskBtn').hidden = !task; $('#taskSmartActions').classList.toggle('hidden', !task || task.done || !task.scheduledDate);
    $('#clearTaskScheduleBtn').disabled = !task || task.done || (!task.scheduledDate && !task.scheduledStart);
    draftLinkedUniversityEventId = task?.linkedUniversityEventId || preset?.linkedUniversityEventId || null;
    $('#taskTitle').value = task?.title || preset?.title || ''; $('#taskDuration').value = String(task?.duration || preset?.duration || 60); $('#taskPriority').value = String(task?.priority || preset?.priority || 2);
    $('#taskDeadline').value = task ? (task.deadline || '') : (preset?.deadline || ''); $('#taskDeadlineTime').value = task?.deadlineTime || preset?.deadlineTime || '';
    $('#taskCategory').value = task?.category || preset?.category || 'Учёба'; $('#taskNote').value = task?.note || preset?.note || '';
    $('#taskScheduleDate').value = task?.scheduledDate || preset?.scheduledDate || ''; $('#taskScheduleTime').value = task?.scheduledStart || preset?.scheduledStart || '';
    const linkedClass = draftLinkedUniversityEventId ? universityEventById(draftLinkedUniversityEventId) : null;
    $('#taskLinkedClassContext')?.classList.toggle('hidden', !linkedClass);
    if (linkedClass) $('#taskLinkedClassText').textContent = `${linkedClass.subject} · ${linkedClass.start}–${linkedClass.end}${linkedClass.room ? ` · ${linkedClass.room}` : ''}`;
    const today = todayKey(); $('#taskDeadline').min = today; $('#taskScheduleDate').min = today;
    updateTaskLogicHint(); updateManualHint(); openModal('taskSheetBackdrop'); setTimeout(() => $('#taskTitle').focus(), 100);
  }

  function updateTaskLogicHint() {
    const duration = Number($('#taskDuration')?.value || 60); const priority = Number($('#taskPriority')?.value || 2); const deadline = $('#taskDeadline')?.value; const deadlineTime = $('#taskDeadlineTime')?.value;
    const bits = [`${formatDuration(duration)} — реальная длина слота`, `${priorityLabel(priority)} — влияет на порядок задач и визуальный акцент`];
    if (deadline) bits.push(`дедлайн — ${deadlineTime ? `до ${deadlineTime}` : 'до конца дня'}`);
    else bits.push('без дедлайна — срок не ограничивает задачу');
    $('#taskLogicHint').textContent = bits.join(' · ');
  }

  function updateManualHint() {
    const hint = $('#manualScheduleHint'); if (!hint) return;
    const existing = editingId ? byId(editingId) : null;
    const taskLike = { ...(existing || {}), id: existing?.id || '__new__', duration: Number($('#taskDuration')?.value || 0), deadline: $('#taskDeadline')?.value || null, deadlineTime: $('#taskDeadlineTime')?.value || null };
    const text = slotValidationText(taskLike); hint.textContent = text; hint.dataset.state = text.startsWith('Свободно') || text.startsWith('Без времени') ? 'ok' : 'error';
  }

  function populateFocusTasks() {
    const select = $('#focusTaskSelect'); if (!select) return;
    const current = focusTaskId || select.value; const open = data.tasks.filter((task) => !task.done);
    select.innerHTML = open.length ? open.map((task) => `<option value="${escapeHtml(task.id)}">${escapeHtml(task.title)}</option>`).join('') : '<option value="">Нет открытых задач</option>';
    if (open.some((task) => String(task.id) === String(current))) select.value = String(current);
    else if (open[0] && !focusRunning) { select.value = String(open[0].id); focusTaskId = String(open[0].id); }
    select.disabled = focusRunning;
  }

  function openFocusSheet() { populateFocusTasks(); openModal('focusSheetBackdrop'); updateFocusTip(); updateFocusUI(); }
  function updateFocusTip() {
    const hasTask = Boolean($('#focusTaskSelect').value);
    $('#focusTip').textContent = focusRunning ? 'Фокус идёт. Выбор задачи заблокирован.' : hasTask ? 'Сессия засчитается в статистику после завершения.' : 'Сначала добавь хотя бы одну открытую задачу.';
  }

  function focusBaseSeconds() { return Math.max(1, Number(focusPlannedMinutes || data.settings.focusLength) || 25) * 60; }
  function tickFocusTimer() {
    if (!focusRunning || !focusEndAt) return;
    focusRemaining = Math.max(0, Math.ceil((focusEndAt - Date.now()) / 1000));
    updateFocusUI();
    if (focusRemaining <= 0) finishFocusSession();
  }
  function updateFocusUI() {
    const length = Math.max(1, focusBaseSeconds());
    const pct = Math.max(0, Math.min(1, 1 - focusRemaining / length));
    const seconds = Math.max(0, focusRemaining);
    $('#timerText').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    $('#timerRing').style.setProperty('--timer-pct', `${pct * 360}deg`);
    $('#timerStart').textContent = focusRunning ? 'Пауза' : 'Старт';
    $('#timerMode').textContent = focusRunning ? 'ФОКУС' : 'ГОТОВ';
    $('#focusTaskSelect').disabled = focusRunning;
    updateFocusTip();
  }

  function resetFocusTimer() {
    clearInterval(focusTimer); focusTimer = null; focusRunning = false; focusEndAt = null; focusSessionDate = null;
    focusPlannedMinutes = Number(data.settings.focusLength) || 25; focusRemaining = focusBaseSeconds();
    focusTaskId = $('#focusTaskSelect')?.value || null; updateFocusUI();
  }

  function toggleFocusTimer() {
    const selectId = $('#focusTaskSelect').value;
    if (!selectId && !focusTaskId) { showToast('Сначала добавь задачу.'); return; }
    if (focusRunning) {
      tickFocusTimer();
      if (!focusRunning) return;
      clearInterval(focusTimer); focusTimer = null; focusRunning = false; focusEndAt = null; updateFocusUI(); showToast('Фокус на паузе.');
      return;
    }
    focusTaskId = focusTaskId || selectId; focusPlannedMinutes = focusPlannedMinutes || Number(data.settings.focusLength) || 25;
    if (focusRemaining <= 0 || focusRemaining > focusBaseSeconds()) focusRemaining = focusBaseSeconds();
    focusRunning = true; focusSessionDate = focusSessionDate || todayKey(); focusEndAt = Date.now() + focusRemaining * 1000;
    clearInterval(focusTimer); focusTimer = setInterval(tickFocusTimer, 250); tickFocusTimer(); updateFocusUI();
  }

  function finishFocusSession() {
    if (!focusRunning && focusRemaining > 0) return;
    clearInterval(focusTimer); focusTimer = null; focusRunning = false; focusEndAt = null;
    const taskId = focusTaskId || $('#focusTaskSelect').value || null;
    const task = taskId ? byId(taskId) : null;
    const minutes = Math.max(1, Number(focusPlannedMinutes || data.settings.focusLength));
    data.focus.sessions.push({ date: focusSessionDate || todayKey(), taskId: taskId ? String(taskId) : null, minutes, completedAt: new Date().toISOString() });
    data.focus.sessions = data.focus.sessions.slice(-500); data.focus.totalMinutes = data.focus.sessions.reduce((sum, session) => sum + session.minutes, 0);
    focusRemaining = 0; saveData(); renderAll();
    showToast(task ? `Фокус завершён · ${task.title}` : 'Фокус-сессия завершена.');
    focusRemaining = focusBaseSeconds(); focusSessionDate = null; updateFocusUI();
  }

  function renderPlanHealth() {
    const health = getPlanHealth();
    const statusClass = health.overloaded || health.overdue ? 'warning' : '';
    $('#healthGrid').innerHTML = `
      <div class="health-card"><strong>${health.open}</strong><small>открытых задач</small></div>
      <div class="health-card ${health.inbox ? 'warning' : ''}"><strong>${health.inbox}</strong><small>без времени</small></div>
      <div class="health-card ${health.overdue ? 'danger' : ''}"><strong>${health.overdue}</strong><small>просрочено</small></div>
    `;
    const items = [];
    if (health.overdue) items.push(`<div class="health-item"><span class="health-icon" aria-hidden="true">🚨</span><div><strong>${health.overdue} просрочено</strong><small>Открой задачу и поставь новый дедлайн или ближайшее свободное окно.</small></div></div>`);
    if (health.inbox) items.push(`<div class="health-item"><span class="health-icon" aria-hidden="true">📥</span><div><strong>${health.inbox} без времени</strong><small>Их можно поставить вручную в карточке задачи.</small></div></div>`);
    if (health.due48h) items.push(`<div class="health-item"><span class="health-icon" aria-hidden="true">⏰</span><div><strong>${health.due48h} с дедлайном в ближайшие 48 часов</strong><small>Проверь, хватает ли свободного времени до срока.</small></div></div>`);
    if (health.overloaded) items.push(`<div class="health-item"><span class="health-icon" aria-hidden="true">⚠️</span><div><strong>${health.overloaded} перегруженных дня</strong><small>Открой задачи и перенеси часть слотов на свободные дни.</small></div></div>`);
    if (!items.length) items.push(`<div class="health-item"><span class="health-icon" aria-hidden="true">✅</span><div><strong>План в порядке</strong><small>Критичных конфликтов, просрочек и перегруженных дней не найдено.</small></div></div>`);
    $('#healthList').innerHTML = items.join('');
    openModal('healthSheetBackdrop');
  }

  function renderInsights() {
    const monday = getWeekStart(currentDate); const days = Array.from({ length: 7 }, (_, index) => dateKey(addDays(monday, index)));
    const weekStart = monday.getTime(); const weekEnd = addDays(monday, 7).getTime();
    const completed = data.tasks.filter((task) => task.done && task.completedAt && new Date(task.completedAt).getTime() >= weekStart && new Date(task.completedAt).getTime() < weekEnd).length;
    const planned = data.tasks.filter((task) => !task.done && task.scheduledDate && days.includes(task.scheduledDate)).reduce((sum, task) => sum + task.duration, 0);
    const focusMinutes = data.focus.sessions.filter((session) => {
      const date = dateFromKey(session.date).getTime(); return date >= weekStart && date < weekEnd;
    }).reduce((sum, session) => sum + session.minutes, 0);
    const values = days.map((key) => data.tasks.filter((task) => task.scheduledDate === key && !task.done).reduce((sum, task) => sum + task.duration + Number(data.settings.buffer || 0), 0));
    $('#insightStats').innerHTML = `<div class="stat-card"><strong>${completed}</strong><small>готово за неделю</small></div><div class="stat-card"><strong>${formatDuration(planned)}</strong><small>в плане за неделю</small></div><div class="stat-card"><strong>${focusMinutes}м</strong><small>фокус за неделю</small></div>`;
    const max = Math.max(60, ...values);
    $('#barChart').innerHTML = values.map((value, index) => `<div class="chart-bar"><div class="chart-fill" style="height:${Math.max(value ? 8 : 2, Math.round(value / max * 100))}%"></div><span class="chart-label">${escapeHtml(weekdayShort(dateFromKey(days[index])).slice(0, 2))}</span></div>`).join('');
    const avg = Math.round(values.reduce((sum, value) => sum + value, 0) / 7);
    $('#insightRecTitle').textContent = !data.tasks.length ? 'Пустой старт' : avg > workingCapacityMinutes() * 0.75 ? 'Плотная неделя' : 'Есть запас';
    $('#insightRecText').textContent = !data.tasks.length ? 'Добавь несколько задач, и здесь появится ритм недели.' : avg > workingCapacityMinutes() * 0.75 ? 'Буфер уже учтён в нагрузке — переносы лучше оставлять на свободное время.' : `В среднем занято около ${formatDuration(avg)} в день.`;
    openModal('insightsSheetBackdrop');
  }

  function downloadBackup(json, fileName) {
    const blob = new Blob([json], { type: 'application/json' }); const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = fileName; document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 250); showToast('Резервная копия подготовлена.');
  }

  function exportData() {
    const json = JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 2);
    const fileName = `tavrimo-backup-${todayKey()}.json`;
    try {
      const file = new File([json], fileName, { type: 'application/json' });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        navigator.share({ title: `${APP_NAME} — резервная копия`, files: [file] })
          .then(() => showToast('Резервная копия подготовлена.'))
          .catch((error) => {
            if (error?.name === 'AbortError') showToast('Экспорт отменён.');
            else downloadBackup(json, fileName);
          });
        return;
      }
    } catch { /* fallback */ }
    downloadBackup(json, fileName);
  }

  function importData(file) {
    if (file.size > 2_000_000) { showToast('Резервная копия слишком большая.'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(String(reader.result || ''));
        if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tasks) || raw.tasks.length > 10_000) throw new Error('invalid');
        const parsed = normalizeData(raw);
        if (!parsed.tasks.length && raw.tasks.length) throw new Error('invalid tasks');
        data = parsed; saveData(); closeModal('settingsSheetBackdrop'); renderAll(); showToast('Данные импортированы.');
      } catch {
        showToast('Не удалось прочитать эту резервную копию.');
      }
    };
    reader.onerror = () => showToast('Не удалось прочитать файл.');
    reader.readAsText(file);
  }

  function showToast(message) {
    clearTimeout(toastTimer); const toast = $('#toast'); toast.textContent = message; toast.classList.add('show');
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
  }

  function switchView(view, options = {}) {
    if (!['today', 'calendar', 'tasks', 'more'].includes(view)) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; currentView = view;
    const update = () => renderAll(); if (!reduce && document.startViewTransition) document.startViewTransition(update); else update();
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  }

  function updateDateFromInput(value) {
    if (!isValidDateKey(value)) { showToast('Выбери существующую дату.'); return; }
    currentDate = startOfDay(dateFromKey(value)); renderAll();
  }

  function repairAndPersist() {
    const repaired = repairData(data);
    data = repaired.data;
    if (repaired.changed) saveData();
  }

  function validateSettingsDraft(workStart, workEnd, lunchStart, lunchEnd) {
    if (!Number.isFinite(workStart) || !Number.isFinite(workEnd) || !Number.isFinite(lunchStart) || !Number.isFinite(lunchEnd)) return 'Проверь рабочие часы.';
    if (workEnd <= workStart) return 'Конец рабочего дня должен быть позже начала.';
    if (lunchEnd <= lunchStart || lunchStart < workStart || lunchEnd > workEnd) return 'Обед должен находиться внутри рабочего дня.';
    if (workStart % 15 || workEnd % 15 || lunchStart % 15 || lunchEnd % 15) return 'Время должно быть кратно 15 минутам.';
    if ((workEnd - workStart) - (lunchEnd - lunchStart) < 15) return 'В рабочем дне должно остаться хотя бы 15 минут.';
    return '';
  }

  function bindEvents() {
    $('#tabAdd').addEventListener('click', () => openTaskSheet());
    $('#todayDateChip').addEventListener('click', () => { $('#datePickerInput').value = dateKey(currentDate); openModal('dateSheetBackdrop'); });
    $('#closeDateSheet').addEventListener('click', () => closeModal('dateSheetBackdrop'));
    $('#datePickerInput').addEventListener('change', (event) => { updateDateFromInput(event.target.value); closeModal('dateSheetBackdrop'); });
    $('#datePrev').addEventListener('click', () => { currentDate = addDays(currentDate, -1); $('#datePickerInput').value = dateKey(currentDate); renderAll(); });
    $('#dateNext').addEventListener('click', () => { currentDate = addDays(currentDate, 1); $('#datePickerInput').value = dateKey(currentDate); renderAll(); });
    $('#dateTodayBtn').addEventListener('click', () => { currentDate = startOfDay(new Date()); $('#datePickerInput').value = dateKey(currentDate); renderAll(); closeModal('dateSheetBackdrop'); });

    $('#nextUpAction').addEventListener('click', () => { const kind = $('#nextUpAction').dataset.kind; const id = kind === 'class' ? $('#nextUpAction').dataset.uniId : $('#nextUpAction').dataset.taskId; if (!id) return; if (kind === 'class') openUniversityEvent(id); else openTaskSheet(id); });
    $('#clearTaskScheduleBtn').onclick = () => { if (!editingId) return; clearTaskSchedule(editingId); closeModal('taskSheetBackdrop'); showToast('Время снято. Задача снова во входящих.'); };
    $('#calendarToday').addEventListener('click', () => { currentDate = startOfDay(new Date()); renderAll(); });
    $('#calendarPrevWeek').addEventListener('click', () => { currentDate = addDays(currentDate, -7); renderAll(); });
    $('#calendarNextWeek').addEventListener('click', () => { currentDate = addDays(currentDate, 7); renderAll(); });
    $$('.tab[data-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
    $('#todayAgenda').addEventListener('click', handleDelegatedActions); $('#todayInbox').addEventListener('click', handleDelegatedActions);
    $('#calendarAgenda').addEventListener('click', handleDelegatedActions); $('#allTaskList').addEventListener('click', handleDelegatedActions);
    $('#universityAgenda').addEventListener('click', handleUniversityActions);
    $$('.calendar-mode-btn').forEach((button) => button.addEventListener('click', () => { calendarMode = button.dataset.calendarMode; renderAll(); }));
    $('#universityManageBtn').addEventListener('click', openUniversitySetup);
    $('#closeUniversitySetup').onclick = () => closeModal('universitySetupBackdrop'); $('#cancelUniversitySetup').onclick = () => closeModal('universitySetupBackdrop');
    $('#saveUniversityGroupBtn').onclick = saveUniversityGroup; $('#openReaScheduleBtn').onclick = openOfficialReaSchedule;
    $('#clearUniversityScheduleBtn').onclick = () => { if (!data.university.events.length) { showToast('Расписание уже пустое.'); return; } if (confirm('Удалить загруженное расписание РЭУ?')) { data.university.events = []; data.university.importedAt = null; saveData(); closeModal('universitySetupBackdrop'); renderAll(); showToast('Расписание РЭУ удалено.'); } };
    $('#universityIcsInput').addEventListener('change', (event) => { const file = event.target.files?.[0]; if (file) importUniversityIcs(file); event.target.value = ''; });
    $('#closeUniversityEvent').onclick = () => closeModal('universityEventBackdrop'); $('#openReaFromEventBtn').onclick = openOfficialReaSchedule;
    $('#addTaskFromUniversityEventBtn').onclick = () => { if (selectedUniversityEventId) addTaskFromUniversityEvent(selectedUniversityEventId); };
    $('#weekStrip').addEventListener('click', (event) => { const button = event.target.closest('[data-day]'); if (!button) return; currentDate = startOfDay(dateFromKey(button.dataset.day)); renderAll(); });
    $('#taskSearch').addEventListener('input', renderTasks); $('#filterButton').addEventListener('click', () => { const popover = $('#filterPopover'); popover.hidden = !popover.hidden; });
    $('#filterPopover').addEventListener('click', (event) => { const button = event.target.closest('[data-filter]'); if (!button) return; activeFilter = button.dataset.filter; $('#filterPopover').hidden = true; renderTasks(); });

    $('#closeTaskSheet').onclick = () => closeModal('taskSheetBackdrop'); $('#cancelTask').onclick = () => closeModal('taskSheetBackdrop');
    $('#taskSheetBackdrop').addEventListener('click', (event) => { if (event.target === event.currentTarget) closeModal('taskSheetBackdrop'); });
    ['taskDuration', 'taskPriority', 'taskDeadline', 'taskDeadlineTime', 'taskScheduleDate', 'taskScheduleTime'].forEach((id) => {
      $(`#${id}`)?.addEventListener('input', () => { updateTaskLogicHint(); updateManualHint(); });
      $(`#${id}`)?.addEventListener('change', () => { updateTaskLogicHint(); updateManualHint(); });
    });
    $('#deleteTaskBtn').onclick = () => { if (editingId && confirm('Удалить эту задачу?')) deleteTask(editingId); };
    $('#unlinkTaskClassBtn')?.addEventListener('click', () => { draftLinkedUniversityEventId = null; $('#taskLinkedClassContext')?.classList.add('hidden'); showToast('Связь с парой снята.'); });

    $('#onboarding')?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) finishOnboarding();
      const action = event.target.closest('#onboardingSkip, #onboardingPrev, #onboardingNext');
      if (!action) return;
      if (action.id === 'onboardingSkip') finishOnboarding();
      if (action.id === 'onboardingPrev') prevOnboarding();
      if (action.id === 'onboardingNext') nextOnboarding();
    });
    $('#onboardingHelpBtn')?.addEventListener('click', () => { closeModal('settingsSheetBackdrop'); startOnboarding(true); });
    window.addEventListener('resize', () => refreshOnboardingTarget(), { passive: true });
    window.addEventListener('scroll', () => refreshOnboardingTarget(), { passive: true });


    $('#taskForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const existing = editingId ? byId(editingId) : null;
      const title = $('#taskTitle').value.trim(); const duration = Number($('#taskDuration').value); const priority = Number($('#taskPriority').value);
      const deadline = $('#taskDeadline').value || null; const deadlineTime = $('#taskDeadlineTime').value || null;
      const category = ALLOWED_CATEGORIES.includes($('#taskCategory').value) ? $('#taskCategory').value : 'Другое'; const note = $('#taskNote').value.trim();
      const manualDate = $('#taskScheduleDate').value || ''; const manualTime = $('#taskScheduleTime').value || '';
      if (!title) { showToast('Введите название задачи.'); return; }
      if (deadline && (!isValidDateKey(deadline) || dateFromKey(deadline) < startOfDay(new Date()))) { showToast('Дедлайн не может быть в прошлом.'); return; }
      if (deadlineTime && !deadline) { showToast('Укажи дату дедлайна, если задаёшь время.'); return; }
      if (deadlineTime && !Number.isFinite(toMinutes(deadlineTime))) { showToast('Проверь время дедлайна.'); return; }
      if (!ALLOWED_DURATIONS.includes(duration)) { showToast('Проверь длительность.'); return; }
      if ((manualDate && !manualTime) || (!manualDate && manualTime)) { showToast('Укажи и дату, и время или очисти оба поля.'); return; }

      const task = existing ? { ...existing } : { id: uid(), title: '', duration: 60, priority: 2, deadline: null, deadlineTime: null, category: 'Учёба', note: '', linkedUniversityEventId: null, scheduledDate: null, scheduledStart: null, locked: false, done: false, createdAt: new Date().toISOString(), completedAt: null };
      const linkedClass = draftLinkedUniversityEventId ? universityEventById(draftLinkedUniversityEventId) : null;
      Object.assign(task, { title, duration, priority, deadline, deadlineTime, category, note, linkedUniversityEventId: linkedClass ? String(linkedClass.id) : null });

      if (manualDate && manualTime) {
        const error = validateManualSlot(task, manualDate, manualTime, duration);
        if (error) { updateManualHint(); showToast(error); return; }
        task.scheduledDate = manualDate; task.scheduledStart = manualTime; task.locked = true;
      } else {
        task.scheduledDate = null; task.scheduledStart = null; task.locked = false;
      }

      if (existing) data.tasks = data.tasks.map((item) => String(item.id) === String(existing.id) ? task : item); else data.tasks.push(task);
      repairAndPersist(); saveData(); closeModal('taskSheetBackdrop'); renderAll();
      if (!existing && task.scheduledDate) showToast('Задача добавлена вручную.');
      else if (!existing) showToast('Задача добавлена без времени.');
      else if (task.scheduledDate) showToast('Ручной слот сохранён.');
      else showToast('Изменения сохранены.');
    });

    $('#closeFocusSheet').onclick = () => closeModal('focusSheetBackdrop');
    $('#focusSheetBackdrop').addEventListener('click', (event) => { if (event.target === event.currentTarget) closeModal('focusSheetBackdrop'); });
    $('#timerStart').onclick = toggleFocusTimer; $('#timerReset').onclick = () => { if (focusRunning) { showToast('Сначала поставь фокус на паузу.'); return; } resetFocusTimer(); };
    $('#focusTaskSelect').addEventListener('change', () => { if (focusRunning) return; focusTaskId = $('#focusTaskSelect').value || null; resetFocusTimer(); updateFocusTip(); });
    $('#moreUniversity').onclick = openUniversitySetup;
    $('#moreFocus').onclick = openFocusSheet; $('#moreInsights').onclick = renderInsights; $('#moreHealth').onclick = renderPlanHealth; $('#moreSettings').onclick = () => { renderSettings(); openModal('settingsSheetBackdrop'); };

    ['insightsSheetBackdrop', 'settingsSheetBackdrop', 'dateSheetBackdrop', 'healthSheetBackdrop', 'universitySetupBackdrop', 'universityEventBackdrop'].forEach((id) => $(`#${id}`).addEventListener('click', (event) => { if (event.target === event.currentTarget) closeModal(id); }));
    $('#closeInsightsSheet').onclick = () => closeModal('insightsSheetBackdrop'); $('#closeSettingsSheet').onclick = () => closeModal('settingsSheetBackdrop'); $('#closeHealthSheet').onclick = () => closeModal('healthSheetBackdrop');

    $('#settingsForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const workStart = toMinutes($('#workStartInput').value); const workEnd = toMinutes($('#workEndInput').value); const lunchStart = toMinutes($('#lunchStartInput').value); const lunchEnd = toMinutes($('#lunchEndInput').value);
      const error = validateSettingsDraft(workStart, workEnd, lunchStart, lunchEnd); if (error) { showToast(error); return; }
      data.settings = { ...data.settings, workStart: workStart / 60, workEnd: workEnd / 60, lunchStart: lunchStart / 60, lunchEnd: lunchEnd / 60, buffer: Number($('#bufferInput').value), focusLength: Number($('#blockInput').value), weekends: $('#weekendsInput').checked, theme: $('#appearanceInput').value };
      repairAndPersist(); if (!focusRunning) resetFocusTimer(); saveData(); closeModal('settingsSheetBackdrop'); renderAll();
      showToast('Настройки сохранены. Проверь слоты, если изменились рабочие часы.');
    });

    $('#exportBtn').onclick = exportData; $('#importInput').addEventListener('change', (event) => { const file = event.target.files?.[0]; if (file) importData(file); event.target.value = ''; });
    $('#resetBtn').onclick = () => { if (confirm('Удалить все задачи, расписание и статистику?')) resetAllData(); };
    window.addEventListener('online', () => showToast('Соединение восстановлено.')); window.addEventListener('offline', () => showToast('Офлайн-режим: данные остаются на устройстве.'));
    window.addEventListener('scroll', () => $('#topbar').classList.toggle('scrolled', window.scrollY > 4), { passive: true });
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (data.settings.theme === 'system') applyTheme(); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeAllModals(); });
    document.addEventListener('click', (event) => { if (!event.target.closest('.filter-button') && !event.target.closest('#filterPopover')) $('#filterPopover').hidden = true; });
    document.addEventListener('visibilitychange', () => { if (focusRunning) tickFocusTimer(); });
    window.addEventListener('pageshow', () => { if (focusRunning) tickFocusTimer(); });
  }

  function handleUniversityActions(event) {
    const taskButton = event.target.closest('[data-add-task-uni]');
    if (taskButton) { event.stopPropagation(); addTaskFromUniversityEvent(taskButton.dataset.addTaskUni); return; }
    const eventButton = event.target.closest('[data-open-uni-event]');
    if (eventButton) { event.stopPropagation(); openUniversityEvent(eventButton.dataset.openUniEvent); return; }
    const dayButton = event.target.closest('.uni-day-head[data-day]');
    if (dayButton) { currentDate = dateFromKey(dayButton.dataset.day); renderAll(); }
  }

  function handleDelegatedActions(event) {
    const uniButton = event.target.closest('[data-open-uni-event]');
    if (uniButton) { event.stopPropagation(); openUniversityEvent(uniButton.dataset.openUniEvent); return; }
    const target = event.target.closest('[data-toggle-task], [data-edit-task]'); if (!target) return;
    if (target.dataset.toggleTask) { event.stopPropagation(); completeTask(target.dataset.toggleTask); return; }
    if (target.dataset.editTask) openTaskSheet(target.dataset.editTask);
  }

  function onboardingSeen() {
    try { return localStorage.getItem(ONBOARDING_KEY) === '1'; } catch { return false; }
  }

  function finishOnboarding(save = true) {
    onboardingOpen = false;
    if (onboardingTimer) { clearTimeout(onboardingTimer); onboardingTimer = null; }
    const layer = $('#onboarding');
    if (!layer) return;
    layer.classList.remove('open');
    layer.hidden = true;
    layer.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('onboarding-open');
    if (save) {
      try { localStorage.setItem(ONBOARDING_KEY, '1'); } catch { /* ignore storage failures */ }
    }
  }

  function currentOnboardingStep() {
    return ONBOARDING_STEPS[Math.max(0, Math.min(onboardingStep, ONBOARDING_STEPS.length - 1))];
  }

  function onboardingPositionCard(rect) {
    const card = $('#onboardingCard'); if (!card) return;
    const topSafe = 18; const bottomSafe = Math.max(18, (window.innerHeight - 70));
    const cardWidth = Math.min(330, window.innerWidth - 32);
    card.style.width = `${cardWidth}px`;
    let left = Math.max(16, Math.min(window.innerWidth - cardWidth - 16, rect.left + rect.width / 2 - cardWidth / 2));
    let top = rect.bottom + 14;
    if (top + card.offsetHeight > bottomSafe) top = Math.max(topSafe, rect.top - card.offsetHeight - 14);
    if (top + card.offsetHeight > bottomSafe) top = Math.max(topSafe, bottomSafe - card.offsetHeight);
    card.style.left = `${left}px`; card.style.top = `${top}px`;
  }

  function refreshOnboardingTarget() {
    if (!onboardingOpen) return;
    const step = currentOnboardingStep();
    const target = step ? $(step.target) : null;
    const spotlight = $('#onboardingSpotlight');
    const card = $('#onboardingCard');
    if (!target || !spotlight || !card) { finishOnboarding(); return; }

    if (step.view && currentView !== step.view) switchView(step.view, { onboarding: true });
    const position = () => {
      const rect = target.getBoundingClientRect();
      const pad = target.id === 'tabAdd' ? 7 : 6;
      spotlight.style.left = `${Math.max(6, rect.left - pad)}px`;
      spotlight.style.top = `${Math.max(6, rect.top - pad)}px`;
      spotlight.style.width = `${Math.min(window.innerWidth - 12, rect.width + pad * 2)}px`;
      spotlight.style.height = `${Math.min(window.innerHeight - 12, rect.height + pad * 2)}px`;
      spotlight.dataset.step = String(onboardingStep + 1);
      card.innerHTML = `
        <div class="onboarding-head"><span class="onboarding-icon">${step.icon}</span><div><span class="onboarding-step-label">Шаг ${onboardingStep + 1} из ${ONBOARDING_STEPS.length}</span><h3>${escapeHtml(step.title)}</h3></div></div>
        <p>${escapeHtml(step.text)}</p>
        <div class="onboarding-progress" aria-hidden="true">${ONBOARDING_STEPS.map((_, i) => `<span class="${i === onboardingStep ? 'active' : i < onboardingStep ? 'done' : ''}"></span>`).join('')}</div>
        <div class="onboarding-actions"><button type="button" class="secondary-button" id="onboardingSkip">Пропустить</button><div class="onboarding-actions-right">${onboardingStep > 0 ? '<button type="button" class="secondary-button" id="onboardingPrev">Назад</button>' : ''}<button type="button" class="primary-button" id="onboardingNext">${onboardingStep === ONBOARDING_STEPS.length - 1 ? 'Готово' : 'Дальше'}</button></div></div>
      `;
      onboardingPositionCard(rect);
      $('#onboardingNext')?.focus({ preventScroll: true });
    };

    target.scrollIntoView({ block: target.id === 'tabAdd' ? 'nearest' : 'center', inline: 'nearest', behavior: 'smooth' });
    onboardingTimer = requestAnimationFrame(() => requestAnimationFrame(position));
  }

  function startOnboarding(force = false) {
    if (!force && onboardingSeen()) return;
    const layer = $('#onboarding'); if (!layer) return;
    onboardingOpen = true; onboardingStep = 0;
    layer.hidden = false; layer.setAttribute('aria-hidden', 'false'); layer.classList.add('open');
    document.body.classList.add('onboarding-open');
    refreshOnboardingTarget();
  }

  function nextOnboarding() {
    if (onboardingStep >= ONBOARDING_STEPS.length - 1) { finishOnboarding(); return; }
    onboardingStep += 1; refreshOnboardingTarget();
  }

  function prevOnboarding() {
    if (onboardingStep <= 0) return;
    onboardingStep -= 1; refreshOnboardingTarget();
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', async () => {
      try {
        swRegistration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
        const checkWaiting = () => { if (swRegistration.waiting && navigator.serviceWorker.controller) showUpdateBanner(swRegistration.waiting); };
        checkWaiting();
        swRegistration.addEventListener('updatefound', () => {
          const worker = swRegistration.installing; if (!worker) return;
          worker.addEventListener('statechange', () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(worker); });
        });
        navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
        setTimeout(() => swRegistration?.update?.(), 1500);
      } catch { /* normal browser mode */ }
    });
  }

  function showUpdateBanner(worker) { $('#updateBanner').hidden = false; $('#updateBtn').onclick = () => worker?.postMessage({ type: 'SKIP_WAITING' }); }
  function boot() {
    repairAndPersist(); $('#appVersionLabel').textContent = `v${APP_VERSION}`; bindEvents(); renderAll(); updateFocusUI(); registerServiceWorker();
    setTimeout(() => startOnboarding(false), 480);
  }

  // Lightweight QA hooks used only by automated regression tests.
  if (globalThis.__TAVRIMO_QA__) globalThis.__TAVRIMO_TEST__ = {
    getData: () => clone(data),
    setData: (raw) => { data = normalizeData(raw); },
    setCurrentDate: (value) => { currentDate = startOfDay(value); },
    normalizeData,
    validateManualSlot,
    validatePersistedSlot,
    repairData,
    taskUrgencyScore,
    clearTaskSchedule,
    getNextUpTask,
    getNextAgendaItem,
    getAgendaItemsForDate,
    dayLoad,
    getPlanHealth,
    parseUniversityIcs,
    parseIcsDateTime,
    normalizeUniversity,
    extractGroupCode,
    universityConflict,
    universityEventsForDate,
    repairUniversityTaskConflicts,
    deadlineLabel,
    deadlineTimestamp,
    workingCapacityMinutes,
    dateFromKey,
    isValidDateKey,
    startOfDay
  };

  boot();
})();
