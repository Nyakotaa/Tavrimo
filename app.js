(() => {
  'use strict';

  const APP_VERSION = '5.0.0';
  const SCHEMA_VERSION = 5;
  const STORAGE_KEY = 'flowday-planner-v5';
  const LEGACY_KEYS = ['flowday-planner-v4', 'flowday-planner-v3', 'flowday-planner-v2'];
  const DEMO_TITLES = new Set([
    'Собрать структуру презентации',
    'Ответить на важные письма',
    'Подготовить идеи для проекта',
    'Записаться на стоматолога',
    'Изучить 2 главы курса'
  ]);
  const DEFAULTS = {
    version: SCHEMA_VERSION,
    settings: {
      workStart: 9,
      workEnd: 18,
      lunchStart: 13,
      lunchEnd: 14,
      buffer: 10,
      focusLength: 25,
      weekends: false,
      theme: 'system'
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
  let focusTimer = null;
  let focusRunning = false;
  let focusRemaining = Number(data.settings.focusLength) * 60;

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const byId = (id) => data.tasks.find((task) => String(task.id) === String(id));

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function uid() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function startOfDay(value) {
    const d = new Date(value);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function dateKey(value) {
    const d = startOfDay(value);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function dateFromKey(key) {
    const [y, m, d] = String(key).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
  }

  function addDays(value, days) {
    const d = new Date(value);
    d.setDate(d.getDate() + days);
    return d;
  }

  function daysBetween(a, b) {
    return Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
  }

  function toMinutes(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const parts = String(value || '').split(':').map(Number);
    if (parts.length !== 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return NaN;
    return parts[0] * 60 + parts[1];
  }

  function hm(minutes) {
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }

  function shortDate(value) {
    return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(value).replace('.', '');
  }

  function longDate(value) {
    return new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(value);
  }

  function weekdayShort(value) {
    return new Intl.DateTimeFormat('ru-RU', { weekday: 'short' }).format(value).replace('.', '');
  }

  function formatDuration(minutes) {
    const m = Math.max(0, Number(minutes) || 0);
    const hours = Math.floor(m / 60);
    const mins = m % 60;
    if (hours && mins) return `${hours}ч ${mins}м`;
    if (hours) return `${hours}ч`;
    return `${mins}м`;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[char]));
  }

  function normalizeTask(task, index) {
    const deadline = /^\d{4}-\d{2}-\d{2}$/.test(String(task.deadline || '')) ? String(task.deadline) : dateKey(new Date());
    return {
      id: task.id != null ? String(task.id) : `${Date.now()}-${index}`,
      title: String(task.title || '').trim().slice(0, 120),
      duration: Math.min(480, Math.max(15, Math.round(Number(task.duration) || 30))),
      priority: Math.min(3, Math.max(1, Number(task.priority) || 2)),
      deadline,
      category: String(task.category || 'Учёба'),
      note: String(task.note || '').slice(0, 300),
      scheduledDate: /^\d{4}-\d{2}-\d{2}$/.test(String(task.scheduledDate || '')) ? String(task.scheduledDate) : null,
      scheduledStart: /^\d{2}:\d{2}$/.test(String(task.scheduledStart || '')) ? String(task.scheduledStart) : null,
      locked: Boolean(task.locked),
      done: Boolean(task.done),
      createdAt: task.createdAt || new Date().toISOString()
    };
  }

  function normalizeData(raw) {
    const base = clone(DEFAULTS);
    if (!raw || typeof raw !== 'object') return base;
    const settings = { ...base.settings, ...(raw.settings || {}) };
    settings.workStart = Number.isFinite(Number(settings.workStart)) ? Number(settings.workStart) : 9;
    settings.workEnd = Number.isFinite(Number(settings.workEnd)) ? Number(settings.workEnd) : 18;
    settings.lunchStart = Number.isFinite(Number(settings.lunchStart)) ? Number(settings.lunchStart) : 13;
    settings.lunchEnd = Number.isFinite(Number(settings.lunchEnd)) ? Number(settings.lunchEnd) : 14;
    settings.buffer = [0, 5, 10, 15].includes(Number(settings.buffer)) ? Number(settings.buffer) : 10;
    settings.focusLength = [25, 50, 90, 120].includes(Number(settings.focusLength)) ? Number(settings.focusLength) : ([25, 50, 90, 120].includes(Number(settings.blockMax)) ? Number(settings.blockMax) : 25);
    settings.weekends = Boolean(settings.weekends);
    settings.theme = ['system', 'light', 'dark'].includes(settings.theme) ? settings.theme : 'system';
    const tasks = Array.isArray(raw.tasks) ? raw.tasks.map(normalizeTask).filter((task) => task.title) : [];
    const focus = { ...base.focus, ...(raw.focus || {}) };
    focus.totalMinutes = Math.max(0, Number(focus.totalMinutes) || 0);
    focus.sessions = Array.isArray(focus.sessions) ? focus.sessions.slice(-500) : [];
    return { version: SCHEMA_VERSION, settings, tasks, focus };
  }

  function isOnlyLegacyDemo(value) {
    return value.tasks?.length === 5
      && value.tasks.every((task) => DEMO_TITLES.has(task.title))
      && value.tasks.every((task) => !task.done)
      && Number(value.focus?.totalMinutes || 0) === 0;
  }

  function loadData() {
    try {
      const keys = [STORAGE_KEY, ...LEGACY_KEYS];
      for (const key of keys) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = normalizeData(JSON.parse(raw));
        if (isOnlyLegacyDemo(parsed)) {
          for (const legacy of LEGACY_KEYS) localStorage.removeItem(legacy);
          return clone(DEFAULTS);
        }
        if (key !== STORAGE_KEY) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
        }
        return parsed;
      }
    } catch {
      // fall through to clean start
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

  function isWorkingDay(value) {
    const day = startOfDay(value).getDay();
    return data.settings.weekends || (day !== 0 && day !== 6);
  }

  function workingCapacityMinutes() {
    const total = (data.settings.workEnd - data.settings.workStart) * 60;
    const lunch = Math.max(0, (data.settings.lunchEnd - data.settings.lunchStart) * 60);
    return Math.max(0, total - lunch);
  }

  function priorityLabel(priority) {
    if (priority === 3) return 'Высокий';
    if (priority === 1) return 'Низкий';
    return 'Средний';
  }

  function priorityClass(priority) {
    return priority === 3 ? 'priority-high' : priority === 1 ? 'priority-low' : 'priority-mid';
  }

  function deadlineLabel(task) {
    const diff = daysBetween(new Date(), dateFromKey(task.deadline));
    if (diff < 0) return `Просрочено · ${Math.abs(diff)}д`;
    if (diff === 0) return 'Сегодня';
    if (diff === 1) return 'Завтра';
    return `До ${shortDate(dateFromKey(task.deadline))}`;
  }

  function scheduleLabel(task) {
    if (!task.scheduledDate || !task.scheduledStart) return 'Без времени';
    return `${shortDate(dateFromKey(task.scheduledDate))}, ${task.scheduledStart}`;
  }

  function getScheduled(date) {
    const key = typeof date === 'string' ? date : dateKey(date);
    return data.tasks
      .filter((task) => task.scheduledDate === key && task.scheduledStart)
      .sort((a, b) => toMinutes(a.scheduledStart) - toMinutes(b.scheduledStart));
  }

  function getOpenInbox() {
    return data.tasks
      .filter((task) => !task.done && !task.scheduledDate)
      .sort((a, b) => (a.deadline + a.title).localeCompare(b.deadline + b.title, 'ru'));
  }

  function getWeekStart(date) {
    const d = startOfDay(date);
    const day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return d;
  }

  function taskScore(task, fromDate) {
    const start = dateFromKey(dateKey(fromDate));
    const deadline = dateFromKey(task.deadline);
    const days = daysBetween(start, deadline);
    const urgency = days < 0 ? 180 : Math.max(0, 100 - days * 14);
    const priority = task.priority * 42;
    const duration = Math.max(0, 20 - Math.round(task.duration / 15));
    return priority + urgency + duration;
  }

  function mergeIntervals(intervals) {
    const list = intervals
      .filter((item) => Number.isFinite(item.s) && Number.isFinite(item.e) && item.e > item.s)
      .sort((a, b) => a.s - b.s);
    const merged = [];
    for (const interval of list) {
      const last = merged[merged.length - 1];
      if (last && interval.s <= last.e) last.e = Math.max(last.e, interval.e);
      else merged.push({ ...interval });
    }
    return merged;
  }

  function getFreeWindows(dayKey, occupied) {
    const start = data.settings.workStart * 60;
    const end = data.settings.workEnd * 60;
    const lunchStart = data.settings.lunchStart * 60;
    const lunchEnd = data.settings.lunchEnd * 60;
    const intervals = [...(occupied || []), { s: lunchStart, e: lunchEnd }]
      .map((i) => ({ s: Math.max(start, i.s), e: Math.min(end, i.e) }))
      .filter((i) => i.e > i.s);
    const merged = mergeIntervals(intervals);
    const result = [];
    let cursor = start;
    for (const interval of merged) {
      if (interval.s > cursor) result.push([cursor, interval.s]);
      cursor = Math.max(cursor, interval.e);
    }
    if (cursor < end) result.push([cursor, end]);
    return result;
  }

  function addOccupied(occupied, task) {
    if (!task.scheduledDate || !task.scheduledStart || task.done) return;
    const start = toMinutes(task.scheduledStart);
    const end = start + task.duration + Number(data.settings.buffer || 0);
    (occupied[task.scheduledDate] ||= []).push({ s: start, e: end });
  }

  function findSlot(task, fromDate, occupied) {
    const startFrom = startOfDay(fromDate);
    const deadline = dateFromKey(task.deadline);
    for (let cursor = startFrom; cursor <= deadline; cursor = addDays(cursor, 1)) {
      if (!isWorkingDay(cursor)) continue;
      const key = dateKey(cursor);
      const windows = getFreeWindows(key, occupied[key] || []);
      for (const [windowStart, windowEnd] of windows) {
        let start = Math.ceil(windowStart / 15) * 15;
        if (key === dateKey(new Date()) && cursor.getTime() === startOfDay(new Date()).getTime()) {
          start = Math.max(start, Math.ceil((new Date().getHours() * 60 + new Date().getMinutes()) / 15) * 15);
        }
        start = Math.ceil(start / 15) * 15;
        if (start + task.duration <= windowEnd) return { date: key, start };
      }
    }
    return null;
  }

  function autoPlanAll(showResult = true) {
    const today = startOfDay(new Date());
    const planningStart = currentDate < today ? today : currentDate;
    data.tasks.forEach((task) => {
      if (!task.done && !task.locked) {
        task.scheduledDate = null;
        task.scheduledStart = null;
      }
    });

    const occupied = {};
    data.tasks.filter((task) => !task.done && task.locked).forEach((task) => addOccupied(occupied, task));
    const pending = data.tasks
      .filter((task) => !task.done && !task.locked && dateFromKey(task.deadline) >= startOfDay(planningStart))
      .sort((a, b) => taskScore(b, planningStart) - taskScore(a, planningStart));

    let placed = 0;
    for (const task of pending) {
      const slot = findSlot(task, planningStart, occupied);
      if (!slot) continue;
      task.scheduledDate = slot.date;
      task.scheduledStart = hm(slot.start);
      task.locked = false;
      addOccupied(occupied, task);
      placed += 1;
    }
    saveData();
    renderAll();
    if (showResult) showToast(placed ? `План готов · ${placed} ${placed === 1 ? 'задача' : placed < 5 ? 'задачи' : 'задач'}` : 'Свободных окон до дедлайнов не хватило.');
  }

  function scheduleSingle(taskId) {
    const task = byId(taskId);
    if (!task || task.done || task.locked) return;
    const today = startOfDay(new Date());
    const from = currentDate < today ? today : currentDate;
    const occupied = {};
    data.tasks.filter((other) => String(other.id) !== String(taskId) && !other.done && other.scheduledDate && other.scheduledStart).forEach((other) => addOccupied(occupied, other));
    const slot = findSlot(task, from, occupied);
    if (!slot) {
      task.scheduledDate = null;
      task.scheduledStart = null;
      saveData();
      renderAll();
      showToast('Пока не нашлось свободного окна до дедлайна.');
      return;
    }
    task.scheduledDate = slot.date;
    task.scheduledStart = hm(slot.start);
    task.locked = false;
    saveData();
    renderAll();
  }

  function validateManualSlot(task, scheduledDate, scheduledStart, duration) {
    if (!scheduledDate || !scheduledStart) return 'Укажи дату и время.';
    if (!isWorkingDay(dateFromKey(scheduledDate))) return 'Этот день не входит в рабочие дни.';
    if (dateFromKey(scheduledDate) > dateFromKey(task.deadline)) return 'Слот позже дедлайна.';
    const start = toMinutes(scheduledStart);
    const end = start + duration;
    const workStart = data.settings.workStart * 60;
    const workEnd = data.settings.workEnd * 60;
    const lunchStart = data.settings.lunchStart * 60;
    const lunchEnd = data.settings.lunchEnd * 60;
    if (!Number.isFinite(start)) return 'Неверное время.';
    if (start % 15 !== 0) return 'Время должно быть кратно 15 минутам.';
    if (start < workStart || end > workEnd) return 'Слот выходит за пределы рабочего дня.';
    if (start < lunchEnd && end > lunchStart) return 'Слот пересекается с перерывом.';

    const newStart = start;
    const newEnd = end + Number(data.settings.buffer || 0);
    const conflict = data.tasks.some((other) => {
      if (String(other.id) === String(task.id) || other.done || other.scheduledDate !== scheduledDate || !other.scheduledStart) return false;
      const otherStart = toMinutes(other.scheduledStart);
      const otherEnd = otherStart + other.duration + Number(data.settings.buffer || 0);
      return newStart < otherEnd && newEnd > otherStart;
    });
    return conflict ? 'На это время уже стоит другая задача.' : '';
  }

  function completeTask(id) {
    const task = byId(id);
    if (!task) return;
    task.done = !task.done;
    if (task.done) task.locked = false;
    saveData();
    renderAll();
    showToast(task.done ? 'Задача выполнена.' : 'Задача возвращена в работу.');
  }

  function deleteTask(id) {
    data.tasks = data.tasks.filter((task) => String(task.id) !== String(id));
    saveData();
    closeAllModals();
    renderAll();
    showToast('Задача удалена.');
  }

  function clearAutoSlots() {
    let changed = 0;
    data.tasks.forEach((task) => {
      if (!task.done && !task.locked && (task.scheduledDate || task.scheduledStart)) {
        task.scheduledDate = null;
        task.scheduledStart = null;
        changed += 1;
      }
    });
    saveData();
    renderAll();
    showToast(changed ? `Снято автоматических слотов: ${changed}.` : 'Автоматических слотов нет.');
  }

  function resetAllData() {
    data = clone(DEFAULTS);
    localStorage.removeItem(STORAGE_KEY);
    for (const key of LEGACY_KEYS) localStorage.removeItem(key);
    currentDate = startOfDay(new Date());
    activeFilter = 'all';
    closeAllModals();
    saveData();
    renderAll();
    showToast('Данные очищены.');
  }

  function applyTheme() {
    const requested = data.settings.theme || 'system';
    const actual = requested === 'system'
      ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : requested;
    document.documentElement.dataset.theme = actual;
  }

  function renderAll() {
    applyTheme();
    renderChrome();
    renderToday();
    renderCalendar();
    renderTasks();
    renderSettings();
    populateFocusTasks();
    updateOfflineUI();
    updateAppVersion();
  }

  function renderChrome() {
    $('#headerContext').textContent = currentView === 'today' ? shortDate(currentDate) : ({ calendar: 'Неделя', tasks: 'Задачи', more: 'Ещё' }[currentView] || 'Flowday');
    $$('.tab[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === currentView));
    $$('.view').forEach((view) => view.classList.toggle('active', view.dataset.view === currentView));
    $('#datePickerInput').value = dateKey(currentDate);
  }

  function renderToday() {
    const key = dateKey(currentDate);
    const scheduled = getScheduled(key).filter((task) => !task.done);
    const inbox = getOpenInbox();
    const plannedMinutes = scheduled.reduce((sum, task) => sum + task.duration, 0);
    const capacity = workingCapacityMinutes();
    const pct = Math.min(100, Math.round((plannedMinutes / Math.max(1, capacity)) * 100));
    const isToday = key === dateKey(new Date());

    $('#todayEyebrow').textContent = isToday ? 'СЕГОДНЯ' : longDate(currentDate).toUpperCase();
    $('#todayTitle').textContent = isToday ? 'Твой день.' : `План на ${shortDate(currentDate)}.`;
    $('#todaySubtitle').textContent = data.tasks.length ? 'Flowday держит задачи, дедлайны и свободные окна в одном плане.' : 'Начни с одной задачи — остальное можно доверить планировщику.';
    $('#todayDateText').textContent = shortDate(currentDate);
    $('#focusValue').textContent = `${pct}%`;
    $('#focusRingValue').textContent = `${pct}%`;
    $('#focusLabel').textContent = plannedMinutes ? `${formatDuration(plannedMinutes)} запланировано` : 'ничего не запланировано';
    $('#focusProgress').style.width = `${pct}%`;
    $('#focusRing').style.background = `conic-gradient(#fff ${pct * 3.6}deg,rgba(255,255,255,.11) 0deg)`;
    $('#dayStatusText').textContent = scheduled.length ? 'ПЛАН ДНЯ' : 'СВОБОДНЫЙ ДЕНЬ';
    $('#statusDot').style.background = scheduled.length ? '#8de8b7' : '#9ca2ac';
    $('#planBtnText').textContent = scheduled.length ? 'Перестроить' : 'Собрать план';

    const next = scheduled[0];
    if (!data.tasks.length) {
      $('#insightTitle').textContent = 'Начнём с одной задачи';
      $('#insightText').textContent = 'Нажми + внизу и добавь то, что хочешь сделать.';
    } else if (!scheduled.length && inbox.length) {
      $('#insightTitle').textContent = 'Время ещё не назначено';
      $('#insightText').textContent = 'Flowday может собрать план из задач без времени.';
    } else if (next) {
      $('#insightTitle').textContent = `Дальше · ${next.scheduledStart}`;
      $('#insightText').textContent = next.title;
    } else {
      $('#insightTitle').textContent = 'День свободен';
      $('#insightText').textContent = 'Можешь оставить его таким или собрать план из входящих задач.';
    }

    $('#todayAgenda').innerHTML = scheduled.length
      ? scheduled.slice(0, 8).map(renderAgendaCard).join('')
      : emptyState('Здесь появится расписание.', inbox.length ? 'Собрать план из входящих задач.' : 'Добавь первую задачу и Flowday найдёт для неё окно.', inbox.length ? 'planBtn' : 'tabAdd');

    $('#inboxCount').textContent = String(inbox.length);
    $('#todayInbox').innerHTML = inbox.length
      ? inbox.slice(0, 5).map(renderInboxRow).join('')
      : emptyState('Входящие пусты.', 'Когда появится новая задача, она будет здесь до назначения времени.', 'tabAdd');
  }

  function renderAgendaCard(task) {
    return `<button class="agenda-card ${task.locked ? 'manual' : 'auto'} ${task.done ? 'done' : ''}" data-edit-task="${escapeHtml(task.id)}" style="--delay:${Math.min(6, getScheduled(dateKey(currentDate)).indexOf(task)) * 35}ms">
      <span class="agenda-time">${escapeHtml(task.scheduledStart)}</span>
      <span class="agenda-main"><strong class="agenda-title">${escapeHtml(task.title)}</strong><small class="agenda-meta">${formatDuration(task.duration)} · ${escapeHtml(task.category)} · ${task.locked ? 'вручную' : 'авто'}</small></span>
      <span class="chevron">›</span>
    </button>`;
  }

  function renderInboxRow(task) {
    return `<div class="inbox-row">
      <button class="task-check" data-toggle-task="${escapeHtml(task.id)}" aria-label="Отметить выполненной">✓</button>
      <button class="row-main" data-edit-task="${escapeHtml(task.id)}">
        <strong class="inbox-title">${escapeHtml(task.title)}</strong>
        <small class="inbox-meta">${deadlineLabel(task)} · ${formatDuration(task.duration)} · ${priorityLabel(task.priority)}</small>
      </button>
    </div>`;
  }

  function emptyState(title, subtitle, actionId) {
    return `<div class="empty-card"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(subtitle)}</span>${actionId ? `<button class="empty-action" data-action-target="${escapeHtml(actionId)}">${actionId === 'tabAdd' ? 'Добавить задачу' : 'Собрать план'}</button>` : ''}</div>`;
  }

  function renderCalendar() {
    const monday = getWeekStart(currentDate);
    $('#weekRange').textContent = `${shortDate(monday)} — ${shortDate(addDays(monday, 6))}`;
    $('#weekStrip').innerHTML = Array.from({ length: 7 }, (_, index) => {
      const day = addDays(monday, index);
      const key = dateKey(day);
      const count = getScheduled(key).filter((task) => !task.done).length;
      const active = key === dateKey(currentDate);
      const today = key === dateKey(new Date());
      return `<button class="week-day ${active ? 'active' : ''} ${today ? 'today' : ''} ${count ? 'has-task' : ''}" data-day="${key}">
        <span class="dow">${escapeHtml(weekdayShort(day))}</span><span class="num">${day.getDate()}</span><span class="dot"></span>
      </button>`;
    }).join('');

    const dayTasks = getScheduled(currentDate);
    const openCount = dayTasks.filter((task) => !task.done).length;
    const plannedMinutes = dayTasks.filter((task) => !task.done).reduce((sum, task) => sum + task.duration, 0);
    const pct = Math.min(100, Math.round((plannedMinutes / Math.max(1, workingCapacityMinutes())) * 100));
    $('#calendarDateLabel').textContent = dateKey(currentDate) === dateKey(new Date()) ? 'Сегодня' : longDate(currentDate);
    $('#calendarLoadLabel').textContent = `${formatDuration(plannedMinutes)} запланировано · ${openCount} ${openCount === 1 ? 'задача' : 'задач'}`;
    $('#calendarLoadValue').textContent = `${pct}%`;
    $('#calendarAgenda').innerHTML = dayTasks.length ? dayTasks.map((task) => `<button class="calendar-block" data-edit-task="${escapeHtml(task.id)}"><span class="calendar-time">${escapeHtml(task.scheduledStart)}</span><span class="calendar-slot ${task.locked ? 'manual' : 'auto'} ${task.done ? 'done' : ''}"><strong>${escapeHtml(task.title)}</strong><small>${formatDuration(task.duration)} · ${task.locked ? 'вручную' : 'авто'}${task.category ? ` · ${escapeHtml(task.category)}` : ''}</small></span></button>`).join('') : emptyState('На этот день пока пусто.', 'Выбери другой день или добавь задачу.', 'tabAdd');
  }

  function renderTasks() {
    const search = ($('#taskSearch')?.value || '').trim().toLowerCase();
    const tasks = data.tasks.filter((task) => {
      const matchesFilter = activeFilter === 'all'
        || (activeFilter === 'open' && !task.done)
        || (activeFilter === 'planned' && !task.done && !!task.scheduledDate)
        || (activeFilter === 'done' && task.done);
      const haystack = `${task.title} ${task.note} ${task.category}`.toLowerCase();
      return matchesFilter && (!search || haystack.includes(search));
    }).sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (a.deadline !== b.deadline) return a.deadline.localeCompare(b.deadline);
      return b.priority - a.priority;
    });

    const open = data.tasks.filter((task) => !task.done).length;
    $('#taskSummary').textContent = `${open} ${open === 1 ? 'открытая задача' : 'открытых задач'}`;
    $('#filterCount').textContent = activeFilter === 'all' ? '' : `· ${filterLabel(activeFilter)}`;
    $$('#filterPopover button').forEach((button) => button.classList.toggle('active', button.dataset.filter === activeFilter));
    $('#allTaskList').innerHTML = tasks.length ? tasks.map(renderTaskRow).join('') : emptyState(search ? 'Ничего не найдено.' : 'Задач пока нет.', search ? 'Попробуй другой запрос.' : 'Добавь первую задачу через + внизу.', 'tabAdd');
  }

  function filterLabel(filter) {
    return ({ open: 'открытые', planned: 'в плане', done: 'готово' }[filter] || 'все');
  }

  function renderTaskRow(task) {
    return `<div class="task-row ${task.done ? 'done' : ''}">
      <button class="task-check ${task.done ? 'done' : ''}" data-toggle-task="${escapeHtml(task.id)}" aria-label="${task.done ? 'Вернуть в работу' : 'Выполнить'}">${task.done ? '✓' : ''}</button>
      <button class="task-main" data-edit-task="${escapeHtml(task.id)}">
        <strong class="task-title">${escapeHtml(task.title)}</strong>
        <span class="task-badges"><span class="badge ${priorityClass(task.priority)}">${escapeHtml(priorityLabel(task.priority))}</span><span class="badge">${escapeHtml(deadlineLabel(task))}</span><span class="badge">${escapeHtml(scheduleLabel(task))}</span></span>
      </button>
    </div>`;
  }

  function renderSettings() {
    $('#workStartInput').value = hm(data.settings.workStart * 60);
    $('#workEndInput').value = hm(data.settings.workEnd * 60);
    $('#lunchStartInput').value = hm(data.settings.lunchStart * 60);
    $('#lunchEndInput').value = hm(data.settings.lunchEnd * 60);
    $('#bufferInput').value = String(data.settings.buffer);
    $('#blockInput').value = String(data.settings.focusLength);
    $('#weekendsInput').checked = data.settings.weekends;
    $('#appearanceInput').value = data.settings.theme;
  }

  function updateOfflineUI() {
    const online = navigator.onLine;
    $('#offlineTitle').textContent = online ? 'Офлайн-режим готов' : 'Сейчас без интернета';
    $('#offlineText').textContent = online ? 'Данные остаются на устройстве, интернет для планировщика не нужен.' : 'Основные функции продолжают работать локально.';
    $('#offlineDot').style.background = online ? 'var(--success)' : 'var(--warning)';
  }

  function updateAppVersion() {
    $('#appVersionLabel').textContent = `v${APP_VERSION}`;
  }

  function openModal(id) {
    const modal = $(`#${id}`);
    if (!modal) return;
    modal.hidden = false;
    requestAnimationFrame(() => modal.classList.add('open'));
    document.body.classList.add('modal-open');
  }

  function closeModal(id) {
    const modal = $(`#${id}`);
    if (!modal) return;
    modal.classList.remove('open');
    setTimeout(() => { modal.hidden = true; }, 220);
    if (!$$('.modal-backdrop.open').length) document.body.classList.remove('modal-open');
  }

  function closeAllModals() {
    $$('.modal-backdrop').forEach((modal) => { modal.classList.remove('open'); modal.hidden = true; });
    document.body.classList.remove('modal-open');
    editingId = null;
  }

  function openTaskSheet(id = null) {
    editingId = id ? String(id) : null;
    const task = id ? byId(id) : null;
    $('#taskForm').reset();
    $('#taskSheetKicker').textContent = task ? 'РЕДАКТИРОВАНИЕ' : 'НОВАЯ ЗАДАЧА';
    $('#taskSheetTitle').textContent = task ? 'Измени задачу' : 'Что нужно сделать?';
    $('#saveTaskBtn').textContent = task ? 'Сохранить' : 'Добавить';
    $('#deleteTaskBtn').hidden = !task;

    $('#taskTitle').value = task?.title || '';
    $('#taskDuration').value = String(task?.duration || 60);
    $('#taskPriority').value = String(task?.priority || 2);
    $('#taskDeadline').value = task?.deadline || dateKey(currentDate);
    $('#taskCategory').value = task?.category || 'Учёба';
    $('#taskNote').value = task?.note || '';

    const isManual = Boolean(task?.locked);
    $('#manualScheduleToggle').checked = isManual;
    $('#manualScheduleFields').classList.toggle('hidden', !isManual);
    $('#taskScheduleDate').value = task?.scheduledDate || dateKey(currentDate);
    $('#taskScheduleTime').value = task?.scheduledStart || '';

    openModal('taskSheetBackdrop');
    setTimeout(() => $('#taskTitle').focus(), 80);
  }

  function populateFocusTasks() {
    const select = $('#focusTaskSelect');
    const current = select.value;
    const open = data.tasks.filter((task) => !task.done);
    select.innerHTML = open.length ? open.map((task) => `<option value="${escapeHtml(task.id)}">${escapeHtml(task.title)}</option>`).join('') : '<option value="">Нет открытых задач</option>';
    if (open.some((task) => String(task.id) === current)) select.value = current;
  }

  function openFocusSheet() {
    populateFocusTasks();
    resetFocusTimer();
    openModal('focusSheetBackdrop');
  }

  function updateFocusUI() {
    const length = Math.max(1, Number(data.settings.focusLength) * 60);
    const pct = 1 - focusRemaining / length;
    $('#timerText').textContent = `${String(Math.floor(focusRemaining / 60)).padStart(2, '0')}:${String(focusRemaining % 60).padStart(2, '0')}`;
    $('#timerRing').style.background = `conic-gradient(#fff ${pct * 360}deg,rgba(255,255,255,.12) 0deg)`;
    $('#timerStart').textContent = focusRunning ? 'Пауза' : 'Старт';
    $('#timerMode').textContent = focusRunning ? 'ФОКУС' : 'ГОТОВ';
  }

  function resetFocusTimer() {
    clearInterval(focusTimer);
    focusRunning = false;
    focusRemaining = Math.max(1, Number(data.settings.focusLength) || 25) * 60;
    updateFocusUI();
  }

  function toggleFocusTimer() {
    const taskId = $('#focusTaskSelect').value;
    if (!taskId) { showToast('Сначала добавь задачу.'); return; }
    if (focusRunning) {
      clearInterval(focusTimer);
      focusRunning = false;
      updateFocusUI();
      return;
    }
    focusRunning = true;
    updateFocusUI();
    focusTimer = setInterval(() => {
      focusRemaining -= 1;
      updateFocusUI();
      if (focusRemaining <= 0) {
        clearInterval(focusTimer);
        focusRunning = false;
        const task = byId(taskId);
        data.focus.totalMinutes += Number(data.settings.focusLength);
        data.focus.sessions.push({ date: dateKey(new Date()), taskId, minutes: Number(data.settings.focusLength) });
        saveData();
        resetFocusTimer();
        showToast(task ? `Фокус завершён · ${task.title}` : 'Фокус-сессия завершена.');
        renderAll();
      }
    }, 1000);
  }

  function renderInsights() {
    const monday = getWeekStart(currentDate);
    const days = Array.from({ length: 7 }, (_, index) => dateKey(addDays(monday, index)));
    const completed = data.tasks.filter((task) => task.done).length;
    const planned = data.tasks.filter((task) => !task.done && task.scheduledDate).reduce((sum, task) => sum + task.duration, 0);
    const values = days.map((key) => data.tasks.filter((task) => task.scheduledDate === key && !task.done).reduce((sum, task) => sum + task.duration, 0));
    $('#insightStats').innerHTML = `<div class="stat-card"><strong>${completed}</strong><small>готово</small></div><div class="stat-card"><strong>${formatDuration(planned)}</strong><small>в плане</small></div><div class="stat-card"><strong>${data.focus.totalMinutes}м</strong><small>фокус</small></div>`;
    const max = Math.max(60, ...values);
    $('#barChart').innerHTML = values.map((value, index) => `<div class="chart-bar"><div class="chart-fill" style="height:${Math.max(value ? 8 : 2, Math.round(value / max * 100))}%"></div><span class="chart-label">${escapeHtml(weekdayShort(dateFromKey(days[index])).slice(0, 2))}</span></div>`).join('');
    const avg = Math.round(values.reduce((sum, value) => sum + value, 0) / 7);
    $('#insightRecTitle').textContent = !data.tasks.length ? 'Пустой старт' : avg > workingCapacityMinutes() * 0.75 ? 'Плотная неделя' : 'Есть запас';
    $('#insightRecText').textContent = !data.tasks.length ? 'Добавь несколько задач, и здесь появится ритм недели.' : avg > workingCapacityMinutes() * 0.75 ? 'Держи небольшой буфер между блоками — так переносы переживаются легче.' : `В среднем занято около ${formatDuration(avg)} в день.`;
    openModal('insightsSheetBackdrop');
  }

  function exportData() {
    const json = JSON.stringify(data, null, 2);
    const fileName = `flowday-backup-${dateKey(new Date())}.json`;
    try {
      const file = new File([json], fileName, { type: 'application/json' });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        navigator.share({ title: 'Flowday — резервная копия', files: [file] }).then(() => showToast('Резервная копия подготовлена.')).catch(() => {});
        return;
      }
    } catch {
      // fallback below
    }
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 250);
    showToast('Резервная копия подготовлена.');
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = normalizeData(JSON.parse(reader.result));
        if (!Array.isArray(parsed.tasks)) throw new Error('tasks');
        data = parsed;
        saveData();
        closeModal('settingsSheetBackdrop');
        renderAll();
        showToast('Данные импортированы.');
      } catch {
        showToast('Не удалось прочитать эту резервную копию.');
      }
    };
    reader.readAsText(file);
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function switchView(view) {
    if (!['today', 'calendar', 'tasks', 'more'].includes(view)) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    currentView = view;
    const update = () => renderAll();
    if (!reduce && document.startViewTransition) document.startViewTransition(update);
    else update();
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', async () => {
      try {
        const registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
        if (registration.waiting && navigator.serviceWorker.controller) showUpdateBanner(registration.waiting);
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(worker);
          });
        });
      } catch {
        // Offline functionality gracefully degrades to normal browser storage.
      }
    });
  }

  function showUpdateBanner(worker) {
    $('#updateBanner').hidden = false;
    $('#updateBtn').onclick = () => {
      worker?.postMessage({ type: 'SKIP_WAITING' });
      setTimeout(() => location.reload(), 200);
    };
  }

  function bindEvents() {
    $('#tabAdd').addEventListener('click', () => openTaskSheet());
    $('#todayBtn').addEventListener('click', () => { currentDate = startOfDay(new Date()); switchView('today'); });
    $('#todayDateChip').addEventListener('click', () => {
      const input = $('#datePickerInput');
      if (input.showPicker) input.showPicker(); else input.click();
    });
    $('#datePickerInput').addEventListener('change', (event) => {
      if (!event.target.value) return;
      currentDate = startOfDay(dateFromKey(event.target.value));
      renderAll();
    });
    $('#planBtn').addEventListener('click', () => autoPlanAll(true));
    $('#todayTip').addEventListener('click', () => {
      if (!data.tasks.length) openTaskSheet();
      else if (getOpenInbox().length) autoPlanAll();
      else openModal('planningSheetBackdrop');
    });
    $('#calendarToday').addEventListener('click', () => { currentDate = startOfDay(new Date()); renderAll(); });

    $$('.tab[data-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));

    $('#todayAgenda').addEventListener('click', handleDelegatedActions);
    $('#todayInbox').addEventListener('click', handleDelegatedActions);
    $('#calendarAgenda').addEventListener('click', handleDelegatedActions);
    $('#allTaskList').addEventListener('click', handleDelegatedActions);
    $('#weekStrip').addEventListener('click', (event) => {
      const button = event.target.closest('[data-day]');
      if (!button) return;
      currentDate = startOfDay(dateFromKey(button.dataset.day));
      renderAll();
    });

    $('#taskSearch').addEventListener('input', renderTasks);
    $('#filterButton').addEventListener('click', () => {
      const popover = $('#filterPopover');
      popover.hidden = !popover.hidden;
    });
    $('#filterPopover').addEventListener('click', (event) => {
      const button = event.target.closest('[data-filter]');
      if (!button) return;
      activeFilter = button.dataset.filter;
      $('#filterPopover').hidden = true;
      renderTasks();
    });

    $('#closeTaskSheet').onclick = () => closeModal('taskSheetBackdrop');
    $('#cancelTask').onclick = () => closeModal('taskSheetBackdrop');
    $('#taskSheetBackdrop').addEventListener('click', (event) => { if (event.target === event.currentTarget) closeModal('taskSheetBackdrop'); });
    $('#manualScheduleToggle').addEventListener('change', (event) => $('#manualScheduleFields').classList.toggle('hidden', !event.target.checked));
    $('#deleteTaskBtn').onclick = () => { if (editingId && confirm('Удалить эту задачу?')) deleteTask(editingId); };

    $('#taskForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const existing = editingId ? byId(editingId) : null;
      const title = $('#taskTitle').value.trim();
      const duration = Number($('#taskDuration').value);
      const priority = Number($('#taskPriority').value);
      const deadline = $('#taskDeadline').value || dateKey(currentDate);
      const category = $('#taskCategory').value;
      const note = $('#taskNote').value.trim();
      const manual = $('#manualScheduleToggle').checked;
      if (!title) { showToast('Введите название задачи.'); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) { showToast('Проверь дедлайн.'); return; }
      const task = existing ? { ...existing } : { id: uid(), title: '', duration: 60, priority: 2, deadline, category: 'Учёба', note: '', scheduledDate: null, scheduledStart: null, locked: false, done: false, createdAt: new Date().toISOString() };
      const wasManual = Boolean(existing?.locked);
      let needsAutoPlan = !existing && !manual;
      Object.assign(task, { title, duration, priority, deadline, category, note });

      if (manual) {
        const error = validateManualSlot(task, $('#taskScheduleDate').value, $('#taskScheduleTime').value, duration);
        if (error) { showToast(error); return; }
        task.scheduledDate = $('#taskScheduleDate').value;
        task.scheduledStart = $('#taskScheduleTime').value;
        task.locked = true;
      } else if (existing?.scheduledDate && existing?.scheduledStart && !existing.locked) {
        // Keep an automatic slot only when the edited task still fits it.
        const s = toMinutes(existing.scheduledStart);
        const e = s + duration + Number(data.settings.buffer || 0);
        const overlaps = data.tasks.some((other) => String(other.id) !== String(existing.id) && !other.done && other.scheduledDate === existing.scheduledDate && other.scheduledStart && s < toMinutes(other.scheduledStart) + other.duration + Number(data.settings.buffer || 0) && e > toMinutes(other.scheduledStart));
        const outsideDeadline = dateFromKey(existing.scheduledDate) > dateFromKey(deadline);
        if (overlaps || outsideDeadline) {
          task.scheduledDate = null;
          task.scheduledStart = null;
          needsAutoPlan = true;
        } else {
          task.scheduledDate = existing.scheduledDate;
          task.scheduledStart = existing.scheduledStart;
          task.locked = false;
        }
      } else {
        task.scheduledDate = null;
        task.scheduledStart = null;
        task.locked = false;
        if (existing && wasManual) needsAutoPlan = true;
      }

      if (existing) data.tasks = data.tasks.map((item) => String(item.id) === String(existing.id) ? task : item);
      else data.tasks.push(task);
      saveData();
      closeModal('taskSheetBackdrop');
      renderAll();
      if (needsAutoPlan) scheduleSingle(task.id);
      else showToast(existing ? 'Изменения сохранены.' : 'Задача добавлена.');
    });

    $('#closeFocusSheet').onclick = () => { resetFocusTimer(); closeModal('focusSheetBackdrop'); };
    $('#focusSheetBackdrop').addEventListener('click', (event) => { if (event.target === event.currentTarget) { resetFocusTimer(); closeModal('focusSheetBackdrop'); } });
    $('#timerStart').onclick = toggleFocusTimer;
    $('#timerReset').onclick = resetFocusTimer;
    $('#focusTaskSelect').addEventListener('change', () => { if (!focusRunning) resetFocusTimer(); });

    $('#moreFocus').onclick = openFocusSheet;
    $('#moreInsights').onclick = renderInsights;
    $('#morePlanning').onclick = () => openModal('planningSheetBackdrop');
    $('#moreSettings').onclick = () => { renderSettings(); openModal('settingsSheetBackdrop'); };
    $('#moreInstall').onclick = () => openModal('installSheetBackdrop');

    ['planningSheetBackdrop', 'insightsSheetBackdrop', 'settingsSheetBackdrop', 'installSheetBackdrop'].forEach((id) => {
      const modal = $(`#${id}`);
      modal.addEventListener('click', (event) => { if (event.target === event.currentTarget) closeModal(id); });
    });
    $('#closePlanningSheet').onclick = () => closeModal('planningSheetBackdrop');
    $('#closeInsightsSheet').onclick = () => closeModal('insightsSheetBackdrop');
    $('#closeSettingsSheet').onclick = () => closeModal('settingsSheetBackdrop');
    $('#closeInstallSheet').onclick = () => closeModal('installSheetBackdrop');
    $('#replanFromSheet').onclick = () => { closeModal('planningSheetBackdrop'); autoPlanAll(); };
    $('#clearAutoFromSheet').onclick = () => { closeModal('planningSheetBackdrop'); clearAutoSlots(); };

    $('#settingsForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const workStart = toMinutes($('#workStartInput').value);
      const workEnd = toMinutes($('#workEndInput').value);
      const lunchStart = toMinutes($('#lunchStartInput').value);
      const lunchEnd = toMinutes($('#lunchEndInput').value);
      if (!(workEnd > workStart)) { showToast('Проверь рабочие часы.'); return; }
      if (!(lunchEnd > lunchStart) || lunchStart < workStart || lunchEnd > workEnd) { showToast('Проверь время обеда.'); return; }
      data.settings = {
        ...data.settings,
        workStart: workStart / 60,
        workEnd: workEnd / 60,
        lunchStart: lunchStart / 60,
        lunchEnd: lunchEnd / 60,
        buffer: Number($('#bufferInput').value),
        focusLength: Number($('#blockInput').value),
        weekends: $('#weekendsInput').checked,
        theme: $('#appearanceInput').value
      };
      saveData();
      resetFocusTimer();
      closeModal('settingsSheetBackdrop');
      renderAll();
      showToast('Настройки сохранены.');
    });

    $('#exportBtn').onclick = exportData;
    $('#importInput').addEventListener('change', (event) => { const file = event.target.files?.[0]; if (file) importData(file); event.target.value = ''; });
    $('#resetBtn').onclick = () => { if (confirm('Удалить все задачи, расписание и статистику?')) resetAllData(); };

    window.addEventListener('online', updateOfflineUI);
    window.addEventListener('offline', updateOfflineUI);
    window.addEventListener('scroll', () => $('#topbar').classList.toggle('scrolled', window.scrollY > 4), { passive: true });
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (data.settings.theme === 'system') applyTheme(); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeAllModals(); });
    document.addEventListener('click', (event) => {
      if (!event.target.closest('.filter-button') && !event.target.closest('#filterPopover')) $('#filterPopover').hidden = true;
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') updateOfflineUI(); });
  }

  function handleDelegatedActions(event) {
    const target = event.target.closest('[data-toggle-task], [data-edit-task], [data-action-target]');
    if (!target) return;
    if (target.dataset.toggleTask) { event.stopPropagation(); completeTask(target.dataset.toggleTask); return; }
    if (target.dataset.editTask) { openTaskSheet(target.dataset.editTask); return; }
    if (target.dataset.actionTarget === 'tabAdd') { openTaskSheet(); return; }
    if (target.dataset.actionTarget === 'planBtn') { autoPlanAll(); }
  }

  function boot() {
    $('#appVersionLabel').textContent = `v${APP_VERSION}`;
    $('#datePickerInput').value = dateKey(currentDate);
    bindEvents();
    renderAll();
    updateFocusUI();
    registerServiceWorker();
    if (location.protocol === 'https:' && !navigator.serviceWorker) updateOfflineUI();
  }

  boot();
})();
