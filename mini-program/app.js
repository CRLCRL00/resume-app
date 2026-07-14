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

    if (typeof wx.getSystemInfoSync === 'function') {
      const info = wx.getSystemInfoSync();
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
              wx.setStorageSync('token', res.data.data.token);
              wx.setStorageSync('user', res.data.data.user);
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
  setToken(token, user) {
    wx.setStorageSync('token', token);
    if (user) wx.setStorageSync('user', user);
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
