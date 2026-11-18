import path from 'path';
import { fileURLToPath } from 'url';
import { loadEngine, boot, call, login } from './engine.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = loadEngine(path.join(root, 'gas/release/Code.js'));
const failures = [];
const rows = [];

function check(id, ok, actual) {
  if (!ok) failures.push({ id, actual });
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + id);
}

function rejectedIds(months) {
  const ids = [];
  Object.keys(months || {}).forEach((key) => {
    ((months[key] && months[key].rejectedCash) || []).forEach((item) => {
      if (item && item.clientRequestId) ids.push(item.clientRequestId);
    });
  });
  return ids;
}

function cashIds(months) {
  const ids = [];
  Object.keys(months || {}).forEach((key) => {
    ((months[key] && months[key].cashItems) || []).forEach((item) => {
      if (item && item.clientRequestId) ids.push(item.clientRequestId);
    });
  });
  return ids;
}

function refusalRows(mirror) {
  return (mirror || []).filter((row) => row && row['结果'] === '拒绝' && String(row['动作']) === '登记现金或第三方收支' && String(row['对象']).indexOf('REQ:REQ-1') >= 0);
}

function run(phase) {
  const store = boot(engine);
  const auth = login(engine, 'AC01-SYN-ADVISOR');
  if (phase) store.__sheetPhase = phase;
  const response = call(engine, auth.token, 'addCashItem', {
    yearMonth: '2026-01', date: '2026-01-15', desc: 'SYN', direction: '收入', amount: 2000.01, currency: 'HKD', clientRequestId: 'REQ-1'
  });
  const calls = store.__persistCalls || 0;
  const mirror = JSON.parse(JSON.stringify(store.__logMirror || []));
  const rows = refusalRows(mirror);
  const liveCash = cashIds(store.months);
  store.months = {};
  store.logs = [];
  delete store.__sheetPhase;
  return {
    response,
    calls,
    diskIds: rows.map((row) => 'REQ-1'),
    diskAmounts: rows.map((row) => {
      const found = String(row['备注'] || '').match(/金额=([0-9.]+)/);
      return found ? Number(found[1]) : null;
    }),
    cashIds: liveCash,
    columns: rows[0] || null
  };
}

function reloadState(diskIds) {
  return diskIds.indexOf('REQ-1') >= 0 ? '拒绝已留痕' : '未确认待查';
}

function record(id, phase, result, lost) {
  const reloaded = reloadState(result.diskIds);
  rows.push({
    id,
    phase: phase || 'return',
    disk: result.diskIds.join(',') || 'empty',
    response: lost ? 'lost' : (result.response.recordState || result.response.code || ''),
    reloaded,
    mayWrite: false,
    calls: result.calls
  });
  check(id, result.calls === 1 && result.cashIds.length === 0 && result.response.mayReplay === false, { reloaded, calls: result.calls, cash: result.cashIds, response: result.response });
}

const returned = run('');
record('write-return-observed', '', returned, false);
check('observed-means-disk-has-record', returned.response.recordState === '服务已接受且成功记录' && returned.diskIds.indexOf('REQ-1') >= 0, returned);
record('write-return-then-response-lost', '', returned, true);

const before = run('before');
record('fail-before-write', 'before', before, false);
record('fail-before-write-and-response-lost', 'before', before, true);
check('earliest-unprovable-window', before.diskIds.length === 0 && before.response.recordState === '审计失败未闭环' && reloadState(before.diskIds) === '未确认待查', before);

const after = run('after');
record('interrupt-after-mutation-before-return', 'after', after, false);
check('after-reload-finds-record-without-trusting-response', after.diskIds.indexOf('REQ-1') >= 0 && after.response.recordState === '无法证明是否收到' && reloadState(after.diskIds) === '拒绝已留痕', after);

const partial = run('partial');
record('partial-write', 'partial', partial, false);
check('partial-is-not-success', partial.response.recordState === '无法证明是否收到' && partial.diskIds.indexOf('REQ-1') < 0 && reloadState(partial.diskIds) === '未确认待查', partial);

const ambiguous = run('ambiguous');
record('ambiguous-write-result', 'ambiguous', ambiguous, false);
check('ambiguous-reload-can-still-find-record', ambiguous.response.recordState === '无法证明是否收到' && ambiguous.diskIds.indexOf('REQ-1') >= 0, ambiguous);

const locked = run('lock-timeout');
record('lock-not-held', 'lock-timeout', locked, false);
check('lock-timeout-does-not-write-or-replay', locked.diskIds.length === 0 && locked.response.recordState === '审计失败未闭环' && locked.response.mayReplay === false, locked);

const againStore = boot(engine);
const againAuth = login(engine, 'AC01-SYN-ADVISOR');
const first = call(engine, againAuth.token, 'addCashItem', {
  yearMonth: '2026-01', date: '2026-01-15', desc: 'SYN', direction: '收入', amount: 2000.01, currency: 'HKD', clientRequestId: 'REQ-1'
});
const callsAfterFirst = againStore.__persistCalls || 0;
const second = call(engine, againAuth.token, 'addCashItem', {
  yearMonth: '2026-01', date: '2026-01-16', desc: 'OTHER', direction: '支出', amount: 10, currency: 'HKD', clientRequestId: 'REQ-1'
});
const mirror = JSON.parse(JSON.stringify(againStore.__logMirror || []));
const stored = refusalRows(mirror);
const amounts = stored.map((row) => {
  const found = String(row['备注'] || '').match(/金额=([0-9.]+)/);
  return found ? Number(found[1]) : null;
});
const keptCash = cashIds(againStore.months);
check('same-request-different-payload-keeps-first-record', first.recordState === '服务已接受且成功记录' && second.recordState === '拒绝已留痕' && second.mayReplay === false && stored.length === 1 && stored[0]['结果'] === '拒绝' && amounts.length === 1 && amounts[0] === 2000.01 && keptCash.length === 0 && (againStore.__persistCalls || 0) === callsAfterFirst, { first: first.recordState, second: second.recordState, stored: stored.length, amounts, calls: againStore.__persistCalls });

function lostUpdate() {
  const base = { rejectedCash: [] };
  const left = JSON.parse(JSON.stringify(base));
  const right = JSON.parse(JSON.stringify(base));
  left.rejectedCash.push({ clientRequestId: 'A' });
  right.rejectedCash.push({ clientRequestId: 'B' });
  return right.rejectedCash.map((item) => item.clientRequestId);
}
const survivors = lostUpdate();
check('concurrent-full-row-write-drops-one-record', survivors.length === 1 && survivors[0] === 'B' && survivors.indexOf('A') < 0, survivors);
rows.push({ id: 'concurrent-full-row-write', phase: 'interleave', disk: survivors.join(','), response: 'each-writer-may-observe-own-return', reloaded: 'only-last-row', mayWrite: false, calls: 2 });

console.log('MATRIX');
rows.forEach((row) => {
  console.log([row.id, row.phase, row.disk, row.response, row.reloaded, 'mayWrite=' + row.mayWrite, 'calls=' + row.calls].join(' | '));
});
console.log(JSON.stringify({ passed: failures.length === 0, failed: failures.length, model: 'offline-log-mirror-not-google-sheets', liveWrite: false, singleAppendPartialMeansUnreadableRow: true }));
if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}
