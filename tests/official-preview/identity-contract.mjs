/**
 * Offline identity contract. No network. The me payload below is fictional.
 * Reads BUILD_ID, DATA_MODE and productionData from the repo back end,
 * then asks identityDecision to accept that me against AC01_BUILD.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const gas = read('gas/release/Code.js');
const quoted = (name) => gas.match(new RegExp("var " + name + " = '([^']*)'"))[1];
const buildId = quoted('BUILD_ID');
const dataMode = quoted('DATA_MODE');
const meBody = gas.slice(gas.indexOf("action === 'me'"), gas.indexOf("action === 'getEffectiveTargets'"));
const productionData = meBody.match(/productionData:\s*(true|false)/)[1] === 'true';
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(read('admin/js/build.js'), sandbox);
const me = {
  user: { displayName: '虚构用户', role: '顾问', jobId: 'FICTION-USER' },
  asOf: '2026-11-20',
  buildId, dataMode, productionData,
  release: { buildId, dataMode, productionData, spreadsheetId: 'FICTION-SHEET', driveRootId: 'FICTION-DRIVE' }
};
const out = require(path.join(root, 'admin/js/rules.js')).identityDecision(me, sandbox.window.AC01_BUILD);
assert.equal(out.ok, true, JSON.stringify(out));
assert.deepEqual(out.reasons, []);
console.log(JSON.stringify({ ok: true, reasons: out.reasons, buildId, dataMode, productionData }));
