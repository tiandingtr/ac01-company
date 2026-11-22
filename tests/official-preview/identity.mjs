/**
 * Offline contract check for the official-preview admin page.
 * No network. Does not log in, and does not call the live exec.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BUILD = 'ac01-official-preview-20261119';
const MODE = 'official-preview';
const NEW_EXEC = 'https://script.google.com/macros/s/AKfycbykvdLhq8RlBZUJ0ZSMF89Znpu5uwz7NvwwtlfDmAWsSyFq5bkvOI3DmeRvi7GqbRuC/exec';
const OLD_EXEC = 'https://script.google.com/macros/s/AKfycbxInAhNPwDBpIRBc4u82DZvFnc0XidYya_Eo_7TRHiIrrweslj3Od4LmTFzMGIz58PQ/exec';
const OLD_BUILD = 'ac01-sim-test-20261118';
const CACHE = '?v=ac01-official-20261120-compat6';
const LOGIN_CACHE = '?v=ac01-official-20261120-compat6';
const OFFICIAL_BUILD = 'ac01-official-20261120';
const OFFICIAL_MODE = 'official';

const rules = require(path.join(root, 'admin/js/rules.js'));
const expected = loadBuild();

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function loadBuild() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(read('admin/js/build.js'), sandbox);
  return sandbox.window.AC01_BUILD;
}

function matchPayload(extra) {
  const data = {
    user: { displayName: '本地核对', role: '顾问', jobId: 'LOCAL-MOCK' },
    asOf: '2026-11-19',
    openingConfirmed: false,
    preview: true,
    officialContractOpen: false,
    buildId: BUILD,
    dataMode: MODE,
    productionData: false,
    release: {
      buildId: BUILD,
      dataMode: MODE,
      productionData: false,
      spreadsheetId: 'LOCAL-MOCK-SHEET',
      driveRootId: 'LOCAL-MOCK-DRIVE'
    }
  };
  return Object.assign(data, extra || {});
}

function decision(data, page) {
  return rules.identityDecision(data, page || expected);
}

function assertReject(name, data, page, reason) {
  const out = decision(data, page);
  assert.equal(out.ok, false, name + ' should reject, got ' + JSON.stringify(out));
  if (reason) assert.ok(out.reasons.includes(reason), name + ' reasons ' + out.reasons.join(','));
}

const matched = decision(matchPayload());
assert.equal(matched.ok, true, JSON.stringify(matched));
assert.deepEqual(matched.reasons, []);
assert.equal(matched.profile, 'preview');

function officialPayload(extra) {
  return matchPayload(Object.assign({
    buildId: OFFICIAL_BUILD,
    dataMode: OFFICIAL_MODE,
    productionData: true,
    release: {
      buildId: OFFICIAL_BUILD,
      dataMode: OFFICIAL_MODE,
      productionData: true,
      spreadsheetId: 'LOCAL-MOCK-SHEET',
      driveRootId: 'LOCAL-MOCK-DRIVE'
    }
  }, extra || {}));
}
const official = decision(officialPayload());
assert.equal(official.ok, true, JSON.stringify(official));
assert.equal(official.profile, 'official');
assert.equal(decision(officialPayload(), {
  buildId: OFFICIAL_BUILD,
  dataMode: OFFICIAL_MODE,
  productionData: true
}).ok, true);

const mixes = [
  ['preview build, official mode, preview flag', BUILD, OFFICIAL_MODE, false, 'dataMode'],
  ['preview build, preview mode, official flag', BUILD, MODE, true, 'productionData'],
  ['official build, preview mode, official flag', OFFICIAL_BUILD, MODE, true, 'dataMode'],
  ['official build, official mode, preview flag', OFFICIAL_BUILD, OFFICIAL_MODE, false, 'productionData']
];
for (const mix of mixes) {
  const body = matchPayload({
    buildId: mix[1],
    dataMode: mix[2],
    productionData: mix[3],
    release: { buildId: mix[1], dataMode: mix[2], productionData: mix[3] }
  });
  assertReject(mix[0], body, null, mix[4]);
}
assertReject('top preview release official', matchPayload({
  release: { buildId: OFFICIAL_BUILD, dataMode: OFFICIAL_MODE, productionData: true }
}), null, 'release.buildId');
assertReject('top official release preview', officialPayload({
  release: { buildId: BUILD, dataMode: MODE, productionData: false }
}), null, 'release.buildId');

const withoutRelease = matchPayload();
delete withoutRelease.release;
assertReject('missing release object', withoutRelease, null, 'release-missing');
assert.equal(decision(withoutRelease).reasons.includes('release.buildId-missing'), false);

const releaseIdsOnly = matchPayload();
releaseIdsOnly.release = { spreadsheetId: 'LOCAL-MOCK-SHEET', driveRootId: 'LOCAL-MOCK-DRIVE' };
const idsOnly = decision(releaseIdsOnly);
assert.equal(idsOnly.ok, false, 'release spreadsheet ids alone must not pass');
for (const reason of ['release.buildId-missing', 'release.dataMode-missing', 'release.productionData-missing']) {
  assert.ok(idsOnly.reasons.includes(reason), reason + ' in ' + idsOnly.reasons.join(','));
}
assert.equal(idsOnly.reasons.includes('release.buildId'), false);

assertReject('retired simulated-test', matchPayload({
  buildId: OLD_BUILD,
  dataMode: 'simulated-test',
  release: { buildId: OLD_BUILD, dataMode: 'simulated-test', productionData: false }
}), null, 'buildId');

assertReject('wrong build', matchPayload({ buildId: 'ac01-official-preview-20261118' }), null, 'buildId');
assertReject('production mode', matchPayload({
  dataMode: 'production',
  release: { buildId: BUILD, dataMode: 'production', productionData: false }
}), null, 'production-mode');
assertReject('production data', matchPayload({
  productionData: true,
  release: { buildId: BUILD, dataMode: MODE, productionData: true }
}), null, 'production-data');
assertReject('string false', matchPayload({ productionData: 'false' }), null, 'productionData');
assertReject('missing production flag', matchPayload({ productionData: null }), null, 'productionData');
assert.equal(decision(matchPayload({ productionData: null })).reasons.includes('productionData-missing'), false);
assert.equal(decision(matchPayload({ buildId: '' })).reasons.includes('buildId-missing'), false);
assert.ok(decision(matchPayload({ buildId: '' })).reasons.includes('buildId'));
assertReject('missing payload', null, null, 'missing');
assertReject('split release build', matchPayload({
  release: { buildId: OLD_BUILD, dataMode: MODE, productionData: false }
}), null, 'release.buildId');
assertReject('page still on simulated-test', matchPayload(), {
  buildId: OLD_BUILD,
  dataMode: 'simulated-test',
  productionData: false
}, 'page-build');
assertReject('page expects production', matchPayload(), {
  buildId: BUILD,
  dataMode: MODE,
  productionData: true
}, 'page-productionData');

assert.deepEqual(JSON.parse(JSON.stringify(expected)), { buildId: BUILD, dataMode: MODE, productionData: false });
assert.equal(CACHE, '?v=ac01-official-20261120-compat6');
assert.equal(LOGIN_CACHE, CACHE);
assert.ok(read('admin/js/build.js').includes(OFFICIAL_BUILD));
assert.ok(read('admin/js/build.js').includes("productionData: true"));
assert.ok(read('admin/js/app.js').includes("decision.profile === 'official'"));
assert.ok(read('admin/js/app.js').includes('已与接口核对身份'));
assert.equal(read('admin/index.html').includes(BUILD), false);
assert.ok(read('admin/index.html').includes('登录后与接口核对。'));
assert.equal(read('admin/index.html').includes('?v=' + BUILD + '"'), false);

const config = read('admin/js/config.js');
assert.equal(config.split(NEW_EXEC).length - 1, 1);
assert.equal(config.includes(OLD_EXEC), false);
assert.equal(config.includes('script.google.com'), true);

const adminFiles = [];
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (fs.statSync(abs).isDirectory()) walk(abs);
    else adminFiles.push(abs);
  }
}
walk(path.join(root, 'admin'));
const execHits = [];
for (const abs of adminFiles) {
  const text = fs.readFileSync(abs, 'utf8');
  if (text.includes(OLD_EXEC) || text.includes(OLD_BUILD) || text.includes('simulated-test')) {
    execHits.push(path.relative(root, abs));
  }
  const urls = text.match(/https:\/\/script\.google\.com\/macros\/s\/[^'"\s]+/g) || [];
  for (const url of urls) {
    if (url !== NEW_EXEC) execHits.push(path.relative(root, abs) + ' -> ' + url);
  }
}
assert.deepEqual(execHits, [], 'admin frontend must point only at the new exec and the new identity');

const indexHtml = read('admin/index.html');
assert.ok(indexHtml.includes('正在确认身份…'));
assert.equal(indexHtml.includes('正式预览'), false);
assert.equal(indexHtml.includes('ac01-official-preview-20261119'), false);
const loginHtml = read('admin/login.html');
assert.equal(loginHtml.includes('正在确认身份…'), false);
assert.equal(loginHtml.includes('正式预览'), false);
assert.ok(loginHtml.includes('管理后台登录。授权人与顾问共用同一入口。鉴权失败即拒绝；授权表缺失或为空时不会放行。'));
assert.ok(loginHtml.includes('请使用分配的账号登录。授权失败即拒绝，不会放宽鉴权。'));
assert.ok(loginHtml.includes('请使用分配的账号登录。请勿在页面或聊天中保存口令。'));
for (const rel of ['admin/index.html']) {
  const html = read(rel);
  const refs = [...html.matchAll(/\b(?:src|href)="([^"]+\.(?:js|css)[^"]*)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 0, rel + ' should reference assets');
  for (const ref of refs) {
    assert.ok(ref.endsWith(CACHE), rel + ' asset is not cache-busted: ' + ref);
    assert.equal(ref.includes(OLD_BUILD), false, ref);
  }
}
for (const ref of [...loginHtml.matchAll(/\b(?:src|href)="([^"]+\.(?:js|css)[^"]*)"/g)].map((m) => m[1])) {
  assert.ok(ref.endsWith(LOGIN_CACHE), 'login asset cache must stay: ' + ref);
}

const app = read('admin/js/app.js');
assert.ok(app.includes('Rules.identityDecision(data, window.AC01_BUILD || {})'));
assert.ok(app.includes('if (!decision.ok)'));
assert.ok(app.includes("releaseState !== 'accepted'"));
assert.equal(app.includes('if (!releaseAccepted)'), false);
assert.equal(app.includes('simulated-test'), false);
assert.equal(app.includes(OLD_BUILD), false);
assert.ok(app.includes('正式合同文本生成已关闭'));
assert.ok(app.includes('模拟/草稿 非正式凭证'));
assert.equal(/api\(\s*['"]postFourStatements['"]/.test(app), false);
assert.equal(/api\(\s*['"]generateOfficialContract['"]/.test(app), false);
assert.ok(app.includes('previewFormalPostClosed(undefined, identityProfile)'));
assert.ok(app.includes('本版本未开放财务定稿。'));
assert.ok(app.includes('确认后仍不能定稿，本版本不写入正式四套账。'));
assert.ok(app.includes('本版本未开放财务定稿。'));
assert.ok(app.includes('确认后仍不能定稿，本版本不写入正式四套账。'));
assert.ok(read('admin/js/rules.js').includes('本版本未开放财务定稿。期初、配平、完成页和未处理项即使全部满足，也不会写入正式四套账。'));
assert.ok(app.includes('id="post-four" type="button" disabled aria-disabled="true"'));
assert.equal(app.includes('此按钮会请求接口写入正式四套账'), false);
assert.equal(app.includes('接口已接受正式定稿'), false);
const readyBooks = {
  openingConfirmed: true,
  ledgerGenerated: true,
  bankBalanced: true,
  completionConfirmed: true,
  unfinished: 0
};
assert.equal(rules.formalPostDecision(readyBooks).allowed, true, 'book prerequisites alone would open the old gate');
const closed = rules.previewFormalPostClosed(readyBooks);
assert.equal(closed.allowed, false);
assert.equal(closed.code, 'PREVIEW_FORMAL_POST_CLOSED');
assert.ok(closed.reasons[0].includes('正式预览禁止财务定稿'));
assert.equal(rules.previewFormalPostClosed().reasons[0].includes('正式预览'), true);
const officialClosed = rules.previewFormalPostClosed(readyBooks, 'official');
assert.equal(officialClosed.allowed, false);
assert.equal(officialClosed.reasons[0].includes('正式预览'), false);
assert.ok(officialClosed.reasons[0].includes('本版本未开放财务定稿'));
assert.equal(rules.previewFormalPostClosed().allowed, false);
assert.equal(rules.monthPlanEmptyText('official', []), '本月尚未登记正式计划（测试数据不计入）');
assert.equal(rules.monthPlanEmptyText('official', [{ title: '测试开户', notes: '虚构' }]), '');
assert.equal(rules.monthPlanEmptyText('official', [{ title: '客户拜访', notes: '' }]), '');
assert.equal(rules.monthPlanEmptyText('preview', []), '本月尚未登记计划。');
assert.equal(rules.monthPlanEmptyText('preview', [{ title: '测试开户' }]), '');
assert.equal(rules.monthPlanEmptyText('', []), '本月尚未登记计划。');
assert.equal(rules.monthPlanEmptyText(undefined, []), '本月尚未登记计划。');
assert.equal(app.includes("const RELEASE_REJECTED = '已拒绝：接口身份与本页不一致。'"), true);
assert.equal(app.includes('正式预览契约不一致'), false);
function renderedRejection(name, data, page) {
  const out = decision(data, page);
  assert.equal(out.ok, false, name);
  const text = '已拒绝：接口身份与本页不一致。 原因：' + out.reasons.join('、');
  assert.equal(text.includes('正式预览'), false, name + ' ' + text);
}
renderedRejection('rejected preview mismatch', matchPayload({ buildId: 'ac01-official-preview-20261118' }));
renderedRejection('rejected official mismatch', officialPayload({ buildId: 'ac01-official-20261119' }));
const rejectedMarker = app.slice(app.indexOf('if (!decision || !decision.ok)'), app.indexOf("decision.profile === 'preview'"));
assert.ok(rejectedMarker.includes('已拒绝'));
assert.equal(rejectedMarker.includes('非生产数据'), false);
assert.ok(app.includes("marker.textContent = '已与接口核对身份'"));
assert.ok(app.includes("identityProfile === 'official' ? '' : ''"));
assert.ok(app.includes("identityProfile === 'official' && (!accountName || !accountId)"));
assert.ok(app.includes("identityProfile === 'official' ? '对方名称' : '对方名称'"));
assert.equal(read('admin/js/rules.js').includes('isTestPlan_'), false);
assert.ok(app.includes('function applyRejectedChrome'));
assert.ok(app.includes('applyRejectedChrome()'));
assert.equal(app.slice(app.indexOf('function applyRejectedChrome'), app.indexOf('function applyOfficialChrome')).includes('正在确认身份…'), false);
assert.ok(read('admin/js/app.js').includes('本月尚未登记计划。'));
assert.ok(read('admin/js/app.js').includes('monthPlanEmptyText'));
assert.ok(read('admin/js/rules.js').includes('本月尚未登记正式计划（测试数据不计入）'));
const boot = app.slice(app.indexOf('async function boot'), app.indexOf('document.getElementById(\'logout\')'));
const rejectAt = boot.indexOf('if (!decision.ok)');
const renderAt = boot.indexOf('await render()');
assert.ok(rejectAt > 0 && renderAt > rejectAt, 'a rejected identity must return before the first business render');

const revision = JSON.parse(read('gas/release/REVISION.json'));
assert.equal(revision.buildId, OLD_BUILD);
assert.equal(revision.dataMode, 'simulated-test');
assert.ok(read('gas/release/Code.js').includes("var BUILD_ID = 'ac01-sim-test-20261118'"));
assert.ok(read('dist/ac01-pages/admin/js/config.js').includes(OLD_EXEC));
assert.equal(JSON.parse(read('dist/ac01-gas/CONTRACT.json')).buildId, OLD_BUILD);
assert.equal(JSON.parse(read('tests/synthetic/results/summary.json')).buildId, OLD_BUILD);

console.log(JSON.stringify({
  ok: true,
  buildId: expected.buildId,
  dataMode: expected.dataMode,
  productionData: expected.productionData,
  exec: NEW_EXEC,
  matched: matched.reasons,
  formalPostClosed: closed.code,
  historicalReleaseUntouched: revision.buildId
}, null, 2));
