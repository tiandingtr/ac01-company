/* AC01 admin API client. Official data comes from the single interface, never from a pasted data.js.
 * If window.FS_API_BASE is set (see config.js), POST JSON as text/plain to that Apps Script Web App URL.
 * Otherwise keep today's same-origin POST /api for local 18787 preview.
 */
(function (global) {
  const FS = global.FS || (global.FS = {});
  const TOKEN_KEY = 'ac01_session_token';

  function apiBase() {
    const raw = global.FS_API_BASE != null ? global.FS_API_BASE : '';
    return String(raw).trim().replace(/\/+$/, '');
  }

  function adminBase() {
    const rawPath = location.pathname || '/';
    const trimmed = rawPath.replace(/\/index\.html$/, '').replace(/\/login\.html$/, '').replace(/\/+$/, '') || '';
    const m = trimmed.match(/^(.*\/admin)(?:\/(?:plans|proposals|documents|finance|contracts|logs))?$/);
    if (m) return m[1];
    if (trimmed.endsWith('/admin')) return trimmed;
    return '/admin';
  }

  function getToken() {
    try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }

  function setToken(token) {
    try {
      if (token) sessionStorage.setItem(TOKEN_KEY, token);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* private mode */ }
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const s = String(reader.result || '');
        const i = s.indexOf(',');
        resolve(i >= 0 ? s.slice(i + 1) : s);
      };
      reader.onerror = () => reject(new Error('无法读取要上传的文件。'));
      reader.readAsDataURL(file);
    });
  }

  function throwIfFailed(res, body) {
    if (!res.ok || !body || body.ok !== true) {
      const err = new Error((body && body.error) || ('请求失败（' + (res && res.status) + '）'));
      err.status = res.status;
      err.code = body && body.code;
      throw err;
    }
  }

  function rememberToken(action, data) {
    if (action === 'login' && data && data.token) setToken(data.token);
    if (action === 'logout') setToken('');
  }

  function splitMeta(payload) {
    const src = Object.assign({}, payload || {});
    const timeoutMs = Number(src.__timeoutMs) > 0 ? Number(src.__timeoutMs) : 20000;
    delete src.__timeoutMs;
    return { payload: src, timeoutMs: timeoutMs };
  }

  function timeoutError() {
    const err = new Error('请求超时，尚未确认是否已保存。请先核对列表，不要把超时当作失败再次提交。');
    err.code = 'TIMEOUT';
    err.retryable = false;
    return err;
  }

  async function fetchWithTimeout(url, options, timeoutMs) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeoutMs);
    try {
      const opts = Object.assign({}, options);
      if (ctrl) opts.signal = ctrl.signal;
      return await fetch(url, opts);
    } catch (e) {
      if (e && (e.name === 'AbortError' || /aborted/i.test(String(e.message || '')))) throw timeoutError();
      const err = new Error('网络请求失败，保存结果尚未确认。这不是写入失败，也不是写入成功。请不要再次提交。');
      err.code = 'NETWORK';
      err.retryable = true;
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function readBody(res) {
    let parsed = null;
    try { parsed = await res.json(); } catch (e) { parsed = null; }
    if (!parsed || typeof parsed !== 'object') {
      const err = new Error('接口没有返回可识别的结果（' + (res && res.status) + '）。保存结果尚未确认。这不是写入失败，也不是写入成功。请不要再次提交。');
      err.code = 'BAD_RESPONSE';
      err.status = res && res.status;
      err.retryable = true;
      throw err;
    }
    return parsed;
  }

  async function apiRemote(base, action, payload, file) {
    const meta = splitMeta(payload);
    const body = { action: action, payload: meta.payload, token: getToken() };
    if (file && file.size) {
      body.payload.file = {
        name: file.name || 'file',
        mime: file.type || 'application/octet-stream',
        data: await fileToBase64(file),
      };
    }
    const res = await fetchWithTimeout(base, {
      method: 'POST',
      redirect: 'follow',
      credentials: 'omit',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
    }, meta.timeoutMs);
    const parsed = await readBody(res);
    throwIfFailed(res, parsed);
    rememberToken(action, parsed.data);
    return parsed.data;
  }

  async function apiLocal(action, payload, file) {
    const meta = splitMeta(payload);
    let res;
    if (file && file.size) {
      const fd = new FormData();
      fd.append('action', action);
      fd.append('payload', JSON.stringify(meta.payload));
      fd.append('token', getToken());
      fd.append('file', file);
      res = await fetchWithTimeout('/api', { method: 'POST', body: fd, credentials: 'same-origin' }, meta.timeoutMs);
    } else {
      res = await fetchWithTimeout('/api', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action, payload: meta.payload, token: getToken() }),
      }, meta.timeoutMs);
    }
    const body = await readBody(res);
    throwIfFailed(res, body);
    rememberToken(action, body.data);
    return body.data;
  }

  async function api(action, payload, file) {
    const base = apiBase();
    if (base) return apiRemote(base, action, payload, file);
    return apiLocal(action, payload, file);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fileHref(id, filesOrRecord) {
    const rec = (filesOrRecord && !Array.isArray(filesOrRecord))
      ? filesOrRecord
      : ((Array.isArray(filesOrRecord) ? filesOrRecord.find(function (f) { return f && f.id === id; }) : null) || {});
    if (rec.driveLink) return rec.driveLink;
    if (rec.fileUrl) return rec.fileUrl;
    if (apiBase()) return '';
    if (id) return '/api/files/' + encodeURIComponent(id);
    return '';
  }

  function fileLink(id, filesOrRecord, label) {
    const href = fileHref(id, filesOrRecord);
    const text = label || id || '查阅';
    if (!href) return escapeHtml(id || '—');
    return '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener">' + escapeHtml(text) + '</a>';
  }

  function badge(status) {
    const s = String(status || '');
    let cls = 'muted';
    if (/已完成|已附原件|免原件|已配平|启用|状态一|已归档|执行中/.test(s)) cls = 'ok';
    if (/未完成|待收|待核验|未处理|暂停/.test(s)) cls = 'warn';
    if (/逾期|暂记|拒绝|未配平|解除/.test(s)) cls = 'danger';
    if (/草稿|灵活|固定/.test(s)) cls = 'info';
    return '<span class="badge ' + cls + '">' + escapeHtml(s || '—') + '</span>';
  }

  FS.api = api;
  FS.apiBase = apiBase;
  FS.adminBase = adminBase;
  FS.fileHref = fileHref;
  FS.fileLink = fileLink;
  FS.escapeHtml = escapeHtml;
  FS.badge = badge;
})(window);
