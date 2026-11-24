import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../spotify-dark.css', import.meta.url), 'utf8');
const bodyIndex = html.indexOf('<body class="app-booting"');
const splashIndex = html.indexOf('id="startupSplash"');
const shellIndex = html.indexOf('id="appShell"');
assert.ok(bodyIndex >= 0 && splashIndex > bodyIndex && shellIndex > splashIndex, 'Splash must appear first in the document body');
assert.ok(html.includes('assets/branding/tavrimo-cup-mark.png'));
assert.ok(html.includes('id="startupSplashStatus"'));
assert.ok(html.includes('role="progressbar"'));
assert.ok(css.includes('.startup-splash__progress-fill'));
assert.ok(css.includes('@keyframes tavrimo-splash-progress'));
assert.ok(css.includes('body.app-booting #appShell'));
assert.ok(app.includes('function finishStartupSplash'));
assert.ok(app.includes('finishStartupSplash(startedAt, initialized)'));
console.log('Tavrimo branded startup splash tests passed.');
