const STORAGE_KEY = 'flowday-planner-v2';
const schemaVersion = 2;

const defaultData = {
  version: schemaVersion,
  settings: { workStart: 9, workEnd: 18, lunchStart: 13, lunchEnd: 14, buffer: 10, blockMax: 180 },
  tasks: [
    { id: 1, title: 'Собрать структуру презентации', duration: 90, priority: 3, deadline: '2026-09-28', category: 'Работа', note: '', scheduledDate: null, scheduledStart: null, locked: false, done: false, createdAt: '2026-09-27T07:00:00Z' },
    { id: 2, title: 'Ответить на важные письма', duration: 45, priority: 2, deadline: '2026-09-29', category: 'Работа', note: '', scheduledDate: '2026-09-27', scheduledStart: '10:00', locked: true, done: false, createdAt: '2026-09-27T07:10:00Z' },
    { id: 3, title: 'Подготовить идеи для проекта', duration: 60, priority: 3, deadline: '2026-09-30', category: 'Работа', note: '', scheduledDate: null, scheduledStart: null, locked: false, done: false, createdAt: '2026-09-27T07:20:00Z' },
    { id: 4, title: 'Записаться на стоматолога', duration: 30, priority: 1, deadline: '2026-10-02', category: 'Личное', note: '', scheduledDate: null, scheduledStart: null, locked: false, done: false, createdAt: '2026-09-27T07:30:00Z' },
    { id: 5, title: 'Изучить 2 главы курса', duration: 90, priority: 2, deadline: '2026-10-04', category: 'Учёба', note: '', scheduledDate: '2026-09-27', scheduledStart: '15:30', locked: true, done: false, createdAt: '2026-09-27T07:40:00Z' }
  ]
};

let data = load();
let currentDate = startOfDay(new Date());
let currentView = 'today';
let editingId = null;
let activeFilter = 'all';
let toastTimer = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const byId = (id) => data.tasks.find(t => t.id === id);

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return normalizeData(clone(defaultData));
    return normalizeData(JSON.parse(raw));
  } catch { return normalizeData(clone(defaultData)); }
}
function normalizeData(value) {
  const base = clone(defaultData);
  if (!value || typeof value !== 'object') return base;
  const settings = { ...base.settings, ...(value.settings || {}) };
  const tasks = Array.isArray(value.tasks) ? value.tasks.map((t, i) => ({
    ...base.tasks[0], ...t,
    id: Number.isFinite(Number(t.id)) ? Number(t.id) : Date.now() + i,
    duration: Math.max(15, Number(t.duration) || 30),
    priority: Math.min(3, Math.max(1, Number(t.priority) || 2)),
    locked: Boolean(t.locked), done: Boolean(t.done),
    scheduledDate: t.scheduledDate || null, scheduledStart: t.scheduledStart || null,
    deadline: t.deadline || dateKey(new Date())
  })) : clone(base.tasks);
  return { version: schemaVersion, settings, tasks };
}
function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
function startOfDay(date) { const d = new Date(date); d.setHours(0, 0, 0, 0); return d; }
function dateKey(date) { const d = startOfDay(date); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function dateFromKey(key) { return new Date(`${key}T12:00:00`); }
function addDays(date, amount) { const d = new Date(date); d.setDate(d.getDate()+amount); return d; }
function daysBetween(a,b) { return Math.round((startOfDay(b)-startOfDay(a))/86400000); }
function isoDateLabel(date, opts={}) { return date.toLocaleDateString('ru-RU', { weekday: opts.weekday || undefined, day:'numeric', month: opts.month || 'short' }); }
function longDateLabel(date) { return date.toLocaleDateString('ru-RU', { weekday:'long', day:'numeric', month:'long' }); }
function shortDate(date) { return date.toLocaleDateString('ru-RU',{day:'numeric',month:'short'}).replace('.',''); }
function formatDuration(total) { const h=Math.floor(total/60), m=total%60; return h ? `${h}ч${m?` ${m}м`:''}` : `${m}м`; }
function hm(mins) { return `${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`; }
function toMinutes(value) { const [h,m] = String(value).split(':').map(Number); return h*60+m; }
function timeToHour(value) { return String(value).padStart(2,'0') + ':00'; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function priorityLabel(p) { return p===3 ? 'Высокий' : p===2 ? 'Средний' : 'Низкий'; }
function categoryClass(category) { if (category === 'Личное') return 'green'; if (category === 'Дом') return 'yellow'; return ''; }
function deadlineLabel(task) {
  const delta = daysBetween(currentDate, dateFromKey(task.deadline));
  if (delta < 0) return `просрочено на ${Math.abs(delta)}д`;
  if (delta === 0) return 'сегодня';
  if (delta === 1) return 'завтра';
  return `до ${shortDate(dateFromKey(task.deadline))}`;
}
function activeScheduled(dateStr) { return data.tasks.filter(t => t.scheduledDate === dateStr && t.scheduledStart && !t.done).sort((a,b)=>toMinutes(a.scheduledStart)-toMinutes(b.scheduledStart)); }
function allScheduled(dateStr) { return data.tasks.filter(t => t.scheduledDate === dateStr && t.scheduledStart).sort((a,b)=>toMinutes(a.scheduledStart)-toMinutes(b.scheduledStart)); }
function workingMinutes() { return Math.max(0, (data.settings.workEnd-data.settings.workStart)*60 - Math.max(0, (data.settings.lunchEnd-data.settings.lunchStart))*60); }
function isWeekend(date) { const day=date.getDay(); return day===0 || day===6; }

function taskScore(task, targetDate) {
  const target = dateFromKey(dateKey(targetDate));
  const deadline = dateFromKey(task.deadline);
  const days = daysBetween(target, deadline);
  const urgency = days < 0 ? 120 : Math.max(0, 60 - days*9);
  const durationBonus = Math.max(0, 12 - task.duration/15);
  const focusBonus = task.duration >= 60 ? 6 : 0;
  return task.priority*35 + urgency + durationBonus + focusBonus;
}

function getFreeWindows(dateStr, occupancyOverride=null) {
  const start = data.settings.workStart*60, end=data.settings.workEnd*60;
  const lunchStart=data.settings.lunchStart*60, lunchEnd=data.settings.lunchEnd*60;
  const occupied = occupancyOverride || data.tasks.filter(t => t.scheduledDate===dateStr && t.scheduledStart).map(t => ({s:toMinutes(t.scheduledStart),e:toMinutes(t.scheduledStart)+t.duration}));
  const blocked = [...occupied, {s:lunchStart,e:lunchEnd}].filter(x=>x.e>x.s).map(x=>({s:Math.max(start,x.s),e:Math.min(end,x.e)})).filter(x=>x.e>x.s).sort((a,b)=>a.s-b.s);
  const windows=[]; let cursor=start;
  for (const b of blocked) { if(b.s>cursor) windows.push([cursor,b.s]); cursor=Math.max(cursor,b.e); }
  if(cursor<end) windows.push([cursor,end]);
  return windows;
}
function findSlot(task, fromDate, occupied) {
  let date = startOfDay(fromDate);
  let safety = 0;
  const deadline = dateFromKey(task.deadline);
  const lastDay = deadline > date ? deadline : date;
  while (date <= lastDay && safety++ < 370) {
    const key=dateKey(date);
    const occ = occupied[key] || [];
    const windows = getFreeWindows(key, occ);
    for (const [ws,we] of windows) {
      const snap = Math.ceil(ws/15)*15;
      if (we-snap < task.duration) continue;
      return { date:key, start:snap };
    }
    date=addDays(date,1);
  }
  return null;
}
function addOccupied(occupied, task) {
  if (!task.scheduledDate || !task.scheduledStart) return;
  const key=task.scheduledDate; if(!occupied[key]) occupied[key]=[];
  const buffer = Math.max(0, Number(data.settings.buffer)||0);
  occupied[key].push({s:toMinutes(task.scheduledStart),e:toMinutes(task.scheduledStart)+task.duration+buffer,id:task.id});
  occupied[key].sort((a,b)=>a.s-b.s);
}
function autoPlanAll(showMessage=true) {
  // Keep hand-placed tasks fixed; rebuild only automatic placements.
  data.tasks.forEach(t => { if (!t.done && !t.locked) { t.scheduledDate=null; t.scheduledStart=null; } });
  const occupied={};
  data.tasks.filter(t=>!t.done && t.locked && t.scheduledDate && t.scheduledStart).forEach(t=>addOccupied(occupied,t));
  const pending=data.tasks.filter(t=>!t.done && !t.locked).sort((a,b)=>taskScore(b,currentDate)-taskScore(a,currentDate));
  let placed=0;
  for (const task of pending) {
    const slot=findSlot(task,currentDate,occupied);
    if(!slot) continue;
    task.scheduledDate=slot.date; task.scheduledStart=hm(slot.start); task.locked=false; placed++; addOccupied(occupied,task);
  }
  save(); renderAll();
  showToast(placed ? `Готово: распределено ${placed} ${placed===1?'задача':'задач'}.` : 'Свободного места до дедлайнов не найдено.');
}
function scheduleSingle(id) {
  const task=byId(id); if(!task || task.done) return;
  task.scheduledDate=null; task.scheduledStart=null; task.locked=false;
  const occupied={};
  data.tasks.filter(t=>t.id!==id && t.scheduledDate && t.scheduledStart).forEach(t=>addOccupied(occupied,t));
  const slot=findSlot(task,currentDate,occupied);
  if(!slot) { save(); renderAll(); showToast('Не удалось найти свободное окно до дедлайна.'); return; }
  task.scheduledDate=slot.date; task.scheduledStart=hm(slot.start); save(); renderAll(); showToast(`Задача поставлена на ${shortDate(dateFromKey(slot.date))}, ${task.scheduledStart}.`);
}
function unscheduleTask(id, locked=false) { const task=byId(id); if(!task) return; task.scheduledDate=null; task.scheduledStart=null; task.locked=false; save(); renderAll(); if(locked) showToast('Время освобождено — задача снова автоматическая.'); }
function completeTask(id) { const t=byId(id); if(!t) return; t.done=true; t.locked=false; save(); closeTaskSheet(); renderAll(); showToast('Задача отмечена выполненной.'); }

function renderAll() {
  renderChrome();
  renderToday();
  renderWeek();
  renderTasksView();
  renderSettings();
}
function renderChrome() {
  $('#headerDate').textContent=shortDate(currentDate);
  $$('.tab').forEach(btn => btn.classList.toggle('active', btn.dataset.view===currentView));
  $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view===currentView));
}
function renderToday() {
  const day=dateKey(currentDate), scheduled=activeScheduled(day), open=data.tasks.filter(t=>!t.done && !t.scheduledStart);
  const planned=scheduled.reduce((sum,t)=>sum+t.duration,0), free=Math.max(0,workingMinutes()-planned);
  $('#heroEyebrow').textContent=currentDate.toDateString()===new Date().toDateString() ? 'СЕГОДНЯ' : longDateLabel(currentDate).toUpperCase();
  $('#heroTitle').textContent=currentDate.toDateString()===new Date().toDateString() ? 'Твой день, уже собранный.' : `План на ${shortDate(currentDate)} готов.`;
  $('#heroSubtitle').textContent=scheduled.length ? `${scheduled.length} слотов занято, ${formatDuration(free)} осталось. Ручные блоки не двигаются.` : 'Нажми «Составить план», и Flowday распределит открытые задачи по доступным окнам.';
  $('#plannedHours').textContent=formatDuration(planned); $('#freeHours').textContent=formatDuration(free); $('#openCount').textContent=open.length;
  $('#dateChip').textContent=shortDate(currentDate); $('#timelineTitle').textContent=currentDate.toLocaleDateString('ru-RU',{day:'numeric',month:'long'});
  $('#inboxCount').textContent=open.length;
  renderTimeline(day); renderInbox(open);
  const insight = open.length ? 'Есть что поставить в план' : 'День собран';
  $('#insightTitle').textContent=insight;
  $('#insightText').textContent=open.length ? `${open.length} задач ждут времени. Автопланирование попробует уложить их до дедлайнов, начиная с ближайших свободных окон.` : 'Все открытые задачи имеют время. Перестроить только автоматические слоты можно в любой момент.';
}
function renderTimeline(day) {
  const el=$('#timeline'); el.innerHTML='';
  const scheduled=activeScheduled(day);
  if (!scheduled.length) { el.innerHTML='<div class="empty-timeline"><strong>Пока нет задач во времени</strong><div style="margin-top:5px;font-size:11px">Составь план или добавь ручное время.</div></div>'; return; }
  for (let h=data.settings.workStart; h<data.settings.workEnd; h++) {
    const row=document.createElement('div'); row.className='timeline-row';
    const label=document.createElement('div'); label.className='time-label'; label.textContent=String(h).padStart(2,'0')+':00';
    const slot=document.createElement('div'); slot.className='slot';
    const events=scheduled.filter(t=>Math.floor(toMinutes(t.scheduledStart)/60)===h);
    events.forEach(t=>{
      const ev=document.createElement('button'); ev.type='button'; ev.className=`event ${categoryClass(t.category)} ${t.done?'done':''}`;
      ev.innerHTML=`<div class="event-top"><span class="event-title">${escapeHtml(t.title)}</span><span class="event-time">${escapeHtml(t.scheduledStart)}</span></div><div class="event-meta">${formatDuration(t.duration)} · ${escapeHtml(t.category)} · ${t.locked?'ручное время':'авто'}</div>`;
      ev.onclick=()=>openTaskSheet(t.id); slot.appendChild(ev);
    });
    if(!events.length) slot.innerHTML='<div style="height:24px"></div>';
    row.append(label,slot); el.appendChild(row);
  }
}
function renderInbox(openTasks) {
  const el=$('#taskList');
  if(!openTasks.length) { el.innerHTML='<div class="empty-state"><div style="font-size:24px">✓</div><strong>Все открытые задачи уже распределены</strong><div style="margin-top:5px;font-size:10px">Новые задачи появятся здесь.</div></div>'; return; }
  el.innerHTML=openTasks.sort((a,b)=>taskScore(b,currentDate)-taskScore(a,currentDate)).map(taskCardHtml).join(''); bindTaskActions(el);
}
function taskCardHtml(t) {
  return `<article class="task-card"><div class="task-row"><button class="check-button" data-complete="${t.id}" aria-label="Отметить готово"></button><div class="task-content"><div class="task-title">${escapeHtml(t.title)}</div><div class="task-meta">${formatDuration(t.duration)} · ${deadlineLabel(t)} · ${escapeHtml(t.category)}</div><div class="task-tags"><span class="tag ${t.priority===3?'high':t.priority===2?'medium':''}">${priorityLabel(t.priority)}</span>${t.note?'<span class="tag">есть заметка</span>':''}</div></div></div><div class="task-actions"><button class="mini-action accent" data-plan="${t.id}">Поставить</button><button class="mini-action" data-edit="${t.id}">Изменить</button></div></article>`;
}
function bindTaskActions(container) {
  container.querySelectorAll('[data-complete]').forEach(b=>b.onclick=()=>completeTask(+b.dataset.complete));
  container.querySelectorAll('[data-plan]').forEach(b=>b.onclick=()=>scheduleSingle(+b.dataset.plan));
  container.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openTaskSheet(+b.dataset.edit));
}

function renderWeek() {
  const monday=getMonday(currentDate), end=addDays(monday,6);
  $('#weekRange').textContent=`${shortDate(monday)} — ${shortDate(end)}`;
  const el=$('#weekGrid'); el.innerHTML='';
  for(let i=0;i<7;i++) {
    const d=addDays(monday,i), key=dateKey(d), scheduled=activeScheduled(key), total=scheduled.reduce((s,t)=>s+t.duration,0);
    const card=document.createElement('article'); card.className=`week-day ${key===dateKey(currentDate)?'today':''}`;
    const pct=Math.round((total/Math.max(1,workingMinutes()))*100);
    card.innerHTML=`<div class="week-day-head"><span class="week-day-name">${d.toLocaleDateString('ru-RU',{weekday:'short'})}</span><span class="week-day-date">${d.toLocaleDateString('ru-RU',{day:'numeric',month:'short'})}</span></div><div class="day-load"><span style="width:${Math.min(100,pct)}%"></span></div><div class="week-summary"><span>${scheduled.length?`${scheduled.length} ${scheduled.length===1?'задача':'задач'}`:'Свободно'}</span><strong>${total?formatDuration(total):'—'}</strong></div>${scheduled.slice(0,3).map(t=>`<button class="week-task" data-week-task="${t.id}"><span class="week-task-dot"></span><span class="week-task-main"><span class="week-task-title">${escapeHtml(t.title)}</span><span class="week-task-time">${t.scheduledStart} · ${formatDuration(t.duration)}</span></span></button>`).join('')}${scheduled.length>3?`<div style="font-size:10px;color:var(--muted);margin-top:9px">+${scheduled.length-3} ещё</div>`:''}<button class="secondary-button" data-open-day="${key}" style="width:100%;margin-top:11px;min-height:38px;font-size:11px">Открыть день</button>`;
    el.appendChild(card);
  }
  el.querySelectorAll('[data-open-day]').forEach(b=>b.onclick=()=>{currentDate=dateFromKey(b.dataset.openDay);switchView('today');});
  el.querySelectorAll('[data-week-task]').forEach(b=>b.onclick=()=>openTaskSheet(+b.dataset.weekTask));
}
function getMonday(date) { const d=startOfDay(date), day=d.getDay(); const diff=day===0?-6:1-day; d.setDate(d.getDate()+diff); return d; }

function filteredTasks() {
  const q=$('#taskSearch')?.value.trim().toLowerCase() || '';
  return data.tasks.filter(t=>{
    const status = activeFilter==='all' || (activeFilter==='open'&&!t.done) || (activeFilter==='planned'&&!t.done&&!!t.scheduledStart) || (activeFilter==='done'&&t.done);
    const text=[t.title,t.category,t.note].join(' ').toLowerCase();
    return status && (!q || text.includes(q));
  }).sort((a,b)=>{
    if(a.done!==b.done) return Number(a.done)-Number(b.done);
    if(a.deadline!==b.deadline) return a.deadline.localeCompare(b.deadline);
    return b.priority-a.priority;
  });
}
function renderTasksView() {
  const el=$('#allTaskList'); if(!el) return;
  const tasks=filteredTasks();
  if(!tasks.length){el.innerHTML='<div class="empty-state"><strong>Ничего не найдено</strong><div style="margin-top:5px;font-size:10px">Попробуй изменить фильтр или поиск.</div></div>';return;}
  el.innerHTML=tasks.map(t=>`<article class="task-card"><div class="task-row"><button class="check-button ${t.done?'done':''}" data-complete="${t.id}">${t.done?'✓':''}</button><div class="task-content"><div class="task-title ${t.done?'done':''}">${escapeHtml(t.title)}</div><div class="task-meta">${formatDuration(t.duration)} · ${deadlineLabel(t)} · ${escapeHtml(t.category)}${t.scheduledStart?` · ${t.scheduledDate===dateKey(currentDate)?'сегодня':shortDate(dateFromKey(t.scheduledDate))} ${t.scheduledStart}`:''}</div><div class="task-tags"><span class="tag ${t.priority===3?'high':t.priority===2?'medium':''}">${priorityLabel(t.priority)}</span>${t.locked&&!t.done?'<span class="tag">ручное время</span>':''}</div></div></div><div class="task-actions">${!t.done?(t.scheduledStart?`<button class="mini-action" data-unschedule="${t.id}">Снять время</button>`:`<button class="mini-action accent" data-plan="${t.id}">Поставить</button>`):''}<button class="mini-action" data-edit="${t.id}">Изменить</button><button class="mini-action danger" data-delete="${t.id}">Удалить</button></div></article>`).join('');
  el.querySelectorAll('[data-complete]').forEach(b=>b.onclick=()=>completeTask(+b.dataset.complete));
  el.querySelectorAll('[data-plan]').forEach(b=>b.onclick=()=>scheduleSingle(+b.dataset.plan));
  el.querySelectorAll('[data-unschedule]').forEach(b=>b.onclick=()=>unscheduleTask(+b.dataset.unschedule,true));
  el.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openTaskSheet(+b.dataset.edit));
  el.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>deleteTask(+b.dataset.delete));
}
function deleteTask(id) { const task=byId(id); if(!task) return; if(!confirm(`Удалить «${task.title}»?`)) return; data.tasks=data.tasks.filter(t=>t.id!==id); save(); closeTaskSheet(); renderAll(); showToast('Задача удалена.'); }

function setTimeInput(id, mins) { $(id).value=hm(mins); }
function renderSettings() {
  setTimeInput('#workStartInput',data.settings.workStart*60); setTimeInput('#workEndInput',data.settings.workEnd*60); setTimeInput('#lunchStartInput',data.settings.lunchStart*60); setTimeInput('#lunchEndInput',data.settings.lunchEnd*60);
  $('#bufferInput').value=String(data.settings.buffer); $('#blockInput').value=String(data.settings.blockMax);
}
function openTaskSheet(id=null) {
  editingId=id;
  const t=id?byId(id):null;
  $('#taskSheetKicker').textContent=t?'РЕДАКТИРОВАНИЕ':'НОВАЯ ЗАДАЧА'; $('#taskSheetTitle').textContent=t?'Изменить задачу':'Что нужно сделать?';
  $('#saveTaskBtn').textContent=t?'Сохранить':'Добавить'; $('#deleteTaskBtn').hidden=!t;
  $('#taskTitle').value=t?.title||''; $('#taskDuration').value=String(t?.duration||60); $('#taskPriority').value=String(t?.priority||2); $('#taskDeadline').value=t?.deadline||dateKey(addDays(currentDate,2)); $('#taskCategory').value=t?.category||'Работа'; $('#taskNote').value=t?.note||'';
  const manual=Boolean(t?.scheduledDate&&t?.scheduledStart); $('#manualScheduleToggle').checked=manual; $('#manualScheduleFields').classList.toggle('hidden',!manual); $('#taskScheduleDate').value=t?.scheduledDate||dateKey(currentDate); $('#taskScheduleTime').value=t?.scheduledStart||'';
  $('#taskSheetBackdrop').classList.add('open'); $('#taskSheetBackdrop').setAttribute('aria-hidden','false'); setTimeout(()=>$('#taskTitle').focus(),30);
}
function closeTaskSheet() { editingId=null; $('#taskSheetBackdrop').classList.remove('open'); $('#taskSheetBackdrop').setAttribute('aria-hidden','true'); $('#taskForm').reset(); $('#manualScheduleFields').classList.add('hidden'); }
function openQuickSettings(){ $('#settingsSheetBackdrop').classList.add('open'); $('#settingsSheetBackdrop').setAttribute('aria-hidden','false'); }
function closeQuickSettings(){ $('#settingsSheetBackdrop').classList.remove('open'); $('#settingsSheetBackdrop').setAttribute('aria-hidden','true'); }
function switchView(view) { currentView=view; window.scrollTo({top:0,behavior:'smooth'}); renderChrome(); }
function showToast(message) { clearTimeout(toastTimer); const t=$('#toast'); t.textContent=message; t.classList.add('show'); toastTimer=setTimeout(()=>t.classList.remove('show'),2400); }

function resetDemo() { localStorage.removeItem(STORAGE_KEY); data=clone(defaultData); save(); currentDate=startOfDay(new Date('2026-09-27T09:00:00')); renderAll(); showToast('Демо-данные восстановлены.'); }
function exportData() { const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`flowday-backup-${dateKey(new Date())}.json`; a.click(); URL.revokeObjectURL(url); showToast('Резервная копия подготовлена.'); }
function importData(file) { const reader=new FileReader(); reader.onload=()=>{try{const incoming=normalizeData(JSON.parse(reader.result)); data=incoming; save(); renderAll(); showToast('Данные импортированы.');}catch{showToast('Не удалось прочитать файл JSON.');}}; reader.readAsText(file); }
function formatTimeRange(settings){return `${timeToHour(settings.workStart)}–${timeToHour(settings.workEnd)}`;}

// UI bindings
$('#addTaskBtn').onclick=()=>openTaskSheet(); $('#tabAdd').onclick=()=>openTaskSheet(); $('#tasksAddBtn').onclick=()=>openTaskSheet();
$('#closeTaskSheet').onclick=closeTaskSheet; $('#cancelTask').onclick=closeTaskSheet; $('#taskSheetBackdrop').onclick=e=>{if(e.target===e.currentTarget)closeTaskSheet()};
$('#manualScheduleToggle').onchange=e=>$('#manualScheduleFields').classList.toggle('hidden',!e.target.checked);
$('#deleteTaskBtn').onclick=()=>editingId&&deleteTask(editingId);
$('#taskForm').onsubmit=(e)=>{
  e.preventDefault();
  const wasEditing=Boolean(editingId);
  const title=$('#taskTitle').value.trim();
  if(!title){showToast('Введите название задачи.');return;}
  const manual=$('#manualScheduleToggle').checked;
  const deadline=$('#taskDeadline').value||dateKey(currentDate);
  if(manual && !$('#taskScheduleDate').value){showToast('Укажи дату для ручного слота.');return;}
  if(manual && !$('#taskScheduleTime').value){showToast('Укажи время для ручного слота.');return;}
  let task=editingId?byId(editingId):null;
  if(!task){task={id:Date.now(),title:'',duration:60,priority:2,deadline,category:'Работа',note:'',scheduledDate:null,scheduledStart:null,locked:false,done:false,createdAt:new Date().toISOString()};data.tasks.push(task);}
  Object.assign(task,{title,duration:+$('#taskDuration').value,priority:+$('#taskPriority').value,deadline,category:$('#taskCategory').value,note:$('#taskNote').value.trim()});
  if(manual){
    const targetDate=$('#taskScheduleDate').value;
    const targetTime=$('#taskScheduleTime').value;
    const targetDateObj=dateFromKey(targetDate);
    const start=toMinutes(targetTime), end=start+task.duration;
    const workS=data.settings.workStart*60, workE=data.settings.workEnd*60;
    const lunchS=data.settings.lunchStart*60, lunchE=data.settings.lunchEnd*60;
    const other=data.tasks.filter(t=>t.id!==task.id && t.scheduledDate===targetDate && t.scheduledStart).map(t=>({s:toMinutes(t.scheduledStart),e:toMinutes(t.scheduledStart)+t.duration}));
    const conflict=other.some(x=>start<x.e && end>x.s);
    if(targetDateObj>dateFromKey(deadline)){showToast('Ручной слот должен быть не позже дедлайна.');return;}
    if(start<workS || end>workE || (start<lunchE && end>lunchS)){showToast(`Время должно быть в пределах ${timeToHour(data.settings.workStart)}–${timeToHour(data.settings.workEnd)} и вне обеда.`);return;}
    if(conflict){showToast('В это время уже есть другая задача.');return;}
    task.scheduledDate=targetDate; task.scheduledStart=targetTime; task.locked=true;
  } else {
    task.scheduledDate=null; task.scheduledStart=null; task.locked=false;
  }
  save(); closeTaskSheet(); renderAll(); showToast(wasEditing?'Изменения сохранены.':'Задача добавлена.'); if(!wasEditing && !manual) scheduleSingle(task.id);
};
$('#planBtn').onclick=()=>autoPlanAll(); $('#weekPlanBtn').onclick=()=>autoPlanAll();
$('#clearAutoBtn').onclick=()=>{data.tasks.forEach(t=>{if(!t.locked&&!t.done){t.scheduledDate=null;t.scheduledStart=null;}});save();renderAll();showToast('Автоматические слоты сняты.');};
$('#prevDay').onclick=()=>{currentDate=addDays(currentDate,-1);renderAll()}; $('#nextDay').onclick=()=>{currentDate=addDays(currentDate,1);renderAll()}; $('#todayJump').onclick=()=>{currentDate=startOfDay(new Date());switchView('today');renderAll()}; $('#dateChip').onclick=()=>openQuickSettings();
$('#closeSettingsSheet').onclick=closeQuickSettings; $('#settingsSheetBackdrop').onclick=e=>{if(e.target===e.currentTarget)closeQuickSettings()};
$$('.quick-choice').forEach(btn=>btn.onclick=()=>{const start=Number(btn.dataset.hours); data.settings.workStart=start;data.settings.workEnd=start+9;data.settings.lunchStart=start+4;data.settings.lunchEnd=start+5;save();closeQuickSettings();renderAll();showToast(`Рабочий день ${formatTimeRange(data.settings)}.`);});
$('#openFullSettings').onclick=()=>{closeQuickSettings();switchView('settings');};
$('#settingsForm').onsubmit=e=>{e.preventDefault(); const ws=toMinutes($('#workStartInput').value), we=toMinutes($('#workEndInput').value), ls=toMinutes($('#lunchStartInput').value), le=toMinutes($('#lunchEndInput').value); if(!(we>ws) || !(le>ls) || ls<ws || le>we){showToast('Проверь рабочие часы и обеденный перерыв.');return;} data.settings.workStart=ws/60;data.settings.workEnd=we/60;data.settings.lunchStart=ls/60;data.settings.lunchEnd=le/60;data.settings.buffer=+$('#bufferInput').value;data.settings.blockMax=+$('#blockInput').value;save();renderAll();showToast('Настройки сохранены.');};
$('#taskSearch').oninput=renderTasksView; $$('#filterRow .filter-chip').forEach(btn=>btn.onclick=()=>{$$('#filterRow .filter-chip').forEach(b=>b.classList.remove('active'));btn.classList.add('active');activeFilter=btn.dataset.filter;renderTasksView();});
$('#exportBtn').onclick=exportData; $('#importInput').onchange=e=>{if(e.target.files[0])importData(e.target.files[0]);}; $('#resetBtn').onclick=()=>{if(confirm('Удалить все задачи и настройки и вернуть демо-данные?'))resetDemo();};
$$('.tab[data-view]').forEach(btn=>btn.onclick=()=>switchView(btn.dataset.view));

// Keyboard convenience on iPad/desktop.
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeTaskSheet();closeQuickSettings();}});

renderAll();

// Service worker for installable iOS PWA / offline use.
const offlinePill = document.getElementById('offlinePill');
function updateOnlineState(){
  if (!offlinePill) return;
  offlinePill.hidden = navigator.onLine;
}
window.addEventListener('online', updateOnlineState);
window.addEventListener('offline', updateOnlineState);
updateOnlineState();
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
