import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createReaHttpError } from '../sync-service/rea-http-errors.mjs';

const forbidden = createReaHttpError(403, 'https://rasp.rea.ru/?q=test', 'открытии страницы');
assert.ok(forbidden instanceof Error);
assert.equal(forbidden.code, 'REA_UPSTREAM_FORBIDDEN');
assert.equal(forbidden.upstreamStatus, 403);
assert.match(forbidden.message, /не ошибка номера группы/i);
assert.match(forbidden.message, /сохранённые данные расписания не изменены/i);
assert.equal(createReaHttpError(200, 'https://rasp.rea.ru/'), null);
assert.equal(createReaHttpError(404, 'https://rasp.rea.ru/'), null);

const server = fs.readFileSync(new URL('../sync-service/server.mjs', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
assert.match(server, /throwIfReaHttpError\(page, landingResponse/);
assert.match(server, /throwIfReaHttpError\(page, retryResponse/);
assert.match(server, /403\\s\+Forbidden/i);
assert.match(server, /REA_FORBIDDEN_COOLDOWN_MS/);
assert.match(server, /Retry-After/);
assert.match(server, /if \(error\?\.code === 'REA_UPSTREAM_FORBIDDEN'\) throw error/);
assert.match(app, /payload\?\.code === 'REA_UPSTREAM_FORBIDDEN'/);
assert.match(app, /Сохранённые данные расписания не изменены/);
console.log('REA upstream 403 handling tests passed.');
