import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadEngine } from './engine.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = loadEngine(path.join(root, 'gas/release/Code.js'));
const failures = [];

function check(id, ok, actual) {
  if (!ok) failures.push({ id, actual });
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + id);
}

function keyOf(row) { return row.sourceKey; }
function inApril(row) { return row.yearMonth === '2026-04'; }

const existing = [
  { id: 'JL-OLD', sourceKey: 'stmt:s:old', yearMonth: '2026-04', amount: 1 },
  { id: 'JL-KEEP', sourceKey: 'stmt:s:keep', yearMonth: '2026-04', amount: 2 },
  { id: 'JL-OTHER', sourceKey: 'stmt:s:other', yearMonth: '2026-05', amount: 9 }
];
const desired = [
  { id: 'JL-NEW-KEEP', sourceKey: 'stmt:s:keep', yearMonth: '2026-04', amount: 20 },
  { id: 'JL-NEW-A', sourceKey: 'stmt:s:a', yearMonth: '2026-04', amount: 3 },
  { id: 'JL-NEW-B', sourceKey: 'stmt:s:b', yearMonth: '2026-04', amount: 4 }
];

const stopped = engine.keyedReplace_(existing, desired, keyOf, inApril, 1);
check('interrupt-after-first-upsert-keeps-old-rows', stopped.complete === false && stopped.rows.some((r) => r.id === 'JL-OLD') && stopped.rows.some((r) => r.id === 'JL-KEEP' && r.amount === 20) && !stopped.rows.some((r) => r.sourceKey === 'stmt:s:a'), stopped);

const resumed = engine.keyedReplace_(stopped.rows, desired, keyOf, inApril, 2);
check('recovery-interrupted-again-does-not-duplicate', resumed.complete === false && resumed.rows.filter((r) => r.sourceKey === 'stmt:s:keep').length === 1 && resumed.rows.filter((r) => r.sourceKey === 'stmt:s:a').length === 1 && resumed.rows.find((r) => r.sourceKey === 'stmt:s:keep').id === 'JL-KEEP', resumed.rows.map((r) => r.id + ':' + r.sourceKey));

const restored = engine.keyedReplace_(resumed.rows, desired, keyOf, inApril, null);
const april = restored.rows.filter(inApril);
check('recovery-finishes-without-new-ids-or-lost-scope', restored.complete === true && april.length === 3 && april.find((r) => r.sourceKey === 'stmt:s:keep').id === 'JL-KEEP' && april.some((r) => r.id === 'JL-NEW-A') && april.some((r) => r.id === 'JL-NEW-B') && !restored.rows.some((r) => r.id === 'JL-OLD') && restored.rows.some((r) => r.id === 'JL-OTHER'), restored.rows.map((r) => r.id));

const ignored = engine.keyedReplace_(restored.rows, desired, keyOf, inApril, null);
check('lost-response-replay-keeps-same-rows', JSON.stringify(ignored.rows.map((r) => r.id).sort()) === JSON.stringify(restored.rows.map((r) => r.id).sort()) && ignored.rows.filter((r) => r.sourceKey === 'stmt:s:a').length === 1, ignored.rows.map((r) => r.id));

const source = fs.readFileSync(path.join(root, 'gas/release/Code.js'), 'utf8');
const persistAt = source.indexOf('function persist_');
const upsertAt = source.indexOf('function upsertMonthRow_');
const persistBody = source.slice(persistAt, upsertAt);
const lockAt = source.indexOf('function withScriptLock_');
const lockBody = source.slice(lockAt, source.indexOf('function flushSheets_'));
check('ledger-write-precedes-month-flag', persistBody.indexOf('dirty.ledgerMonth') < persistBody.indexOf('dirty.month && dirty.yearMonth') && persistBody.indexOf("applyKeyedReplace_('04_流水日记账'") >= 0 && persistBody.indexOf('deleteRow') < 0, true);
check('replace-upserts-before-delete', source.indexOf('function applyKeyedReplace_') >= 0 && source.indexOf('updateRow_(name, found._row, rec)') < source.indexOf('toDelete.forEach(function (row) { sh.deleteRow(row); })'), true);
check('lock-and-flush-are-not-described-as-a-transaction', source.indexOf('Neither call is a multi-sheet transaction') >= 0 && lockBody.indexOf('tryLock') >= 0 && source.indexOf('SpreadsheetApp.flush()') >= 0, true);

const runAt = source.indexOf('function runAction_');
const runBody = source.slice(runAt, source.indexOf('function dispatch_'));
check('success-log-is-after-business-persist', runBody.indexOf('persist_(store, dirty)') < runBody.indexOf('commitDeferredLogs_()') && runBody.indexOf('dropDeferredLogs_()') < runBody.indexOf('commitDeferredLogs_()'), true);

console.log(JSON.stringify({
  passed: failures.length === 0,
  failed: failures.length,
  model: 'offline-pure-function-not-google-sheets',
  liveWrite: false,
  notProven: 'LockService, SpreadsheetApp.flush, and a timed-out execution that later becomes readable'
}));
if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}
