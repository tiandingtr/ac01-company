/* Shared AC01 checks. Mirrors gas/release limits. No network. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FSRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var CASH_LINE_LIMIT = 2000;
  var CASH_MONTH_LIMIT = 20000;

  function canonYearMonth(v) {
    if (v == null || v === '') return '';
    if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
      var shifted = new Date(v.getTime() + 8 * 3600 * 1000);
      return shifted.toISOString().slice(0, 7);
    }
    var s = String(v).trim().replace(/^'+/, '').replace(/^YM:/, '');
    var m = s.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?(?:[T\s].*)?$/);
    if (!m) return '';
    var month = Number(m[2]);
    if (month < 1 || month > 12) return '';
    if (m[3]) {
      var day = Number(m[3]);
      if (day < 1 || day > 31) return '';
    }
    return m[1] + '-' + m[2];
  }

  function round2(n) {
    return Math.round(Number(n) * 100) / 100;
  }

  function checkCashAmount(amount) {
    var n = Number(amount);
    if (!Number.isFinite(n)) {
      return { ok: false, code: 'CASH_AMOUNT', message: '金额须为数字。' };
    }
    n = round2(n);
    if (!(n > 0)) {
      return {
        ok: false,
        code: 'CASH_AMOUNT',
        message: '金额须为正数。方向用「收入」或「支出」表示；不接受零或负数。'
      };
    }
    if (n > CASH_LINE_LIMIT) {
      return {
        ok: false,
        code: 'CASH_LIMIT',
        message: '单笔现金或第三方收支为 ' + n + ' 港元，超过 2,000 港元上限，不得按本条直接进入第一本明细账。'
      };
    }
    return { ok: true, amount: n };
  }

  function checkCashMonth(existingHkd, amountHkd) {
    var next = round2(Number(existingHkd) + Number(amountHkd));
    if (next > CASH_MONTH_LIMIT) {
      return {
        ok: false,
        code: 'CASH_LIMIT',
        message: '当月现金或第三方收支合计将达到 ' + next + ' 港元，超过 20,000 港元上限，不得按本条直接进入第一本明细账。'
      };
    }
    return { ok: true, total: next };
  }

  function formalPostDecision(state) {
    state = state || {};
    var reasons = [];
    if (state.openingConfirmed !== true) {
      reasons.push('期初余额尚未经独立确认，禁止写入正式四套账。');
    }
    if (!state.ledgerGenerated) reasons.push('尚未生成第一本明细账。');
    if (!state.bankBalanced) reasons.push('银行侧未配平，不能定稿。');
    if (!state.completionConfirmed) reasons.push('未经过完成页确认，不能定稿。');
    if (state.unfinished) reasons.push('仍有未处理明细，不能定稿。');
    return { allowed: reasons.length === 0, reasons: reasons };
  }

  /* Official preview never posts formal books. Prerequisites are ignored. */
  function previewFormalPostClosed() {
    return {
      allowed: false,
      code: 'PREVIEW_FORMAL_POST_CLOSED',
      reasons: ['正式预览禁止财务定稿。期初、配平、完成页和未处理项即使全部满足，也不会写入正式四套账。']
    };
  }

  function completionDecision(state) {
    state = state || {};
    var reasons = [];
    if (!state.ledgerGenerated) reasons.push('尚未生成第一本明细账，不能确认完成页。');
    if (!state.bankBalanced) reasons.push('银行侧未配平，不能确认完成页。');
    if (state.unfinished) reasons.push('仍有未处理明细，不能确认完成页。');
    return { allowed: reasons.length === 0, reasons: reasons };
  }

  function stringOrEmpty(value) {
    return typeof value === 'string' ? value : '';
  }

  var OFFICIAL_PREVIEW_BUILD = 'ac01-official-preview-20261119';
  var OFFICIAL_PREVIEW_MODE = 'official-preview';

  /* Strict identity gate. Accepts only the official-preview contract. Does not call the network. */
  function identityDecision(data, expected) {
    var reasons = [];
    expected = expected || {};
    if (expected.buildId !== OFFICIAL_PREVIEW_BUILD) reasons.push('page-build');
    if (expected.dataMode !== OFFICIAL_PREVIEW_MODE) reasons.push('page-dataMode');
    if (expected.productionData !== false) reasons.push('page-productionData');
    if (!data || typeof data !== 'object') {
      reasons.push('missing');
      return { ok: false, reasons: reasons };
    }
    if (data.buildId !== expected.buildId) reasons.push('buildId');
    if (data.dataMode !== expected.dataMode) reasons.push('dataMode');
    if (data.productionData !== false) reasons.push('productionData');
    if (data.dataMode === 'production') reasons.push('production-mode');
    if (data.productionData === true) reasons.push('production-data');
    var release = data.release;
    if (release && typeof release === 'object') {
      if (Object.prototype.hasOwnProperty.call(release, 'buildId') && release.buildId !== expected.buildId) reasons.push('release.buildId');
      if (Object.prototype.hasOwnProperty.call(release, 'dataMode') && release.dataMode !== expected.dataMode) reasons.push('release.dataMode');
      if (Object.prototype.hasOwnProperty.call(release, 'productionData') && release.productionData !== false) reasons.push('release.productionData');
      if (release.dataMode === 'production') reasons.push('release-production-mode');
      if (release.productionData === true) reasons.push('release-production-data');
    }
    return { ok: reasons.length === 0, reasons: reasons };
  }

  /* Formats the me.release object already returned at login. Does not invent ids. */
  function describeRelease(data) {
    var release = data && typeof data.release === 'object' && data.release ? data.release : null;
    var buildId = stringOrEmpty(release && release.buildId) || stringOrEmpty(data && data.buildId);
    var dataMode = stringOrEmpty(release && release.dataMode) || stringOrEmpty(data && data.dataMode);
    var head = '版本 ' + (buildId || '未返回') + ' · 环境 ' + (dataMode || '未返回');
    if (!release) {
      return {
        state: 'unavailable',
        spreadsheetId: '',
        driveRootId: '',
        buildId: buildId,
        dataMode: dataMode,
        text: head + '。隔离目标未从本次登录接口返回，页面不填入预置编号。'
      };
    }
    var sheet = stringOrEmpty(release.spreadsheetId);
    var drive = stringOrEmpty(release.driveRootId);
    if (release.mismatch === true || release.targetsMatch === false) {
      var echoed = '';
      if (sheet) echoed += ' 接口返回的表格 ' + sheet + '。';
      if (drive) echoed += ' 接口返回的凭证根 ' + drive + '。';
      return {
        state: 'mismatch',
        spreadsheetId: sheet,
        driveRootId: drive,
        buildId: buildId,
        dataMode: dataMode,
        text: head + '。接口标明隔离目标不一致。页面不另填编号。' + echoed
      };
    }
    if (!sheet || !drive) {
      return {
        state: 'unavailable',
        spreadsheetId: sheet,
        driveRootId: drive,
        buildId: buildId,
        dataMode: dataMode,
        text: head + '。接口未返回完整的有效表格或凭证根。页面不填入预置编号。'
      };
    }
    return {
      state: 'observed',
      spreadsheetId: sheet,
      driveRootId: drive,
      buildId: buildId,
      dataMode: dataMode,
      text: head + '。有效表格 ' + sheet + '。有效凭证根 ' + drive + '。来源：本次 me.release。'
    };
  }

  /* One already archived synthetic upload. No other request, file, or customer record. */
  var PREVIEW_REPLAY = {
    clientRequestId: 'FL-mwnbgmp4167scl',
    fileId: 'FL-MWNBGWP7K04U72',
    fileName: 'ac01-preview-attachment-20261119-03.pdf',
    size: 1528,
    sha256: '2ac03e15e1f14527606cffffac3d3309b1165d4be716468363153200bd9a7c25',
    category: '其他',
    relatedId: 'PL-MWN92TMG60CBO9'
  };

  function previewReplayGate(input) {
    input = input || {};
    var reasons = [];
    var identity = identityDecision(input.session, input.page);
    if (!identity.ok) reasons = reasons.concat(identity.reasons);
    if (input.role !== '顾问') reasons.push('role');
    var file = input.file;
    if (!file) reasons.push('file-missing');
    else {
      if (file.name !== PREVIEW_REPLAY.fileName) reasons.push('file-name');
      if (file.size !== PREVIEW_REPLAY.size) reasons.push('file-size');
      if (String(file.sha256 || '').toLowerCase() !== PREVIEW_REPLAY.sha256) reasons.push('file-hash');
    }
    var request = null;
    if (!reasons.length) {
      request = {
        category: PREVIEW_REPLAY.category,
        relatedId: PREVIEW_REPLAY.relatedId,
        clientRequestId: PREVIEW_REPLAY.clientRequestId
      };
    }
    return { ok: reasons.length === 0, reasons: reasons, request: request };
  }

  function previewReplayRefusal(reasons) {
    var known = {
      'file-missing': '没有选择文件。',
      'file-name': '文件名不是这条虚构资料。',
      'file-size': '文件大小不是 1528 字节。',
      'file-hash': '文件内容不是这条虚构资料。',
      role: '当前角色不能重放。'
    };
    var parts = [];
    var environment = false;
    (reasons || []).forEach(function (reason) {
      if (known[reason]) parts.push(known[reason]);
      else environment = true;
    });
    if (environment) parts.unshift('当前身份不是正式预览或不是非生产数据，已拒绝。');
    if (!parts.length) parts.push('已拒绝。');
    return '未向接口提交。' + parts.join('');
  }

  function previewReplayVerdict(out) {
    var file = out && out.file ? out.file : {};
    var reasons = [];
    if (!out || out.idempotentReplay !== true) reasons.push('idempotentReplay');
    if (file.id !== PREVIEW_REPLAY.fileId) reasons.push('fileId');
    if (file.clientRequestId && file.clientRequestId !== PREVIEW_REPLAY.clientRequestId) reasons.push('clientRequestId');
    if (file.name && file.name !== PREVIEW_REPLAY.fileName) reasons.push('name');
    if (file.category && file.category !== PREVIEW_REPLAY.category) reasons.push('category');
    if (file.relatedId && file.relatedId !== PREVIEW_REPLAY.relatedId) reasons.push('relatedId');
    return {
      ok: reasons.length === 0,
      reasons: reasons,
      fileId: file.id || '',
      idempotentReplay: out ? out.idempotentReplay : undefined
    };
  }

  function previewReplayText(verdict) {
    var flag = verdict && verdict.idempotentReplay === true
      ? 'true'
      : verdict && verdict.idempotentReplay === false
        ? 'false'
        : '未返回';
    var head = verdict && verdict.ok
      ? '幂等重放成立。'
      : '幂等重放未成立。已停止，没有再次提交。';
    return head + ' fileId ' + ((verdict && verdict.fileId) || '未返回') + '。idempotentReplay ' + flag + '。仅正式预览的一条虚构资料。';
  }

  return {
    CASH_LINE_LIMIT: CASH_LINE_LIMIT,
    CASH_MONTH_LIMIT: CASH_MONTH_LIMIT,
    canonYearMonth: canonYearMonth,
    checkCashAmount: checkCashAmount,
    checkCashMonth: checkCashMonth,
    formalPostDecision: formalPostDecision,
    previewFormalPostClosed: previewFormalPostClosed,
    completionDecision: completionDecision,
    identityDecision: identityDecision,
    describeRelease: describeRelease,
    PREVIEW_REPLAY: PREVIEW_REPLAY,
    previewReplayGate: previewReplayGate,
    previewReplayRefusal: previewReplayRefusal,
    previewReplayVerdict: previewReplayVerdict,
    previewReplayText: previewReplayText
  };
});
