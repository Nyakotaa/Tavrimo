import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const handlers = new Map();
const cachedIndex = { marker: 'cached-tavrimo-index' };
const cache = {
  async match(key) { return key === './index.html' ? cachedIndex : null; },
  async put() {}
};
let fetchCalls = 0;
const caches = {
  async open() { return cache; },
  async match(key) { return key === './index.html' ? cachedIndex : null; },
  async keys() { return ['tavrimo-v-old']; },
  async delete() { return true; }
};
const context = {
  caches, URL, Response, Request, AbortController, setTimeout, clearTimeout,
  fetch: async () => { fetchCalls += 1; throw new Error('Network should not be awaited for cached shell.'); },
  self: {
    location: { origin: 'https://tavrimo-rea-sync.onrender.com' },
    clients: { claim: async () => {} },
    skipWaiting() {},
    addEventListener(name, callback) { handlers.set(name, callback); }
  }
};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: 'sw.js' });
const fetchHandler = handlers.get('fetch');
assert.ok(fetchHandler);
let responsePromise;
const waitUntilPromises = [];
fetchHandler({
  request: { method: 'GET', mode: 'navigate', url: 'https://tavrimo-rea-sync.onrender.com/' },
  respondWith(promise) { responsePromise = promise; },
  waitUntil(promise) { waitUntilPromises.push(promise); }
});
const response = await responsePromise;
assert.equal(response, cachedIndex, 'Cached navigation must be returned directly');
assert.equal(fetchCalls, 0, 'Cached navigation must not wait for Render to wake up');
assert.equal(waitUntilPromises.length, 0);
console.log('Service Worker cached navigation tests passed.');
