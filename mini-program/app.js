// 工具栏 → 详情 → 本地设置 → 勾「不校验合法域名」才能访问 https://fa1b04c679fe9e41-43-139-176-199.serveousercontent.com
// 真机预览时 wx.login 自动跑，模拟器 timeout 所以跳过
App({
  globalData: {
    userInfo: null,
    privacyAccepted: false,
  },

  onLaunch() {
    const accepted = wx.getStorageSync('privacy_accepted');
    this.globalData.privacyAccepted = !!accepted;

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
  },

  login() {
    wx.login({
      success: ({ code }) => {
        wx.request({
          url: 'https://fa1b04c679fe9e41-43-139-176-199.serveousercontent.com/api/auth/login',
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
    const url = 'https://fa1b04c679fe9e41-43-139-176-199.serveousercontent.com/api/legal/versions';
    wx.request({
      url,
      success: (res) => {
        if (!res.data || res.data.code !== 0) return;
        const latest = res.data.data;
        const localPv = wx.getStorageSync('privacy_version') || '1970-01-01';
        const localTv = wx.getStorageSync('terms_version') || '1970-01-01';
        if ((latest.privacy && latest.privacy.version > localPv) ||
            (latest.terms   && latest.terms.version   > localTv)) {
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
