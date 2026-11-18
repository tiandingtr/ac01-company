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
check('cash-month-001-log-is-reject', monthRejects.length === 1 && monthRejects[0].result === '拒绝' && monthRejects[0].action === '登记现金或第三方收支', monthRejects);

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

const matchedPlan = Rules.matchSavedWrite('plan', { plans: [{ id: originalId, clientRequestId: 'PL-PATCH-1', yearMonth: '2026-11' }] }, 'PL-PATCH-1');
const missedPlan = Rules.matchSavedWrite('plan', { plans: [{ id: 'PL-OTHER', clientRequestId: 'OTHER' }] }, 'PL-PATCH-1');
const matchedReject = Rules.matchSavedWrite('cash', { month: { cashItems: [], yearMonth: '2026-06' }, rejectedCash: [{ clientRequestId: 'CASH-MONTH-001', reason: 'over' }] }, 'CASH-MONTH-001');
check('ui-readback-finds-saved-plan', matchedPlan && matchedPlan.confirmedAfterTimeout === true && matchedPlan.plan.id === originalId && missedPlan == null, { matchedPlan, missedPlan });
check('ui-readback-does-not-treat-rejection-as-saved', matchedReject && matchedReject.rejected === true && !matchedReject.confirmedAfterTimeout, matchedReject);

console.log(JSON.stringify({ passed: failures.length === 0, failed: failures.length, label: 'local-pure-and-memory', liveWrite: false }));
if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}
