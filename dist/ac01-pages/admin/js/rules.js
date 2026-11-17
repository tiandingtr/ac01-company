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

  function completionDecision(state) {
    state = state || {};
    var reasons = [];
    if (!state.ledgerGenerated) reasons.push('尚未生成第一本明细账，不能确认完成页。');
    if (!state.bankBalanced) reasons.push('银行侧未配平，不能确认完成页。');
    if (state.unfinished) reasons.push('仍有未处理明细，不能确认完成页。');
    return { allowed: reasons.length === 0, reasons: reasons };
  }

  return {
    CASH_LINE_LIMIT: CASH_LINE_LIMIT,
    CASH_MONTH_LIMIT: CASH_MONTH_LIMIT,
    canonYearMonth: canonYearMonth,
    checkCashAmount: checkCashAmount,
    checkCashMonth: checkCashMonth,
    formalPostDecision: formalPostDecision,
    completionDecision: completionDecision
  };
});
