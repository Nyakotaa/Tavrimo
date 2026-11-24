import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tests = [
  'test_manual_scheduling.mjs',
  'test_calendar_migration_12_4_0.mjs',
  'test_external_calendar_features.mjs',
  'test_profile_12_4_0.mjs',
  'test_local_only_architecture.mjs',
  'test_onboarding.mjs',
  'test_backup_import_safety.mjs',
  'test_navigation_smoke_12_4_0.mjs',
  'test_dom_selector_integrity_12_4_0.mjs',
  'test_release_12_4_0.mjs',
  'test_release_version_consistency.mjs'
];
let passed = 0;
const failed = [];
for (const test of tests) {
  process.stdout.write('\n=== ' + test + ' ===\n');
  const result = spawnSync(process.execPath, [path.join(root, 'tools', test)], { cwd: root, stdio: 'inherit', env: process.env });
  if (result.status === 0) passed += 1;
  else failed.push({ test, status: result.status, signal: result.signal });
}
process.stdout.write('\nRegression summary: ' + passed + '/' + tests.length + ' passed.\n');
if (failed.length) {
  for (const item of failed) process.stderr.write('FAILED ' + item.test + ' (status=' + item.status + ', signal=' + (item.signal || 'none') + ')\n');
  process.exitCode = 1;
} else process.stdout.write('All current Tavrimo 12.4.0 regression tests passed.\n');
