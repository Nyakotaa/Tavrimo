import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = ('globalThis.__TAVRIMO_QA__ = true;\n' + fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8'))
  .replace('  boot();\n})();', '  // boot disabled for navigation smoke test\n})();');

function element(view = '') {
  const active = { value: false };
  return {
    dataset: view ? { view } : {},
    textContent: '',
    classList: {
      toggle(name, enabled) { if (name === 'active') active.value = Boolean(enabled); },
      contains(name) { return name === 'active' && active.value; },
      add() {},
      remove() {}
    }
  };
}
const header = element();
const tabs = ['today', 'calendar', 'tasks', 'more'].map(view => element(view));
const views = ['today', 'calendar', 'tasks', 'more', 'profile'].map(view => element(view));
const document = {
  documentElement: { dataset: {} },
  body: { classList: { add() {}, remove() {} } },
  querySelector(selector) { return selector === '#headerContext' ? header : null; },
  querySelectorAll(selector) {
    if (selector === '.tab[data-view]') return tabs;
    if (selector === '.view') return views;
    return [];
  }
};
const context = {
  console, document, Date, Intl, Math, Number, String, JSON, Array, Object, Set, Map, RegExp,
  URL, Blob, Promise, Error, TypeError, isNaN, parseInt, parseFloat,
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  navigator: { onLine: false },
  window: { location: { href: 'https://example.test/Tavrimo/' }, addEventListener() {} },
  setTimeout, clearTimeout, setInterval, clearInterval
};
context.globalThis = context;
vm.runInNewContext(app, context, { filename: 'app.js' });
const qa = context.__TAVRIMO_TEST__;
assert.ok(qa, 'QA hooks must be available');

const cases = [
  ['today', 'Сегодня', 'today'],
  ['calendar', 'Неделя', 'calendar'],
  ['tasks', 'Задачи', 'tasks'],
  ['more', 'Ещё', 'more'],
  ['profile', 'Профиль', 'more']
];
for (const [view, heading, activeTab] of cases) {
  qa.setCurrentViewForTest(view);
  assert.equal(header.textContent, heading, 'Topbar heading for ' + view);
  assert.deepEqual(tabs.filter(tab => tab.classList.contains('active')).map(tab => tab.dataset.view), [activeTab], 'Active navigation tab for ' + view);
  assert.deepEqual(views.filter(item => item.classList.contains('active')).map(item => item.dataset.view), [view], 'Active screen for ' + view);
}
console.log('Tavrimo 12.4.0 navigation smoke tests passed (Today, Week, Tasks, More, Profile).');
