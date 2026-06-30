// 工具栏 → 详情 → 本地设置 → 勾「不校验合法域名」才能访问 https://fa1b04c679fe9e41-43-139-176-199.serveousercontent.com
// 真机预览时 wx.login 自动跑，模拟器 timeout 所以跳过
App({
  globalData: {
    userInfo: null,
    privacyAccepted: false,
  },

  onLaunch() {
    // 隐私同意状态
    const accepted = wx.getStorageSync('privacy_accepted');
    this.globalData.privacyAccepted = !!accepted;

    // 延迟显示让首页先加载
    if (!accepted) {
      setTimeout(() => {
        const pages = getCurrentPages();
        if (pages.length > 0) {
          const cur = pages[pages.length - 1];
          const popup = cur.selectComponent('#privacy-popup');
          if (popup) popup.show();
        }
      }, 500);
    }

    const token = wx.getStorageSync('token');
    if (token) {
      // 已有 token：检查 admin 状态供 'me' 页用
      this.checkAdmin();
      return;
    }

    // 真机：wx.login 拿 code 换 token
    // 模拟器：跳过登录，开发者可手动在控制跑 setToken 调试
    if (typeof wx.getSystemInfoSync === 'function') {
      const info = wx.getSystemInfoSync();
      if (info.platform === 'devtools') return; // 模拟器不调 login
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
