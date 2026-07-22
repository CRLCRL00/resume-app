// 工具栏 → 详情 → 本地设置 → 勾「不校验合法域名」才能访问 src/config.js#apiBaseUrl
// 真机预览时 wx.login 自动跑，模拟器 timeout 所以跳过
// 注意：sentry 必须 require 在最前面，且早于 App()，SDK 才能 wrap onLaunch
require('./utils/sentry');
const { reportClientError } = require('./utils/monitor');
const { apiBaseUrl } = require('./src/config');

App({
  globalData: {
    userInfo: null,
    privacyAccepted: false,
  },

  onError(err) {
    // App 生命周期里捕获的脚本错误 — 上报到后端 client_errors
    reportClientError('app_onerror', err);
  },

  onShow() {
    // R93: 每次切前台重跑 admin check (token 可能新签, isAdmin 可能变)
    const token = wx.getStorageSync('token');
    if (token) {
      this.checkAdmin();
    }
  },

  onLaunch() {
    const accepted = wx.getStorageSync('privacy_accepted');
    this.globalData.privacyAccepted = !!accepted;

    // 全局 wx.onError（promise reject 之外的脚本异常）
    if (typeof wx.onError === 'function') {
      wx.onError((err) => {
        reportClientError('wx_onerror', err);
      });
    }
    // 全局未处理 Promise 拒绝
    if (typeof wx.onUnhandledRejection === 'function') {
      wx.onUnhandledRejection((res) => {
        reportClientError('unhandled_rejection', (res && res.reason) || res);
      });
    }

    // 隐私版本检查 — 后端版本 newer → 清旧 accept + 设 reaccept flag
    this.checkPrivacyVersion(accepted);

    // 延迟 500ms 让首页先加载
    setTimeout(() => {
      const need = !accepted || !!wx.getStorageSync('privacy_need_reaccept');
      if (need) {
        const pages = getCurrentPages();
        if (pages.length > 0) {
          const cur = pages[pages.length - 1];
          const popup = cur.selectComponent('#privacy-popup');
          if (popup) popup.show();
        }
      }
    }, 500);

    const token = wx.getStorageSync('token');
    if (token) {
      this.checkAdmin();
      return;
    }

    if (typeof wx.getDeviceInfo === 'function') {
      const info = wx.getDeviceInfo();
      if (info.platform === 'devtools') return;
    }

    this.login();

    // 检查小程序版本 — 新版本强制重启
    if (wx.getUpdateManager) {
      const updateManager = wx.getUpdateManager();
      updateManager.onCheckForUpdate((res) => {
        // 后端 res.hasUpdate → 触发 onUpdateReady
      });
      updateManager.onUpdateReady(() => {
        wx.showModal({
          title: '更新提示',
          content: '新版本已准备好，是否重启应用？',
          success: (r) => {
            if (r.confirm) updateManager.applyUpdate();
          },
        });
      });
      updateManager.onUpdateFailed(() => {
        // 静默
      });
    }
  },

  login() {
    wx.login({
      success: ({ code }) => {
        wx.request({
          url: `${apiBaseUrl}/api/auth/login`,
          method: 'POST',
          data: { code },
          success: (res) => {
            if (res.data?.code === 0) {
              this._saveAuth(res.data.data);
              this.checkAdmin();
            }
          },
          fail: () => {
            // 网络错（IDE 沙箱常见），不弹 toast
          },
        });
      },
      fail: () => {
        // IDE 模拟器 wx.login fail 通常因 sandbox
      },
    });
  },

  // 调试用：模拟器控制台敲 setToken('xxx') 手动塞 token
  // R50: 加 devQuickLogin() 在 IDE console 一行 dev-bypass 拿 token
  //   getApp().devQuickLogin('dev-admin')   →  自动 POST /api/auth/login + 存 token
  setToken(token, user) {
    wx.setStorageSync('token', token);
    if (user) wx.setStorageSync('user', user);
  },

  /**
   * R111: 统一存 access + refresh token 到 storage
   * 后端 /api/auth/login 响应 {token, refreshToken, csrfToken, user}
   */
  _saveAuth(data) {
    if (!data) return;
    if (data.token) wx.setStorageSync('token', data.token);
    if (data.refreshToken) wx.setStorageSync('refreshToken', data.refreshToken);
    if (data.user) wx.setStorageSync('user', data.user);
  },

  /**
   * R111: 用 refreshToken 换新 accessToken (用于 401 自动 refresh + onShow 临期检查)
   * 后端 /api/auth/refresh 返 {code:0, data:{access_token, refresh_token, expires_in}}
   * 失败清 storage 让上层重新登录
   */
  refreshAccessToken() {
    return new Promise((resolve) => {
      const refreshToken = wx.getStorageSync('refreshToken');
      if (!refreshToken) {
        resolve({ ok: false, reason: 'no refresh_token' });
        return;
      }
      wx.request({
        url: `${apiBaseUrl}/api/auth/refresh`,
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: { refresh_token: refreshToken },
        success: (res) => {
          if (res.data && res.data.code === 0) {
            const d = res.data.data;
            wx.setStorageSync('token', d.access_token);
            if (d.refresh_token) wx.setStorageSync('refreshToken', d.refresh_token);
            resolve({ ok: true, token: d.access_token });
          } else {
            // refresh_token 也失效 (撤销/复用检测失败) → 清 storage
            wx.removeStorageSync('token');
            wx.removeStorageSync('refreshToken');
            resolve({ ok: false, reason: (res.data && res.data.message) || 'refresh failed' });
          }
        },
        fail: (err) => resolve({ ok: false, reason: (err && err.errMsg) || 'network' }),
      });
    });
  },

  /**
   * R111: onShow 自动检测 token 临期 (decode JWT exp 字段, 临期 < 5 分钟)
   * 主动 refresh 避免用户在表单中途 token 失效 401
   */
  checkTokenFreshness() {
    const token = wx.getStorageSync('token');
    if (!token) return;
    const exp = this._decodeJwtExp(token);
    if (!exp) return;
    const now = Math.floor(Date.now() / 1000);
    const fiveMin = 5 * 60;
    if (exp - now < fiveMin) {
      this.refreshAccessToken(); // 后台 fire-and-forget
    }
  },

  /**
   * R111: 简单 JWT exp 字段解析 (base64url 解码 payload, 不验签)
   * 失败返 null, 让上层不 refresh
   */
  _decodeJwtExp(token) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      // base64url → base64 → JSON
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - b64.length % 4);
      // wx env 没有 atob, 用 decodeURIComponent(escape(...)) 兼容
      const json = typeof atob !== 'undefined'
        ? decodeURIComponent(escape(atob(b64 + pad)))
        : null;
      if (!json) return null;
      return JSON.parse(json).exp || null;
    } catch (_) {
      return null;
    }
  },

  /**
   * R108: 一行 dev-bypass login — IDE 沙箱 wx.login 永远 timeout 的 workaround
   * 用法 (IDE console): getApp().devQuickLogin('oemfzxT1ND_EukOcGdzN3rOWGBaY')
   * (或任意 openid 字符串, server 自动创建 user)
   * 要求: server .env ENABLE_DEV_ENDPOINTS=1
   */
  devQuickLogin(openid) {
    openid = openid || 'dev-admin';
    return new Promise((resolve) => {
      wx.request({
        url: `${apiBaseUrl}/api/test/dev-issue`,
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: { openid },
        success: (res) => {
          if (res.data && res.data.code === 0) {
            this._saveAuth(res.data.data);
            this.checkAdmin();
            resolve(res.data.data);
          } else {
            resolve({ error: res.data && res.data.message || 'dev-issue failed' });
          }
        },
        fail: (err) => resolve({ error: (err && err.errMsg) || 'network' }),
      });
    });
  },

  /**
   * R111: onLaunch / onShow 触发 token 临期检查
   */
  onShow() {
    this.checkTokenFreshness();
  },

  /**
   * 检查后端 privacy/terms 版本号；newer → 清 storage 让 popup 重弹
   * 后端每次发布新文案：admin POST /api/admin/legal-version 把 version bump 到新日期
   */
  checkPrivacyVersion(accepted) {
    const url = `${apiBaseUrl}/api/legal/versions`;
    wx.request({
      url,
      success: (res) => {
        if (!res.data || res.data.code !== 0) return;
        const latest = res.data.data;
        const localPv = wx.getStorageSync('privacy_version') || '1970-01-01';
        const localTv = wx.getStorageSync('terms_version') || '1970-01-01';
        if ((latest.privacy && latest.privacy.version > localPv) ||
            (latest.terms && latest.terms.version > localTv)) {
          // 后端版本更新 → 清旧 accept + 重弹
          if (accepted) {
            wx.removeStorageSync('privacy_accepted');
            wx.removeStorageSync('privacy_accepted_at');
            wx.setStorageSync('privacy_need_reaccept', true);
          }
          // 记录最新版本号
          wx.setStorageSync('privacy_version', latest.privacy?.version);
          wx.setStorageSync('terms_version', latest.terms?.version);
        }
      },
      fail: () => {},
    });
  },

  /**
   * 从首页 onLoad 时由 page 调：判断是否需要弹 popup
   * @returns {boolean}
   */
  shouldShowPrivacy() {
    return !wx.getStorageSync('privacy_accepted') || !!wx.getStorageSync('privacy_need_reaccept');
  },

  async checkAdmin() {
    try {
      const res = await require('./utils/request').request({ url: '/admin/check' });
      if (res.data.data.isAdmin) {
        wx.setStorageSync('is_admin', true);
      } else {
        wx.setStorageSync('is_admin', false);
      }
    } catch (e) {
      // 非 admin 或网络错，不存储
      wx.setStorageSync('is_admin', false);
    }
  },
});
