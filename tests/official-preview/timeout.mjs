/**
 * Offline checks for official-preview timeout copy and upload read-back.
 * No network. Does not call the live exec and does not upload a file.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FORBIDDEN = '尚未确认是否已保存';
const FORBIDDEN_RETRY = [
  '请使用同一请求号重试',
  '可使用同一请求号重试',
  '请稍后用同一请求号重试'
];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function hangFetch() {
  return function (url, options) {
    return new Promise(function (resolve, reject) {
      const signal = options && options.signal;
      const abort = function () {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      };
      if (signal) {
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      }
    });
  };
}

function loadApi(fetchImpl) {
  const store = new Map();
  const sandbox = {
    AbortController: AbortController,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    fetch: fetchImpl,
    location: { pathname: '/admin/index.html' },
    sessionStorage: {
      getItem: function (key) { return store.has(key) ? store.get(key) : ''; },
      setItem: function (key, value) { store.set(key, String(value)); },
      removeItem: function (key) { store.delete(key); }
    },
    FileReader: function FileReader() {}
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('admin/js/api.js'), sandbox, { filename: 'admin/js/api.js' });
  sandbox.FS_API_BASE = 'https://script.google.com/macros/s/test/exec';
  return sandbox.FS;
}

async function expectFail(action, fetchImpl, timeoutMs) {
  const api = loadApi(fetchImpl);
  const payload = { __timeoutMs: timeoutMs == null ? 40 : timeoutMs };
  try {
    await api.api(action, payload);
  } catch (err) {
    return err;
  }
  throw new Error(action + ' should have failed');
}

function assertNoSaveExcuse(err) {
  assert.equal(String(err.message).includes(FORBIDDEN), false, err.message);
  FORBIDDEN_RETRY.forEach(function (phrase) {
    assert.equal(String(err.message).includes(phrase), false, err.message);
  });
  assert.equal(err.retryable, false);
}

const listTimeout = await expectFail('getDocuments', hangFetch());
assert.equal(listTimeout.code, 'TIMEOUT');
assert.equal(listTimeout.intent, 'read');
assert.match(listTimeout.message, /读取超时，列表没有载入/);
assertNoSaveExcuse(listTimeout);

const meTimeout = await expectFail('me', hangFetch());
assert.equal(meTimeout.intent, 'read');
assert.match(meTimeout.message, /读取超时，这次没有拿到数据/);
assert.equal(meTimeout.message.includes('列表没有载入'), false);
assertNoSaveExcuse(meTimeout);

const uploadTimeout = await expectFail('uploadDocument', hangFetch());
assert.equal(uploadTimeout.code, 'TIMEOUT');
assert.equal(uploadTimeout.intent, 'write');
assert.match(uploadTimeout.message, /不要立刻再次提交/);
assertNoSaveExcuse(uploadTimeout);

const listNetwork = await expectFail('getDocuments', async function () { throw new Error('socket hang up'); });
assert.equal(listNetwork.code, 'NETWORK');
assert.equal(listNetwork.intent, 'read');
assert.match(listNetwork.message, /网络中断，列表没有载入/);
assertNoSaveExcuse(listNetwork);

const uploadNetwork = await expectFail('savePlan', async function () { throw new Error('socket hang up'); });
assert.equal(uploadNetwork.intent, 'write');
assertNoSaveExcuse(uploadNetwork);

const badList = await expectFail('getPlans', async function () {
  return { ok: true, status: 502, json: async function () { return null; } };
});
assert.equal(badList.code, 'BAD_RESPONSE');
assert.equal(badList.intent, 'read');
assert.equal(badList.status, 502);
assert.match(badList.message, /读取结果（502）/);
assertNoSaveExcuse(badList);

const loginTimeout = await expectFail('login', hangFetch());
assert.equal(loginTimeout.intent, 'login');
assert.match(loginTimeout.message, /尚未登录/);
assertNoSaveExcuse(loginTimeout);

const api = loadApi(hangFetch());
const hint = {
  clientRequestId: 'FL-req-1',
  name: 'note.txt',
  category: '其他',
  relatedId: '',
  size: 12,
  uploadedBy: 'AC01-TEST',
  date: '2026-11-19'
};
const prior = {
  id: 'FL-OLD',
  name: 'note.txt',
  category: '其他',
  relatedId: '',
  size: 12,
  uploadedBy: 'AC01-TEST',
  date: '2026-11-19'
};
const saved = {
  id: 'FL-MWN982MJ0XXQC9',
  name: 'note.txt',
  category: '其他',
  relatedId: '',
  size: 12,
  uploadedBy: 'AC01-TEST',
  date: '2026-11-19'
};

const byRequest = api.reconcileUploadedFile([
  prior,
  Object.assign({ clientRequestId: 'FL-req-1' }, saved)
], hint, [prior.id]);
assert.equal(byRequest.status, 'found');
assert.equal(byRequest.file.id, saved.id);

const byNewRow = api.reconcileUploadedFile([prior, saved], hint, [prior.id]);
assert.equal(byNewRow.status, 'found');
assert.equal(byNewRow.file.id, saved.id);

const notSaved = api.reconcileUploadedFile([prior], hint, [prior.id]);
assert.equal(notSaved.status, 'missing');
assert.equal(notSaved.file, null);

const ambiguous = api.reconcileUploadedFile([
  prior,
  Object.assign({}, saved, { id: 'FL-A' }),
  Object.assign({}, saved, { id: 'FL-B' })
], hint, [prior.id]);
assert.equal(ambiguous.status, 'ambiguous');

const differentSize = api.reconcileUploadedFile([
  Object.assign({}, saved, { size: 99 })
], hint, []);
assert.equal(differentSize.status, 'missing');

const noSnapshot = api.reconcileUploadedFile([saved], Object.assign({}, hint, { clientRequestId: '' }), null);
assert.equal(noSnapshot.status, 'found');
assert.equal(noSnapshot.file.id, saved.id);

assert.equal(api.isReadAction('getDocuments'), true);
assert.equal(api.isReadAction('uploadDocument'), false);

const app = read('admin/js/app.js');
const client = read('admin/js/api.js');
[app, client, read('admin/index.html'), read('admin/login.html')].forEach(function (text) {
  assert.equal(text.includes(FORBIDDEN), false);
  FORBIDDEN_RETRY.forEach(function (phrase) {
    assert.equal(text.includes(phrase), false, phrase);
  });
});
assert.ok(app.includes('function clearStaleDanger'));
assert.ok(app.includes('clearStaleDanger();'));
assert.ok(app.includes('FS.reconcileUploadedFile'));
assert.ok(app.includes('confirmUploadedFile(hint, knownIds)'));
assert.ok(app.includes('因此本次可能尚未保存'));
assert.ok(app.includes('回读台账已确认，请不要再次上传。'));
assert.ok(app.includes("btn.dataset.hold = '1'"));
assert.equal(/api\(\s*['"]postFourStatements['"]/.test(app), false);
assert.equal(/api\(\s*['"]generateOfficialContract['"]/.test(app), false);
assert.ok(app.includes('previewFormalPostClosed(undefined, identityProfile)'));
assert.equal(client.includes('retryable = true'), false);
assert.ok(read('admin/js/config.js').includes('AKfycbykvdLhq8RlBZUJ0ZSMF89Znpu5uwz7NvwwtlfDmAWsSyFq5bkvOI3DmeRvi7GqbRuC'));
assert.ok(read('admin/js/build.js').includes("buildId: 'ac01-official-preview-20261119'"));
assert.ok(read('admin/js/build.js').includes("dataMode: 'official-preview'"));
assert.ok(read('admin/js/build.js').includes('productionData: false'));
assert.ok(read('gas/release/Code.js').includes("var BUILD_ID = 'ac01-sim-test-20261118'"));
assert.equal(read('gas/release/Code.js').includes('ac01-official-preview'), false);

console.log(JSON.stringify({
  ok: true,
  listTimeout: listTimeout.message,
  uploadTimeout: uploadTimeout.message,
  reconciledId: byNewRow.file.id,
  missing: notSaved.status
}, null, 2));
