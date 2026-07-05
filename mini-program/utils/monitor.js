/**
 * 小程序前端错误监控上报
 * - App.onError / wx.onError / request_fail / unhandled_rejection 统一入口
 * - 永远不要 throw：上报失败绝不能再炸业务
 * - 走 wx.request 不走自家 utils/request（避免循环）
 */
const BASE = 'https://fa1b04c679fe9e41-43-139-176-199.serveousercontent.com';

function reportClientError(type, err, extra = {}) {
  try {
    const message = (err && (err.message || err.errMsg)) || String(err);
    const stack = (err && err.stack) || '';
    const platform = (wx.getSystemInfoSync && wx.getSystemInfoSync().platform) || '';
    let version = '';
    try {
      const info = (wx.getAccountInfoSync && wx.getAccountInfoSync()) || {};
      version = (info.miniProgram && info.miniProgram.version) || '';
    } catch (_e) { /* ignore */ }
    let openid = null;
    try { openid = wx.getStorageSync('openid') || null; } catch (_e) { /* ignore */ }
    wx.request({
      url: BASE + '/api/internal/client-errors',
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: { openid, version, platform, errorType: type, message, stack, metadata: extra },
      fail: () => { /* never throw */ },
    });
  } catch (_e) {
    // swallow — error reporter must never throw
  }
}

module.exports = { reportClientError };