import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tests = [
  'test_manual_scheduling.mjs',
  'test_university_schedule.mjs',
  'test_onboarding.mjs',
  'test_rea_fallback.mjs',
  'test_rea_text_fallback.mjs',
  'test_live_sync.mjs',
  'test_backup_import_safety.mjs',
  'test_sync_gateway_guardrails.mjs',
  'test_rea_upstream_error_handling.mjs',
  'test_release_12_1_2.mjs',
  'test_release_version_consistency.mjs'
];

let passed = 0;
const failed = [];
for (const test of tests) {
  process.stdout.write(`\n=== ${test} ===\n`);
  const result = spawnSync(process.execPath, [path.join(root, 'tools', test)], {
    cwd: root,
    stdio: 'inherit',
    env: process.env
  });
  if (result.status === 0) passed += 1;
  else failed.push({ test, status: result.status, signal: result.signal });
}

process.stdout.write(`\nRegression summary: ${passed}/${tests.length} passed.\n`);
if (failed.length) {
  for (const item of failed) process.stderr.write(`FAILED ${item.test} (status=${item.status}, signal=${item.signal || 'none'})\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('All current Tavrimo regression tests passed.\n');
}
