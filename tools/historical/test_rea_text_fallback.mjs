import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const src = fs.readFileSync(new URL('../sync-service/server.mjs', import.meta.url), 'utf8');
const start = src.indexOf('function cleanText');
const end = src.indexOf('\nfunction scheduleEventsToIcs');
const source = `const LESSON_TYPE_PATTERNS = [/Диф\\.?\\s*зачет/i, /Лабораторная работа/i, /Практическое занятие/i, /Курсовая работа/i, /Самостоятельная работа/i, /Лекция/i, /Семинар/i, /Экзамен/i, /Зачет/i, /Практика/i];
const hash = (value) => String(value);
` + src.slice(start, end) + '\nthis.result = parseScheduleText(this.input);';
const context = { input: `15.14д-ГГ04/266 Расписание занятий ПОНЕДЕЛЬНИК, 28.09.2026 1 пара 2 пара 11:50 13:20 Теория государства и права Практическое занятие 4 корпус - 103, пл. Основная 4 пара 14:00 15:30 Экономическая теория Практическое занятие 4 корпус - 302, пл. Основная ВТОРНИК, 29.09.2026 1 пара 08:30 10:00 Физическая культура и спорт Лекция 2 корпус - 137, пл. Основная 2 пара 10:10 11:40 История Практическое занятие 4 корпус - 205, пл. Основная` };
vm.runInNewContext(source, context);
const events = context.result;
assert.equal(events.length, 4);
assert.equal(JSON.stringify(events.map(e => [e.date, e.start, e.end, e.slot])), JSON.stringify([
  ['2026-09-28', '11:50', '13:20', 3],
  ['2026-09-28', '14:00', '15:30', 4],
  ['2026-09-29', '08:30', '10:00', 1],
  ['2026-09-29', '10:10', '11:40', 2]
]));
console.log('REA rendered-text fallback smoke test passed.');
