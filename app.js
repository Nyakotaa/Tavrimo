(() => {
  'use strict';

  const APP_VERSION = '8.0.0-rc.1';
  const SCHEMA_VERSION = 8;
  const STORAGE_KEY = 'flowday-planner-v8';
  const LEGACY_KEYS = [
    'flowday-planner-v7', 'flowday-planner-v6', 'flowday-planner-v5',
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
  const DEFAULTS = {
    version: SCHEMA_VERSION,
    settings: {
      workStart: 9, workEnd: 18, lunchStart: 13, lunchEnd: 14,
      buffer: 10, focusLength: 25, weekends: false, theme: 'system'
    },
    tasks: [],
    focus: { totalMinutes: 0, sessions: [] }
  };

  let data = loadData();
  let currentDate = startOfDay(new Date());
  let currentView = 'today';
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
  let swRegistration = null;

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const byId = (id) => data.tasks.find((task) => String(task.id) === String(id));

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function uid() {
    return globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

  function normalizeTask(task, index = 0) {
    const today = todayKey();
    const candidateDeadline = String(task?.deadline || '');
    const deadline = isValidDateKey(candidateDeadline) ? candidateDeadline : today;
    const deadlineTime = normalizeTime(task?.deadlineTime);
    const scheduledDateRaw = String(task?.scheduledDate || '');
    const scheduledStart = normalizeTime(task?.scheduledStart);
    const scheduledDate = isValidDateKey(scheduledDateRaw) && scheduledStart ? scheduledDateRaw : null;
    const createdAt = safeIso(task?.createdAt, new Date().toISOString());
    const completedAt = task?.done ? safeIso(task?.completedAt, createdAt) : null;
    const category = ALLOWED_CATEGORIES.includes(String(task?.category || '')) ? String(task.category) : 'Учёба';
    return {
      id: task?.id != null ? String(task.id) : `${Date.now()}-${index}`,
      title: String(task?.title || '').trim().slice(0, 120),
      duration: ALLOWED_DURATIONS.includes(Number(task?.duration)) ? Number(task.duration) : 30,
      priority: ALLOWED_PRIORITIES.includes(Number(task?.priority)) ? Number(task.priority) : 2,
      deadline,
      deadlineTime,
      category,
      note: String(task?.note || '').slice(0, 300),
      scheduledDate,
      scheduledStart,
      locked: Boolean(task?.locked) && Boolean(scheduledDate && scheduledStart),
      done: Boolean(task?.done),
      createdAt,
      completedAt
    };
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
    const tasks = rawTasks.map((task, index) => normalizeTask(task, index)).filter((task) => task.title);
    const focusRaw = raw.focus && typeof raw.focus === 'object' ? raw.focus : {};
    const sessions = Array.isArray(focusRaw.sessions) ? focusRaw.sessions.slice(-500).map((session) => {
      const minutes = Math.round(Number(session?.minutes) || 0);
      if (minutes <= 0) return null;
      return {
        date: isValidDateKey(session?.date) ? String(session.date) : todayKey(),
        taskId: session?.taskId != null ? String(session.taskId) : null,
        minutes: Math.min(1440, minutes),
        completedAt: safeIso(session?.completedAt, new Date().toISOString())
      };
    }).filter(Boolean) : [];
    const totalMinutes = sessions.reduce((sum, session) => sum + session.minutes, 0);

    const normalized = {
      version: SCHEMA_VERSION,
      settings,
      tasks,
      focus: { totalMinutes, sessions }
    };
    return repairData(normalized, normalized.settings).data;
  }

  function repairData(input, settings = data?.settings || DEFAULTS.settings) {
    const repaired = clone(input);
    const today = startOfDay(new Date());
    let changed = false;
    repaired.tasks = repaired.tasks.map((task) => {
      const next = { ...task };
      if (!next.scheduledDate || !next.scheduledStart) {
        if (next.scheduledDate || next.scheduledStart || next.locked) changed = true;
        next.scheduledDate = null; next.scheduledStart = null; next.locked = false;
        return next;
      }
      const validSlot = validatePersistedSlot(next, settings);
      if (!validSlot.ok) {
        next.scheduledDate = null; next.scheduledStart = null;
        if (next.locked) next.locked = false;
        changed = true;
        return next;
      }
      if (next.done && !next.completedAt) {
        next.completedAt = safeIso(next.createdAt, new Date().toISOString());
        changed = true;
      }
      return next;
    });
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
  function deadlineTimestamp(task) { return startOfDay(dateFromKey(task.deadline)).getTime() + deadlineMinutes(task) * 60000; }
  function deadlineLabel(task) {
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
      .sort((a, b) => planningScore(a) - planningScore(b) || String(a.createdAt).localeCompare(String(b.createdAt)));
  }
  function getWeekStart(date) {
    const d = startOfDay(date); const day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return d;
  }

  function mergeIntervals(intervals) {
    const list = intervals.filter((item) => Number.isFinite(item.s) && Number.isFinite(item.e) && item.e > item.s)
      .sort((a, b) => a.s - b.s);
    const merged = [];
    for (const interval of list) {
      const last = merged[merged.length - 1];
      if (last && interval.s <= last.e) last.e = Math.max(last.e, interval.e);
      else merged.push({ ...interval });
    }
    return merged;
  }

  function getFreeWindows(occupied) {
    const s = settingsMinutes();
    const intervals = [...(occupied || []), { s: s.lunchStart, e: s.lunchEnd }]
      .map((i) => ({ s: Math.max(s.workStart, i.s), e: Math.min(s.workEnd, i.e) }))
      .filter((i) => i.e > i.s);
    const merged = mergeIntervals(intervals); const result = []; let cursor = s.workStart;
    for (const interval of merged) {
      if (interval.s > cursor) result.push([cursor, interval.s]);
      cursor = Math.max(cursor, interval.e);
    }
    if (cursor < s.workEnd) result.push([cursor, s.workEnd]);
    return result;
  }

  function addOccupied(occupied, task) {
    if (!task.scheduledDate || !task.scheduledStart || task.done) return;
    const start = toMinutes(task.scheduledStart);
    const end = start + task.duration + Number(data.settings.buffer || 0);
    if (!Number.isFinite(start) || end <= start) return;
    (occupied[task.scheduledDate] ||= []).push({ s: start, e: end });
  }

  function validatePersistedSlot(task, settingsOverride = data?.settings || DEFAULTS.settings) {
    if (!isValidDateKey(task.scheduledDate) || !normalizeTime(task.scheduledStart)) return { ok: false, reason: 'Неполный слот.' };
    const day = dateFromKey(task.scheduledDate);
    const dayOfWeek = day.getDay();
    if (Boolean(settingsOverride.weekends) === false && (dayOfWeek === 0 || dayOfWeek === 6)) return { ok: false, reason: 'Выходной.' };
    if (dateFromKey(task.scheduledDate) < startOfDay(new Date()) && !task.done) return { ok: false, reason: 'Дата в прошлом.' };
    const start = toMinutes(task.scheduledStart); const s = {
      workStart: Math.round(Number(settingsOverride.workStart) * 60),
      workEnd: Math.round(Number(settingsOverride.workEnd) * 60),
      lunchStart: Math.round(Number(settingsOverride.lunchStart) * 60),
      lunchEnd: Math.round(Number(settingsOverride.lunchEnd) * 60)
    };
    const end = start + task.duration; const reservedEnd = end + Number(settingsOverride.buffer ?? data.settings.buffer ?? 0);
    if (!task.done && dateKey(day) === todayKey() && start < nowMinutes()) return { ok: false, reason: 'Время уже прошло.' };
    if (start % 15 !== 0) return { ok: false, reason: 'Некратное время.' };
    if (start < s.workStart || end > s.workEnd || reservedEnd > s.workEnd) return { ok: false, reason: 'За пределами рабочего дня.' };
    if (start < s.lunchEnd && end > s.lunchStart) return { ok: false, reason: 'Перерыв.' };
    if (dateKey(dateFromKey(task.scheduledDate)) === task.deadline && end > deadlineMinutes(task)) return { ok: false, reason: 'После дедлайна.' };
    return { ok: true };
  }

  function latestAllowedEnd(task, key) {
    const s = settingsMinutes();
    return key === task.deadline ? Math.min(s.workEnd, deadlineMinutes(task)) : s.workEnd;
  }

  function findSlot(task, fromDate, occupied) {
    const startDate = startOfDay(fromDate);
    const deadlineDate = dateFromKey(task.deadline);
    const today = todayKey();
    for (let cursor = startDate; cursor <= deadlineDate; cursor = addDays(cursor, 1)) {
      if (!isWorkingDay(cursor)) continue;
      const key = dateKey(cursor);
      const windows = getFreeWindows(occupied[key] || []);
      for (const [windowStart, windowEnd] of windows) {
        let start = Math.ceil(windowStart / 15) * 15;
        if (key === today) start = Math.max(start, Math.ceil(nowMinutes() / 15) * 15);
        const latestEnd = latestAllowedEnd(task, key);
        const taskEnd = start + task.duration;
        const reservedEnd = taskEnd + Number(data.settings.buffer || 0);
        if (taskEnd <= Math.min(windowEnd, latestEnd) && reservedEnd <= windowEnd) return { date: key, start };
      }
    }
    return null;
  }

  function planningScore(task) {
    // Priority shifts urgency inside the admissible window, while the real deadline remains a hard limit.
    const priorityLeadMinutes = task.priority === 3 ? 120 : task.priority === 2 ? 60 : 0;
    return deadlineTimestamp(task) - priorityLeadMinutes * 60000;
  }

  function sortForPlanning(tasks) {
    return [...tasks].sort((a, b) => planningScore(a) - planningScore(b) ||
      deadlineTimestamp(a) - deadlineTimestamp(b) || b.priority - a.priority ||
      b.duration - a.duration || String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  function autoPlanAll(showResult = true) {
    const today = startOfDay(new Date());
    // Global plan always starts today, regardless of which day is currently open in the UI.
    data.tasks.forEach((task) => {
      if (!task.done && !task.locked) { task.scheduledDate = null; task.scheduledStart = null; }
    });

    const occupied = {};
    data.tasks.filter((task) => !task.done && task.locked).forEach((task) => addOccupied(occupied, task));
    const openTasks = data.tasks.filter((task) => !task.done && !task.locked);
    const overdue = openTasks.filter((task) => deadlineTimestamp(task) < Date.now()).length;
    const pending = sortForPlanning(openTasks.filter((task) => deadlineTimestamp(task) >= Date.now()));
    let placed = 0; let missed = 0;
    for (const task of pending) {
      const slot = findSlot(task, today, occupied);
      if (!slot) { missed += 1; continue; }
      task.scheduledDate = slot.date; task.scheduledStart = hm(slot.start); task.locked = false;
      addOccupied(occupied, task); placed += 1;
    }
    saveData(); renderAll();

    if (showResult) {
      if (placed && !missed) showToast(`План готов · ${placed} ${formatCount(placed, 'задача', 'задачи', 'задач')}`);
      else if (placed && missed) showToast(`План готов · ${placed} поставлено, ${missed} не поместилось до дедлайна.`);
      else if (missed && overdue) showToast(`План готов · ${missed} не поместилось, ${overdue} просрочено.`);
      else if (missed) showToast(`Не удалось разместить ${missed} ${formatCount(missed, 'задачу', 'задачи', 'задач')} до дедлайна.`);
      else if (overdue) showToast(`Просрочено: ${overdue} ${formatCount(overdue, 'задача', 'задачи', 'задач')}.`);
      else showToast('Пока нечего планировать.');
    }
    return { placed, missed, overdue };
  }

  function scheduleSingle(taskId) {
    const task = byId(taskId);
    if (!task || task.done || task.locked) return false;
    const occupied = {};
    data.tasks.filter((other) => String(other.id) !== String(taskId) && !other.done).forEach((other) => addOccupied(occupied, other));
    const slot = findSlot(task, startOfDay(new Date()), occupied);
    if (!slot) {
      task.scheduledDate = null; task.scheduledStart = null; task.locked = false;
      saveData(); renderAll(); showToast(`Не нашлось окна до дедлайна ${deadlineLabel(task).toLowerCase()}.`);
      return false;
    }
    task.scheduledDate = slot.date; task.scheduledStart = hm(slot.start); task.locked = false;
    saveData(); renderAll(); showToast(`Поставлено · ${task.scheduledStart} ${shortDate(dateFromKey(task.scheduledDate))}`);
    return true;
  }

  function validateManualSlot(task, scheduledDate, scheduledStart, duration) {
    if (!scheduledDate || !scheduledStart) return 'Укажи дату и время.';
    const date = parseDateKey(scheduledDate); const today = startOfDay(new Date());
    if (!date) return 'Выбери существующую дату.';
    if (!isWorkingDay(date)) return 'Этот день не входит в рабочие дни.';
    if (date < today) return 'Нельзя поставить задачу в прошлое.';
    if (date > dateFromKey(task.deadline)) return 'Слот позже дедлайна.';
    const start = toMinutes(scheduledStart); const end = start + duration;
    const s = settingsMinutes(); const buffer = Number(data.settings.buffer || 0);
    if (!Number.isFinite(start)) return 'Неверное время.';
    if (start % 15 !== 0) return 'Время должно быть кратно 15 минутам.';
    if (dateKey(date) === todayKey() && start < nowMinutes()) return 'Это время уже прошло.';
    if (start < s.workStart || end > s.workEnd || end + buffer > s.workEnd) return 'Слот выходит за пределы рабочего дня.';
    if (start < s.lunchEnd && end > s.lunchStart) return 'Слот пересекается с перерывом.';
    if (dateKey(date) === task.deadline && end > deadlineMinutes(task)) return task.deadlineTime ? `Слот заканчивается позже ${task.deadlineTime}.` : 'Слот заканчивается после дедлайна.';

    const newStart = start; const newEnd = end + buffer;
    const conflict = data.tasks.some((other) => {
      if (String(other.id) === String(task.id) || other.done || other.scheduledDate !== scheduledDate || !other.scheduledStart) return false;
      const otherStart = toMinutes(other.scheduledStart);
      const otherEnd = otherStart + other.duration + buffer;
      return newStart < otherEnd && newEnd > otherStart;
    });
    return conflict ? 'На это время уже стоит другая задача.' : '';
  }

  function slotValidationText(task) {
    if (!$('#manualScheduleToggle')?.checked) return '';
    const date = $('#taskScheduleDate')?.value; const time = $('#taskScheduleTime')?.value; const duration = Number($('#taskDuration')?.value || 0);
    if (!date || !time) return 'Выбери дату и время.';
    const taskLike = task || { id: editingId || '__new__', deadline: $('#taskDeadline').value, deadlineTime: $('#taskDeadlineTime')?.value || null };
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
      const slotStillValid = task.scheduledDate && task.scheduledStart && validatePersistedSlot(task).ok && deadlineTimestamp(task) >= Date.now();
      if (!slotStillValid) {
        task.scheduledDate = null; task.scheduledStart = null;
        task.locked = false;
      }
    }
    saveData(); renderAll();
    showToast(task.done ? 'Задача выполнена.' : task.scheduledDate ? 'Задача снова в расписании.' : 'Задача возвращена в план.');
  }

  function deleteTask(id) {
    data.tasks = data.tasks.filter((task) => String(task.id) !== String(id));
    if (focusTaskId === String(id)) resetFocusTimer();
    saveData(); closeAllModals(); renderAll(); showToast('Задача удалена.');
  }

  function clearAutoSlots() {
    let changed = 0;
    data.tasks.forEach((task) => {
      if (!task.done && !task.locked && (task.scheduledDate || task.scheduledStart)) {
        task.scheduledDate = null; task.scheduledStart = null; changed += 1;
      }
    });
    saveData(); closeModal('planningSheetBackdrop'); renderAll();
    showToast(changed ? `Снято автоматических слотов: ${changed}.` : 'Автоматических слотов нет.');
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
    applyTheme(); renderChrome(); renderToday(); renderCalendar(); renderTasks(); renderSettings();
    populateFocusTasks(); updatePlanControls(); updateAppVersion(); updateManualHint(); updateFocusUI();
  }

  function renderChrome() {
    $('#headerContext').textContent = currentView === 'today' ? shortDate(currentDate) : ({ calendar: 'Неделя', tasks: 'Задачи', more: 'Ещё' }[currentView] || 'Flowday');
    $$('.tab[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === currentView));
    $$('.view').forEach((view) => view.classList.toggle('active', view.dataset.view === currentView));
  }

  function updatePlanControls() {
    const unplanned = getOpenInbox().length;
    const autoPlanned = data.tasks.some((task) => !task.done && !task.locked && task.scheduledDate && task.scheduledStart);
    const shouldShow = unplanned || autoPlanned;
    $('#planBtn').classList.toggle('hidden', !shouldShow);
    $('#planBtnText').textContent = autoPlanned ? 'Перестроить' : 'Запланировать';
    const sheetMeta = $('#planMeta');
    if (sheetMeta) sheetMeta.textContent = autoPlanned ? 'Перестраивается весь автоматический план от сегодняшнего дня. Ручные блоки Flowday не тронет.' : `${unplanned} ${formatCount(unplanned, 'задача', 'задачи', 'задач')} без времени. Планировщик начнёт с сегодняшнего дня.`;
  }

  function dayLoad(date) {
    const tasks = getScheduled(date, false);
    const buffer = Number(data.settings.buffer || 0);
    const work = tasks.reduce((sum, task) => sum + task.duration, 0);
    const reserve = tasks.length * buffer;
    return { tasks, work, reserve, occupied: work + reserve };
  }

  function renderToday() {
    const key = dateKey(currentDate); const load = dayLoad(key); const inbox = getOpenInbox();
    const capacity = workingCapacityMinutes(); const pctRaw = capacity ? Math.round((load.occupied / capacity) * 100) : 0; const pct = Math.min(100, Math.max(0, pctRaw));
    const isToday = key === todayKey(); const working = isWorkingDay(currentDate);
    const dueToday = data.tasks.filter((task) => !task.done && task.deadline === key).length;
    const overdue = data.tasks.filter((task) => !task.done && deadlineTimestamp(task) < Date.now()).length;
    $('#todayEyebrow').textContent = isToday ? 'СЕГОДНЯ' : longDate(currentDate).toUpperCase();
    $('#todayTitle').textContent = isToday ? 'Твой день.' : `План на ${shortDate(currentDate)}.`;
    $('#todaySubtitle').textContent = !working ? 'Выходной. Автопланирование сюда ничего не ставит.' : data.tasks.length ? `${dueToday ? `${dueToday} ${formatCount(dueToday, 'задача', 'задачи', 'задач')} с дедлайном. ` : ''}${overdue ? `${overdue} просрочено. ` : ''}Flowday учитывает занятое время и резерв.` : 'Добавь первую задачу — время подберётся само.';
    $('#todayDateText').textContent = shortDate(currentDate);
    $('#focusValue').textContent = `${pct}%`; $('#focusRingValue').textContent = `${pct}%`;
    $('#focusLabel').textContent = `${formatDuration(load.work)}${load.reserve ? ` + ${formatDuration(load.reserve)} резерв` : ''} из ${formatDuration(capacity)} · ${load.tasks.length} ${formatCount(load.tasks.length, 'задача', 'задачи', 'задач')}${pctRaw > 100 ? ` · перегруз ${pctRaw - 100}%` : ''}`;
    $('#focusProgress').style.width = `${pct}%`; $('#focusRing').style.setProperty('--ring-pct', `${pct * 3.6}deg`);
    $('#focusProgress').dataset.over = pctRaw > 100 ? 'true' : 'false'; $('#focusRing').dataset.over = pctRaw > 100 ? 'true' : 'false';
    $('#dayStatusText').textContent = !working ? 'ВЫХОДНОЙ' : pctRaw > 100 ? 'ПЕРЕГРУЗ' : load.tasks.length ? 'ПЛАН ДНЯ' : 'СВОБОДНЫЙ ДЕНЬ';
    $('#statusDot').dataset.state = !working ? 'off' : pctRaw > 100 ? 'over' : load.tasks.length ? 'on' : 'idle';
    $('#todayAgenda').innerHTML = load.tasks.length ? load.tasks.slice(0, 12).map(renderAgendaCard).join('') : emptyState('Здесь появится расписание.', inbox.length ? 'Flowday поставит открытые задачи по свободным окнам.' : 'Добавь первую задачу через + внизу.');
    $('#inboxCount').textContent = String(inbox.length);
    $('#todayInbox').innerHTML = inbox.length ? inbox.slice(0, 8).map(renderInboxRow).join('') : emptyState('Входящих задач нет.', 'Все открытые задачи уже имеют время.');
  }

  function scheduleEnd(task) { return hm(toMinutes(task.scheduledStart) + task.duration); }
  function renderAgendaCard(task) {
    const type = task.locked ? 'manual' : 'auto';
    return `<button class="agenda-card ${type}" data-edit-task="${escapeHtml(task.id)}" type="button"><span class="agenda-time">${escapeHtml(task.scheduledStart)}<small>${escapeHtml(scheduleEnd(task))}</small></span><span class="agenda-main"><strong class="agenda-title">${escapeHtml(task.title)}</strong><small class="agenda-meta">${formatDuration(task.duration)} · ${escapeHtml(task.category)} · ${task.locked ? 'вручную' : 'авто'} · ${escapeHtml(deadlineLabel(task))}</small></span><span class="chevron">›</span></button>`;
  }
  function renderInboxRow(task) {
    return `<div class="inbox-row"><button class="task-check" data-toggle-task="${escapeHtml(task.id)}" type="button" aria-label="Отметить выполненной">✓</button><button class="row-main" data-edit-task="${escapeHtml(task.id)}" type="button"><strong class="inbox-title">${escapeHtml(task.title)}</strong><small class="inbox-meta">${deadlineLabel(task)} · ${formatDuration(task.duration)} · ${priorityLabel(task.priority)}</small></button></div>`;
  }
  function emptyState(title, subtitle) { return `<div class="empty-card"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(subtitle)}</span></div>`; }

  function renderCalendar() {
    const monday = getWeekStart(currentDate);
    $('#weekRange').textContent = `${shortDate(monday)} — ${shortDate(addDays(monday, 6))}`;
    $('#weekStrip').innerHTML = Array.from({ length: 7 }, (_, index) => {
      const day = addDays(monday, index); const key = dateKey(day); const count = getScheduled(key, false).length;
      return `<button class="week-day ${key === dateKey(currentDate) ? 'active' : ''} ${key === todayKey() ? 'today' : ''} ${count ? 'has-task' : ''}" data-day="${key}" type="button"><span class="dow">${escapeHtml(weekdayShort(day))}</span><span class="num">${day.getDate()}</span><span class="dot"></span></button>`;
    }).join('');
    const load = dayLoad(currentDate); const pctRaw = workingCapacityMinutes() ? Math.round((load.occupied / workingCapacityMinutes()) * 100) : 0;
    $('#calendarDateLabel').textContent = dateKey(currentDate) === todayKey() ? 'Сегодня' : longDate(currentDate);
    $('#calendarLoadLabel').textContent = `${formatDuration(load.work)}${load.reserve ? ` + ${formatDuration(load.reserve)} резерв` : ''} · ${load.tasks.length} ${formatCount(load.tasks.length, 'задача', 'задачи', 'задач')}${pctRaw > 100 ? ` · перегруз ${pctRaw - 100}%` : ''}`;
    $('#calendarLoadValue').textContent = `${Math.min(100, Math.max(0, pctRaw))}%`;
    const dayTasks = getScheduled(currentDate);
    $('#calendarAgenda').innerHTML = dayTasks.length ? dayTasks.map((task) => `<button class="calendar-block" data-edit-task="${escapeHtml(task.id)}" type="button"><span class="calendar-time">${escapeHtml(task.scheduledStart)}<small>${escapeHtml(scheduleEnd(task))}</small></span><span class="calendar-slot ${task.locked ? 'manual' : 'auto'} ${task.done ? 'done' : ''}"><strong>${escapeHtml(task.title)}</strong><small>${formatDuration(task.duration)} · ${task.locked ? 'вручную' : 'авто'} · ${escapeHtml(deadlineLabel(task))}${task.category ? ` · ${escapeHtml(task.category)}` : ''}</small></span></button>`).join('') : emptyState('На этот день пусто.', 'Выбери другой день или добавь задачу через +.');
  }

  function renderTasks() {
    const search = ($('#taskSearch')?.value || '').trim().toLowerCase();
    const tasks = data.tasks.filter((task) => {
      const matchesFilter = activeFilter === 'all' || (activeFilter === 'open' && !task.done) || (activeFilter === 'planned' && !task.done && !!task.scheduledDate) || (activeFilter === 'done' && task.done);
      const haystack = `${task.title} ${task.note} ${task.category}`.toLowerCase();
      return matchesFilter && (!search || haystack.includes(search));
    }).sort((a, b) => { if (a.done !== b.done) return a.done ? 1 : -1; return planningScore(a) - planningScore(b) || b.priority - a.priority; });
    const open = data.tasks.filter((task) => !task.done).length;
    $('#taskSummary').textContent = `${open} ${formatCount(open, 'открытая задача', 'открытые задачи', 'открытых задач')}`;
    $('#filterCount').textContent = activeFilter === 'all' ? '' : `· ${filterLabel(activeFilter)}`;
    $$('#filterPopover button').forEach((button) => button.classList.toggle('active', button.dataset.filter === activeFilter));
    $('#allTaskList').innerHTML = tasks.length ? tasks.map(renderTaskRow).join('') : emptyState(search ? 'Ничего не найдено.' : 'Задач пока нет.', search ? 'Попробуй другой запрос.' : 'Добавь первую задачу через +.');
  }
  function filterLabel(filter) { return ({ open: 'открытые', planned: 'в плане', done: 'готово' }[filter] || 'все'); }
  function renderTaskRow(task) {
    const priority = priorityLabel(task.priority); const deadline = deadlineLabel(task); const schedule = scheduleLabel(task);
    return `<div class="task-row ${task.done ? 'done' : ''}"><button class="task-check ${task.done ? 'done' : ''}" data-toggle-task="${escapeHtml(task.id)}" type="button" aria-label="${task.done ? 'Вернуть в работу' : 'Выполнить'}">${task.done ? '✓' : ''}</button><button class="task-main" data-edit-task="${escapeHtml(task.id)}" type="button"><strong class="task-title">${escapeHtml(task.title)}</strong><span class="task-badges"><span class="badge ${priorityClass(task.priority)}">${escapeHtml(priority)}</span><span class="badge">${escapeHtml(formatDuration(task.duration))}</span><span class="badge">${escapeHtml(deadline)}</span><span class="badge">${escapeHtml(schedule)}</span></span></button></div>`;
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

  function openTaskSheet(id = null) {
    editingId = id ? String(id) : null;
    const task = id ? byId(id) : null;
    $('#taskForm').reset();
    $('#taskSheetKicker').textContent = task ? 'РЕДАКТИРОВАНИЕ' : 'НОВАЯ ЗАДАЧА';
    $('#taskSheetTitle').textContent = task ? 'Измени задачу' : 'Что нужно сделать?';
    $('#saveTaskBtn').textContent = task ? 'Сохранить' : 'Добавить'; $('#deleteTaskBtn').hidden = !task;
    const defaultDeadline = dateKey(currentDate < startOfDay(new Date()) ? new Date() : currentDate);
    $('#taskTitle').value = task?.title || ''; $('#taskDuration').value = String(task?.duration || 60); $('#taskPriority').value = String(task?.priority || 2);
    $('#taskDeadline').value = task?.deadline || defaultDeadline; $('#taskDeadlineTime').value = task?.deadlineTime || '';
    $('#taskCategory').value = task?.category || 'Учёба'; $('#taskNote').value = task?.note || '';
    const isManual = Boolean(task?.locked); $('#manualScheduleToggle').checked = isManual; $('#manualScheduleFields').classList.toggle('hidden', !isManual);
    $('#taskScheduleDate').value = task?.scheduledDate || defaultDeadline; $('#taskScheduleTime').value = task?.scheduledStart || '';
    const today = todayKey(); $('#taskDeadline').min = today; $('#taskScheduleDate').min = today;
    updateTaskLogicHint(); updateManualHint(); openModal('taskSheetBackdrop'); setTimeout(() => $('#taskTitle').focus(), 100);
  }

  function updateTaskLogicHint() {
    const duration = Number($('#taskDuration')?.value || 60); const priority = Number($('#taskPriority')?.value || 2); const deadline = $('#taskDeadline')?.value; const deadlineTime = $('#taskDeadlineTime')?.value;
    const bits = [`${formatDuration(duration)} — реальная длина`, `${priorityLabel(priority)} — влияет на порядок при авторазмещении`];
    if (deadline) bits.push(`дедлайн — ${deadlineTime ? `до ${deadlineTime}` : 'до конца дня'}`);
    $('#taskLogicHint').textContent = bits.join(' · ');
  }

  function updateManualHint() {
    const hint = $('#manualScheduleHint'); if (!hint) return;
    const isManual = Boolean($('#manualScheduleToggle')?.checked);
    hint.className = `manual-hint ${isManual ? '' : 'hidden'}`;
    if (!isManual) return;
    const existing = editingId ? byId(editingId) : null;
    const taskLike = { ...(existing || {}), id: existing?.id || '__new__', duration: Number($('#taskDuration')?.value || 0), deadline: $('#taskDeadline')?.value || todayKey(), deadlineTime: $('#taskDeadlineTime')?.value || null };
    const text = slotValidationText(taskLike); hint.textContent = text; hint.dataset.state = text.startsWith('Свободно') ? 'ok' : 'error';
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
    clearInterval(focusTimer); focusTimer = null; focusRunning = false; focusEndAt = null;
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
    focusRunning = true; focusEndAt = Date.now() + focusRemaining * 1000;
    clearInterval(focusTimer); focusTimer = setInterval(tickFocusTimer, 250); tickFocusTimer(); updateFocusUI();
  }

  function finishFocusSession() {
    if (!focusRunning && focusRemaining > 0) return;
    clearInterval(focusTimer); focusTimer = null; focusRunning = false; focusEndAt = null;
    const taskId = focusTaskId || $('#focusTaskSelect').value || null;
    const task = taskId ? byId(taskId) : null;
    const minutes = Math.max(1, Number(focusPlannedMinutes || data.settings.focusLength));
    data.focus.sessions.push({ date: todayKey(), taskId: taskId ? String(taskId) : null, minutes, completedAt: new Date().toISOString() });
    data.focus.sessions = data.focus.sessions.slice(-500); data.focus.totalMinutes = data.focus.sessions.reduce((sum, session) => sum + session.minutes, 0);
    focusRemaining = 0; saveData(); renderAll();
    showToast(task ? `Фокус завершён · ${task.title}` : 'Фокус-сессия завершена.');
    focusRemaining = focusBaseSeconds(); updateFocusUI();
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

  function exportData() {
    const json = JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 2);
    const fileName = `flowday-backup-${todayKey()}.json`;
    try {
      const file = new File([json], fileName, { type: 'application/json' });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        navigator.share({ title: 'Flowday — резервная копия', files: [file] }).then(() => showToast('Резервная копия подготовлена.')).catch(() => {});
        return;
      }
    } catch { /* fallback */ }
    const blob = new Blob([json], { type: 'application/json' }); const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = fileName; document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 250); showToast('Резервная копия подготовлена.');
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

  function switchView(view) {
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

    $('#planBtn').addEventListener('click', () => openModal('planningSheetBackdrop'));
    $('#calendarToday').addEventListener('click', () => { currentDate = startOfDay(new Date()); renderAll(); });
    $('#calendarPrevWeek').addEventListener('click', () => { currentDate = addDays(currentDate, -7); renderAll(); });
    $('#calendarNextWeek').addEventListener('click', () => { currentDate = addDays(currentDate, 7); renderAll(); });
    $$('.tab[data-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
    $('#todayAgenda').addEventListener('click', handleDelegatedActions); $('#todayInbox').addEventListener('click', handleDelegatedActions);
    $('#calendarAgenda').addEventListener('click', handleDelegatedActions); $('#allTaskList').addEventListener('click', handleDelegatedActions);
    $('#weekStrip').addEventListener('click', (event) => { const button = event.target.closest('[data-day]'); if (!button) return; currentDate = startOfDay(dateFromKey(button.dataset.day)); renderAll(); });
    $('#taskSearch').addEventListener('input', renderTasks); $('#filterButton').addEventListener('click', () => { const popover = $('#filterPopover'); popover.hidden = !popover.hidden; });
    $('#filterPopover').addEventListener('click', (event) => { const button = event.target.closest('[data-filter]'); if (!button) return; activeFilter = button.dataset.filter; $('#filterPopover').hidden = true; renderTasks(); });

    $('#closeTaskSheet').onclick = () => closeModal('taskSheetBackdrop'); $('#cancelTask').onclick = () => closeModal('taskSheetBackdrop');
    $('#taskSheetBackdrop').addEventListener('click', (event) => { if (event.target === event.currentTarget) closeModal('taskSheetBackdrop'); });
    $('#manualScheduleToggle').addEventListener('change', (event) => {
      $('#manualScheduleFields').classList.toggle('hidden', !event.target.checked);
      if (event.target.checked && !$('#taskScheduleTime').value) {
        const base = Math.max(data.settings.workStart * 60, Math.ceil(nowMinutes() / 15) * 15);
        const latest = data.settings.workEnd * 60 - Number($('#taskDuration').value) - Number(data.settings.buffer || 0);
        $('#taskScheduleTime').value = hm(Math.max(data.settings.workStart * 60, Math.min(base, latest)));
      }
      updateTaskLogicHint(); updateManualHint();
    });
    ['taskDuration', 'taskPriority', 'taskDeadline', 'taskDeadlineTime', 'taskScheduleDate', 'taskScheduleTime'].forEach((id) => {
      $(`#${id}`)?.addEventListener('input', () => { updateTaskLogicHint(); updateManualHint(); });
      $(`#${id}`)?.addEventListener('change', () => { updateTaskLogicHint(); updateManualHint(); });
    });
    $('#deleteTaskBtn').onclick = () => { if (editingId && confirm('Удалить эту задачу?')) deleteTask(editingId); };

    $('#taskForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const existing = editingId ? byId(editingId) : null;
      const title = $('#taskTitle').value.trim(); const duration = Number($('#taskDuration').value); const priority = Number($('#taskPriority').value);
      const deadline = $('#taskDeadline').value || dateKey(currentDate); const deadlineTime = $('#taskDeadlineTime').value || null;
      const category = ALLOWED_CATEGORIES.includes($('#taskCategory').value) ? $('#taskCategory').value : 'Другое'; const note = $('#taskNote').value.trim();
      const manual = $('#manualScheduleToggle').checked;
      if (!title) { showToast('Введите название задачи.'); return; }
      if (!isValidDateKey(deadline) || dateFromKey(deadline) < startOfDay(new Date())) { showToast('Дедлайн не может быть в прошлом.'); return; }
      if (deadlineTime && !Number.isFinite(toMinutes(deadlineTime))) { showToast('Проверь время дедлайна.'); return; }
      if (!ALLOWED_DURATIONS.includes(duration)) { showToast('Проверь длительность.'); return; }

      const task = existing ? { ...existing } : { id: uid(), title: '', duration: 60, priority: 2, deadline, deadlineTime: null, category: 'Учёба', note: '', scheduledDate: null, scheduledStart: null, locked: false, done: false, createdAt: new Date().toISOString(), completedAt: null };
      Object.assign(task, { title, duration, priority, deadline, deadlineTime, category, note });

      if (manual) {
        const manualDate = $('#taskScheduleDate').value; const manualTime = $('#taskScheduleTime').value;
        const error = validateManualSlot(task, manualDate, manualTime, duration);
        if (error) { updateManualHint(); showToast(error); return; }
        task.scheduledDate = manualDate; task.scheduledStart = manualTime; task.locked = true;
      } else {
        const oldAuto = existing && !existing.locked;
        const relevantChange = !existing || duration !== existing.duration || priority !== existing.priority || deadline !== existing.deadline || deadlineTime !== existing.deadlineTime;
        task.locked = false;
        if (oldAuto && existing.scheduledDate && existing.scheduledStart && !relevantChange && deadlineTimestamp(existing) >= Date.now() && validatePersistedSlot(existing).ok) {
          task.scheduledDate = existing.scheduledDate; task.scheduledStart = existing.scheduledStart;
        } else {
          task.scheduledDate = null; task.scheduledStart = null;
        }
      }

      if (existing) data.tasks = data.tasks.map((item) => String(item.id) === String(existing.id) ? task : item); else data.tasks.push(task);
      saveData(); closeModal('taskSheetBackdrop');
      const shouldAutoPlan = !manual;
      let planResult = null;
      if (shouldAutoPlan) planResult = autoPlanAll(false); else renderAll();
      const saved = byId(task.id);
      if (!existing && manual) showToast('Задача добавлена вручную.');
      else if (!existing && !manual) showToast(planResult?.placed ? `Добавлено и запланировано · ${saved?.scheduledStart || 'см. план'}` : 'Задача добавлена, но свободного окна до дедлайна не нашлось.');
      else if (existing && !manual && existing.locked) showToast(saved?.scheduledDate ? 'Ручная задача передана Flowday.' : 'Задача возвращена во входящие.');
      else if (existing && manual) showToast('Ручной слот сохранён.');
      else showToast('Изменения сохранены.');
    });

    $('#closeFocusSheet').onclick = () => closeModal('focusSheetBackdrop');
    $('#focusSheetBackdrop').addEventListener('click', (event) => { if (event.target === event.currentTarget) closeModal('focusSheetBackdrop'); });
    $('#timerStart').onclick = toggleFocusTimer; $('#timerReset').onclick = () => { if (focusRunning) { showToast('Сначала поставь фокус на паузу.'); return; } resetFocusTimer(); };
    $('#focusTaskSelect').addEventListener('change', () => { if (focusRunning) return; focusTaskId = $('#focusTaskSelect').value || null; resetFocusTimer(); updateFocusTip(); });
    $('#moreFocus').onclick = openFocusSheet; $('#moreInsights').onclick = renderInsights; $('#moreSettings').onclick = () => { renderSettings(); openModal('settingsSheetBackdrop'); };

    ['planningSheetBackdrop', 'insightsSheetBackdrop', 'settingsSheetBackdrop', 'dateSheetBackdrop'].forEach((id) => $(`#${id}`).addEventListener('click', (event) => { if (event.target === event.currentTarget) closeModal(id); }));
    $('#closePlanningSheet').onclick = () => closeModal('planningSheetBackdrop'); $('#closeInsightsSheet').onclick = () => closeModal('insightsSheetBackdrop'); $('#closeSettingsSheet').onclick = () => closeModal('settingsSheetBackdrop');
    $('#replanFromSheet').onclick = () => { closeModal('planningSheetBackdrop'); autoPlanAll(); }; $('#clearAutoFromSheet').onclick = clearAutoSlots;

    $('#settingsForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const workStart = toMinutes($('#workStartInput').value); const workEnd = toMinutes($('#workEndInput').value); const lunchStart = toMinutes($('#lunchStartInput').value); const lunchEnd = toMinutes($('#lunchEndInput').value);
      const error = validateSettingsDraft(workStart, workEnd, lunchStart, lunchEnd); if (error) { showToast(error); return; }
      data.settings = { ...data.settings, workStart: workStart / 60, workEnd: workEnd / 60, lunchStart: lunchStart / 60, lunchEnd: lunchEnd / 60, buffer: Number($('#bufferInput').value), focusLength: Number($('#blockInput').value), weekends: $('#weekendsInput').checked, theme: $('#appearanceInput').value };
      repairAndPersist(); if (!focusRunning) resetFocusTimer(); saveData(); closeModal('settingsSheetBackdrop');
      if (data.tasks.some((task) => !task.done && !task.locked && deadlineTimestamp(task) >= Date.now())) autoPlanAll(false); else renderAll();
      showToast('Настройки сохранены, план пересобран.');
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

  function handleDelegatedActions(event) {
    const target = event.target.closest('[data-toggle-task], [data-edit-task]'); if (!target) return;
    if (target.dataset.toggleTask) { event.stopPropagation(); completeTask(target.dataset.toggleTask); return; }
    if (target.dataset.editTask) openTaskSheet(target.dataset.editTask);
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
  }

  // Lightweight QA hooks used only by automated regression tests.
  if (globalThis.__FLOWDAY_QA__) globalThis.__FLOWDAY_TEST__ = {
    getData: () => clone(data),
    setData: (raw) => { data = normalizeData(raw); },
    setCurrentDate: (value) => { currentDate = startOfDay(value); },
    normalizeData,
    validateManualSlot,
    autoPlanAll,
    findSlot,
    sortForPlanning,
    planningScore,
    deadlineLabel,
    deadlineTimestamp,
    workingCapacityMinutes,
    dateFromKey,
    isValidDateKey,
    startOfDay
  };

  boot();
})();
