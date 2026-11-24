/**
 * Pre-merge required checks. Offline node tests only. No network.
 * identity-contract.mjs is required: a stale gas/release identity fails this run.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'tests/official-preview/identity.mjs',
  'tests/official-preview/identity-contract.mjs',
  'tests/official-preview/replay.mjs',
  'tests/official-preview/timeout.mjs',
  'tests/synthetic/targets-ui.mjs',
  'tests/synthetic/baseline-repro.mjs',
  'tests/synthetic/rounds.mjs'
];

let failed = 0;
for (const file of files) {
  process.stdout.write('\n--- ' + file + ' ---\n');
  const run = spawnSync(process.execPath, [path.join(root, file)], { cwd: root, stdio: 'inherit' });
  if (run.status !== 0) failed += 1;
}
console.log(JSON.stringify({ files: files.length, failed, passed: files.length - failed }));
process.exit(failed ? 1 : 0);
