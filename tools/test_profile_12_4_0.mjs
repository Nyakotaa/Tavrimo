import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = ('globalThis.__TAVRIMO_QA__ = true;\n' + fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8')).replace('  boot();\n})();', '  // boot disabled for profile tests\n})();');
const classList = { add() {}, remove() {}, toggle() {} };
const element = new Proxy({ classList, style: { setProperty() {} }, dataset: {}, hidden: false, value: '', checked: false, disabled: false, textContent: '', innerHTML: '', setAttribute() {}, addEventListener() {}, focus() {} }, { get: (target, key) => key in target ? target[key] : undefined, set: (target, key, value) => (target[key] = value, true) });
const context = {
  console, crypto: { randomUUID: () => 'profile-test' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  Intl, Date, Math, Number, String, JSON, Array, Object, Set, Map, RegExp, URL,
  isNaN, parseInt, parseFloat,
  document: { documentElement: { dataset: {} }, body: { classList }, querySelector: () => element, querySelectorAll: () => [] },
  window: { location: { href: 'https://example.test/Tavrimo/' } }, navigator: { onLine: false },
  setTimeout, clearTimeout, setInterval, clearInterval, confirm: () => true
};
context.globalThis = context;
vm.runInNewContext(app, context);
const qa = context.__TAVRIMO_TEST__;
assert.ok(qa);
const avatar = 'data:image/jpeg;base64,AA==';
const normalized = qa.normalizeData({ settings: { displayName: '  Даниил  ' }, tasks: [], focus: { sessions: [] }, profile: { avatarDataUrl: avatar } });
assert.equal(normalized.settings.displayName, 'Даниил');
assert.equal(normalized.profile.avatarDataUrl, avatar);
assert.equal(qa.normalizeData({ settings: { displayName: 'Имя' }, tasks: [], profile: { avatarDataUrl: 'https://example.test/photo.png' } }).profile.avatarDataUrl, '', 'Remote avatar URLs must not be accepted');
assert.equal(qa.getGreeting(8, normalized.settings.displayName), 'Доброе утро, Даниил!');
assert.equal(qa.getGreeting(13, normalized.settings.displayName), 'Добрый день, Даниил!');
assert.equal(qa.getGreeting(19, normalized.settings.displayName), 'Добрый вечер, Даниил!');
assert.equal(qa.getGreeting(1, ''), 'Доброй ночи!');
console.log('Tavrimo local profile data tests passed.');
