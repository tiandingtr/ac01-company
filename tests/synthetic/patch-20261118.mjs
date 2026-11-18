import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadEngine, boot, call, login } from './engine.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = loadEngine(path.join(root, 'gas/release/Code.js'));
const rulesMod = await import(path.join(root, 'admin/js/rules.js'));
const Rules = rulesMod.default || rulesMod;
const store = boot(engine);
const advisor = login(engine, 'AC01-SYN-ADVISOR');
const failures = [];

function check(id, ok, actual) {
  if (!ok) failures.push({ id, actual });
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + id);
}

const plan = call(engine, advisor.token, 'savePlan', {
  yearMonth: '2026-11', type: '固定', title: 'SYN_PATCH_PLAN', planDate: '2026-11-30', owner: 'SYN', clientRequestId: 'PL-PATCH-1'
});
const originalId = plan.data && plan.data.plan && plan.data.plan.id;
const sheetRow = engine.planRecord_(plan.data.plan);
store.plans = [engine.planFromSheetRow_(sheetRow)];
const replay = call(engine, advisor.token, 'savePlan', {
  yearMonth: '2026-11', type: '固定', title: 'SYN_PATCH_PLAN', clientRequestId: 'PL-PATCH-1'
});
check('plan-request-survives-sheet-row', store.plans[0].clientRequestId === 'PL-PATCH-1', store.plans[0]);
check('plan-same-request-keeps-id', replay.ok && replay.data.idempotentReplay === true && replay.data.plan.id === originalId && store.plans.length === 1, {
  ok: replay.ok, id: replay.data && replay.data.plan && replay.data.plan.id, originalId, count: store.plans.length
});

const kept = engine.planUpsertTarget_([
  { _row: 2, '编号': 'PL-EXISTING', '请求号': 'PL-PATCH-1', '年月': "'2026-11", '类型（固定/灵活）': '固定', '事项': 'SYN_PATCH_PLAN' }
], { id: 'PL-NEW', clientRequestId: 'PL-PATCH-1', yearMonth: '2026-11', type: '固定', title: 'SYN_PATCH_PLAN' });
check('plan-upsert-preserves-current-number', kept.action === 'update' && kept.id === 'PL-EXISTING' && kept.preserveId === true, kept);

const legacy = engine.planUpsertTarget_([
  { _row: 3, '编号': 'PL-LEGACY', '请求号': '', '年月': "'2026-11", '类型（固定/灵活）': '固定', '事项': 'SYN_OTHER' }
], { id: 'PL-OTHER-NEW', clientRequestId: 'PL-PATCH-2', yearMonth: '2026-11', type: '固定', title: 'SYN_OTHER' });
check('plan-upsert-does-not-rewrite-other-number', legacy.action === 'insert' && legacy.id === 'PL-OTHER-NEW', legacy);

for (let i = 0; i < 10; i++) {
  const row = call(engine, advisor.token, 'addCashItem', {
    yearMonth: '2026-06', date: '2026-06-02', desc: 'SYN_FILL_' + i, direction: '收入', amount: 2000, currency: 'HKD', clientRequestId: 'CASH-FILL-' + i
  });
  if (!row.ok) failures.push({ id: 'cash-fill-' + i, actual: row });
}
const monthOver = call(engine, advisor.token, 'addCashItem', {
  yearMonth: '2026-06', date: '2026-06-03', desc: 'SYN_MONTH_OVER', direction: '收入', amount: 0.01, currency: 'HKD', clientRequestId: 'CASH-MONTH-001'
});
const monthView = call(engine, advisor.token, 'getMonth', { yearMonth: '2026-06' });
const monthLogs = call(engine, advisor.token, 'getLogs', {});
const monthRejects = (monthLogs.data.logs || []).filter((l) => l.notes && String(l.notes).indexOf('20000.01') >= 0);
const monthItems = (monthView.data.month && monthView.data.month.cashItems) || [];
check('cash-month-001-rejected', monthOver.ok === false && monthOver.code === 'CASH_LIMIT', monthOver);
check('cash-month-001-not-listed', monthItems.every((item) => item.clientRequestId !== 'CASH-MONTH-001') && monthItems.length === 10, monthItems.length);
check('cash-month-001-rejected-row', (monthView.data.rejectedCash || []).some((r) => r.clientRequestId === 'CASH-MONTH-001' && Number(r.amount) === 0.01), monthView.data.rejectedCash);
const monthRefuseLogs = (monthLogs.data.logs || []).filter((l) => l.action === '登记现金或第三方收支' && l.result === '拒绝' && String(l.target).indexOf('CASH-MONTH-001') >= 0);
const monthRefuseRow = monthRefuseLogs[0] ? engine.operationLogRecord_(monthRefuseLogs[0]) : null;
check('cash-month-001-one-durable-record', monthOver.ok === false && monthOver.recordState === '服务已接受且成功记录' && monthOver.mayReplay === false && monthOver.audit && monthOver.audit.owner === 'operationLog' && monthOver.audit.saved === true && monthOver.business.written === false && String(monthOver.error).indexOf('成功') < 0, monthOver);
check('cash-month-001-log-is-six-column-reject', monthRefuseLogs.length === 1 && monthRefuseRow && monthRefuseRow['结果'] === '拒绝' && String(monthRefuseRow['备注']).indexOf('20000.01') >= 0 && String(monthRefuseRow['操作人']) && String(monthRefuseRow['时间']) && !monthRefuseLogs.some((l) => l.result === '成功'), monthRefuseRow);
const savedRejected = (store.months['2026-06'].rejectedCash || []).slice();
store.months['2026-06'].rejectedCash = [];
const fromLogsOnly = call(engine, advisor.token, 'getMonth', { yearMonth: '2026-06' });
const logOnly = (fromLogsOnly.data.rejectedCash || []).find((r) => r.clientRequestId === 'CASH-MONTH-001');
check('rejection-log-survives-without-month-json', !!logOnly && Number(logOnly.amount) === 0.01 && fromLogsOnly.data.month.cashItems.every((item) => item.clientRequestId !== 'CASH-MONTH-001'), logOnly);
store.months['2026-06'].rejectedCash = savedRejected;
const monthBackup = store.months['2026-06'];
delete store.months['2026-06'];
const noMonthRow = call(engine, advisor.token, 'getMonth', { yearMonth: '2026-06' });
check('rejection-log-visible-without-month-row', (noMonthRow.data.rejectedCash || []).some((r) => r.clientRequestId === 'CASH-MONTH-001' && Number(r.amount) === 0.01), noMonthRow.data && noMonthRow.data.rejectedCash);
store.months['2026-06'] = monthBackup;

const unbalanced = call(engine, advisor.token, 'addStatement', {
  yearMonth: '2026-05', accountName: 'SYN-BANK', accountId: 'SYN-BANK-PATCH', opening: 0, closing: 1, currency: 'HKD',
  lines: [{ date: '2026-05-01', desc: 'SYN', direction: '收入', amount: 5, counterparty: 'SYN' }]
});
const genBad = call(engine, advisor.token, 'generateLedger', { yearMonth: '2026-05' });
const genLogs = (call(engine, advisor.token, 'getLogs', {}).data.logs || []).filter((l) => l.action === '生成第一本明细账' && String(l.target).indexOf('2026-05') >= 0);
check('ledger-unbalanced-code', unbalanced.ok && genBad.ok === false && genBad.code === 'UNBALANCED', genBad);
check('ledger-unbalanced-log-is-reject', genLogs.length === 1 && genLogs[0].result === '拒绝' && genLogs.every((l) => l.result !== '成功'), genLogs);

call(engine, advisor.token, 'createContract', { contractNo: 'SYN-PATCH-C', counterparty: 'SYN', type: '服务', amount: 100, currency: 'HKD' });
const linked = call(engine, advisor.token, 'addCashItem', {
  yearMonth: '2024-11', date: '2024-11-15', desc: 'SYN_INV', direction: '收入', amount: 100, currency: 'HKD', contractNo: 'SYN-PATCH-C', clientRequestId: 'CASH-INV-PATCH'
});
const file = call(engine, advisor.token, 'uploadDocument', { category: '其他', relatedId: 'SYN-PATCH-C' }, { name: 'syn.txt', mime: 'text/plain', data: Buffer.from('syn').toString('base64') });
const draft = call(engine, advisor.token, 'createInvoiceDraft', {
  contractNo: 'SYN-PATCH-C', lineId: linked.data.item.id, fileId: file.data.file.id, clientRequestId: 'INV-PATCH-1'
});
const draftNo = draft.data && draft.data.invoice && draft.data.invoice.invoiceNo;
const reloaded = engine.invoiceFromSheetRow_(engine.invoiceRecord_(draft.data.invoice));
store.invoices = [reloaded];
const draftAgain = call(engine, advisor.token, 'createInvoiceDraft', {
  contractNo: 'SYN-PATCH-C', lineId: linked.data.item.id, fileId: file.data.file.id, clientRequestId: 'INV-PATCH-1'
});
check('invoice-request-survives-sheet-row', reloaded.clientRequestId === 'INV-PATCH-1' && !!reloaded.fingerprint, reloaded);
check('invoice-same-request-keeps-number', draft.ok && draftAgain.ok && draftAgain.data.idempotentReplay === true && draftAgain.data.invoice.invoiceNo === draftNo && store.invoices.length === 1 && draftAgain.data.invoice.official === false, {
  draftNo, again: draftAgain.data && draftAgain.data.invoice && draftAgain.data.invoice.invoiceNo, count: store.invoices.length, replay: draftAgain.data && draftAgain.data.idempotentReplay
});
const keptNo = engine.invoiceWriteNo_([
  { '发票号': 'DRAFT-KEPT', '请求号': 'INV-PATCH-1', '来源指纹': reloaded.fingerprint }
], { invoiceNo: 'DRAFT-NEW', clientRequestId: 'INV-PATCH-1', fingerprint: 'other' });
check('invoice-write-preserves-current-number', keptNo === 'DRAFT-KEPT', keptNo);
const draftClash = call(engine, advisor.token, 'createInvoiceDraft', {
  contractNo: 'SYN-PATCH-C', fileId: file.data.file.id, clientRequestId: 'INV-PATCH-1'
});
check('invoice-same-request-different-payload-rejected', draftClash.ok === false && draftClash.code === 'PAYLOAD_MISMATCH' && store.invoices.length === 1 && store.invoices[0].invoiceNo === draftNo, draftClash);

const matchedPlan = Rules.matchSavedWrite('plan', { plans: [{ id: originalId, clientRequestId: 'PL-PATCH-1', yearMonth: '2026-11' }] }, 'PL-PATCH-1');
const missedPlan = Rules.matchSavedWrite('plan', { plans: [{ id: 'PL-OTHER', clientRequestId: 'OTHER' }] }, 'PL-PATCH-1');
const matchedReject = Rules.matchSavedWrite('cash', { month: { cashItems: [], yearMonth: '2026-06' }, rejectedCash: [{ clientRequestId: 'CASH-MONTH-001', reason: 'over' }] }, 'CASH-MONTH-001');
check('ui-readback-finds-saved-plan', matchedPlan && matchedPlan.confirmedAfterTimeout === true && matchedPlan.plan.id === originalId && missedPlan == null, { matchedPlan, missedPlan });
check('ui-readback-does-not-treat-rejection-as-saved', matchedReject && matchedReject.rejected === true && !matchedReject.confirmedAfterTimeout, matchedReject);

const monthRec = engine.monthRecord_(store.months['2026-06']);
const cashBack = JSON.parse(monthRec['现金及第三方JSON']);
const rejectedBack = JSON.parse(monthRec['被拒现金JSON']);
const cashMatch = Rules.matchSavedWrite('cash', { month: { cashItems: cashBack, yearMonth: '2026-06', rejectedCash: rejectedBack }, rejectedCash: rejectedBack }, 'CASH-MONTH-001');
const cashSaved = Rules.matchSavedWrite('cash', { month: { cashItems: cashBack, yearMonth: '2026-06' }, rejectedCash: [] }, 'CASH-FILL-0');
check('cash-json-roundtrip-rejection', cashMatch && cashMatch.rejected === true && !cashMatch.confirmedAfterTimeout, cashMatch);
check('cash-json-roundtrip-saved', cashSaved && cashSaved.confirmedAfterTimeout === true && cashSaved.readback && cashSaved.readback.listed === true, cashSaved);
const planMatch = Rules.matchSavedWrite('plan', { plans: store.plans }, 'PL-PATCH-1');
const invoiceMatch = Rules.matchSavedWrite('invoice', { invoices: store.invoices }, 'INV-PATCH-1');
check('plan-readback-matches-row', planMatch && planMatch.plan.id === originalId && planMatch.plan.clientRequestId === 'PL-PATCH-1', planMatch && planMatch.plan);
check('invoice-readback-matches-row', invoiceMatch && invoiceMatch.invoice.invoiceNo === draftNo && invoiceMatch.invoice.clientRequestId === 'INV-PATCH-1', invoiceMatch && invoiceMatch.invoice);

const uncertainSaved = Rules.afterUncertainWrite(matchedPlan);
const uncertainMiss = Rules.afterUncertainWrite(null);
const uncertainReject = Rules.afterUncertainWrite(matchedReject);
const copy = Rules.unconfirmedCopy();
const reviewMiss = Rules.reviewCopy(null);
check('unconfirmed-does-not-authorize-write', uncertainSaved.mayWrite === false && uncertainMiss.next === 'unconfirmed' && uncertainMiss.mayWrite === false && uncertainReject.mayWrite === false && copy.mayWrite === false && reviewMiss.mayWrite === false, { uncertainMiss, copy });
check('unconfirmed-copy-does-not-ask-retry', copy.message.indexOf('重试') < 0 && copy.message.indexOf('同一请求号') < 0 && reviewMiss.message.indexOf('重试') < 0 && copy.message.indexOf('不是写入失败') >= 0, copy.message);

store.__failAuditWrite = true;
const auditFail = call(engine, advisor.token, 'generateLedger', { yearMonth: '2026-05' });
delete store.__failAuditWrite;
check('audit-failure-not-claimed-saved', auditFail.ok === false && auditFail.code === 'UNBALANCED' && auditFail.recordState === '审计失败未闭环' && auditFail.mayReplay === false && auditFail.audit && auditFail.audit.owner === 'operationLog' && auditFail.audit.saved === false && String(auditFail.error).indexOf('成功') < 0, auditFail);

store.__failRejectionPersist = true;
const callsBefore = store.__persistCalls || 0;
const dataFail = call(engine, advisor.token, 'addCashItem', {
  yearMonth: '2026-03', date: '2026-03-02', desc: 'SYN_DATA_FAIL', direction: '收入', amount: 2000.01, currency: 'HKD', clientRequestId: 'CASH-DATA-FAIL'
});
delete store.__failRejectionPersist;
const dataFailListed = !!(((store.months['2026-03'] || {}).cashItems || []).some((item) => item.clientRequestId === 'CASH-DATA-FAIL'));
check('rejection-data-failure-is-separate', dataFail.ok === false && dataFail.recordState === '审计失败未闭环' && dataFail.mayReplay === false && dataFail.business.written === false && dataFail.audit.owner === 'operationLog' && dataFail.audit.attempted === true && dataFail.audit.saved === false && dataFail.audit.ambiguous === false && dataFailListed === false && (store.__persistCalls || 0) === callsBefore + 1 && String(dataFail.error).indexOf('成功') < 0, dataFail);
check('rejection-data-failure-does-not-write-followup-log', (store.logs || []).every((l) => String(l.notes || '').indexOf('被拒底稿未能落库') < 0), store.logs);

store.__failBusinessWrite = true;
const boom = call(engine, advisor.token, 'addCashItem', {
  yearMonth: '2026-02', date: '2026-02-02', desc: 'SYN_BOOM', direction: '收入', amount: 1, currency: 'HKD', clientRequestId: 'CASH-BOOM'
});
delete store.__failBusinessWrite;
const boomListed = !!(((store.months['2026-02'] || {}).cashItems || []).some((item) => item.clientRequestId === 'CASH-BOOM'));
check('business-exception-not-success', boom.ok === false && boom.code === 'BUSINESS_WRITE_FAILED' && boom.business.outcome === '未完成' && boom.business.written == null && boom.audit.attempted === false && boom.audit.saved === false && boomListed === false && String(boom.error).indexOf('成功') < 0 && String(boom.error).indexOf('审计日志已写入') < 0, boom);

const cashOk = call(engine, advisor.token, 'addCashItem', {
  yearMonth: '2026-04', date: '2026-04-02', desc: 'SYN_KEEP', direction: '收入', amount: 20, currency: 'HKD', clientRequestId: 'CASH-KEEP'
});
const cashKeepId = cashOk.data && cashOk.data.item && cashOk.data.item.id;
const cashSame = call(engine, advisor.token, 'addCashItem', {
  yearMonth: '2026-04', date: '2026-04-02', desc: 'SYN_KEEP', direction: '收入', amount: 20, currency: 'HKD', clientRequestId: 'CASH-KEEP'
});
const cashClash = call(engine, advisor.token, 'addCashItem', {
  yearMonth: '2026-04', date: '2026-04-03', desc: 'SYN_OTHER', direction: '支出', amount: 21, currency: 'HKD', clientRequestId: 'CASH-KEEP'
});
const cashKept = ((store.months['2026-04'] || {}).cashItems || []).filter((item) => item.clientRequestId === 'CASH-KEEP');
const cashSuccessLogs = (store.logs || []).filter((l) => l.action === '登记现金或第三方收支' && l.result === '成功' && String(l.notes).indexOf(cashKeepId) >= 0);
check('cash-same-request-same-payload-keeps-id', cashOk.ok && cashSame.ok && cashSame.data.idempotentReplay === true && cashSame.data.item.id === cashKeepId && cashKept.length === 1 && cashSuccessLogs.length === 1, { cashKeepId, same: cashSame.data && cashSame.data.item && cashSame.data.item.id, logs: cashSuccessLogs.length });
check('cash-same-request-different-payload-rejected', cashClash.ok === false && cashClash.code === 'PAYLOAD_MISMATCH' && cashKept.length === 1 && cashKept[0].id === cashKeepId && cashKept[0].amount === 20, cashClash);

const planClash = call(engine, advisor.token, 'savePlan', {
  yearMonth: '2026-11', type: '固定', title: 'SYN_PATCH_OTHER', clientRequestId: 'PL-PATCH-1'
});
const planLogs = (store.logs || []).filter((l) => l.action === '新增计划' && String(l.target).indexOf('PL-PATCH-1') >= 0);
check('plan-same-request-different-payload-rejected', planClash.ok === false && planClash.code === 'PAYLOAD_MISMATCH' && store.plans.length === 1 && store.plans[0].id === originalId && store.plans[0].title === 'SYN_PATCH_PLAN' && planLogs.length === 1 && planLogs[0].result === '拒绝', { planClash, planLogs, id: store.plans[0] && store.plans[0].id });

store.__failPersist = true;
const lost = call(engine, advisor.token, 'savePlan', {
  yearMonth: '2026-09', type: '固定', title: 'SYN_LOST_RETURN', planDate: '2026-09-01', owner: 'SYN', clientRequestId: 'PL-LOST'
});
delete store.__failPersist;
const lostSuccess = (store.logs || []).filter((l) => l.result === '成功' && String(l.notes).indexOf('SYN_LOST_RETURN') >= 0 || (l.action === '新增计划' && l.result === '成功' && String(l.target).indexOf('2026-09') >= 0));
check('persist-interrupt-does-not-log-success', lost.ok === false && lost.recordState === '无法证明是否收到' && lost.mayReplay === false && lostSuccess.length === 0, { lost, lostSuccess });

function fileSha(rel) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex');
}
const pairs = [
  ['admin/js/api.js', 'dist/ac01-pages/admin/js/api.js'],
  ['admin/js/app.js', 'dist/ac01-pages/admin/js/app.js'],
  ['admin/js/rules.js', 'dist/ac01-pages/admin/js/rules.js']
];
const sourceCode = fileSha('gas/release/Code.js');
const packedCode = fileSha('dist/ac01-gas/Code.js');
check('dist-gas-matches-release', sourceCode === packedCode, { sourceCode, packedCode });
const sums = JSON.parse(fs.readFileSync(path.join(root, 'dist/SHA256SUMS.json'), 'utf8'));
pairs.forEach(function (pair) {
  const same = fileSha(pair[0]) === fileSha(pair[1]);
  const row = sums.files.find(function (item) { return item.path === pair[1]; });
  check('dist-matches-' + pair[1], same && row && row.sha256 === fileSha(pair[1]), { same: same, listed: row && row.sha256 });
});
const sourceText = fs.readFileSync(path.join(root, 'admin/js/app.js'), 'utf8') + fs.readFileSync(path.join(root, 'admin/js/api.js'), 'utf8');
check('source-does-not-ask-resubmit', sourceText.indexOf('同一请求号重试') < 0 && sourceText.indexOf('再用同一请求号') < 0, true);

console.log(JSON.stringify({ passed: failures.length === 0, failed: failures.length, label: 'local-pure-and-memory', liveWrite: false }));
if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}
