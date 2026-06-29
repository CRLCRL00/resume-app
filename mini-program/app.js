// 工具栏 → 详情 → 本地设置 → 勾「不校验合法域名」才能访问 https://43.139.176.199
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
    if (token) return;

    // 真机：wx.login 拿 code 换 token
    // 模拟器：跳过登录，开发者可手动在控制跑 setToken 调试
    if (typeof wx.getSystemInfoSync === 'function') {
      const info = wx.getSystemInfoSync();
      if (info.platform === 'devtools') return; // 模拟器不调 login
    }

    this.login();

    // 先把 index=1（管理 tab）隐藏，等 checkAdmin 返回再决定是否显示
    setTimeout(() => this.checkAdmin(), 1500);
  },

  login() {
    wx.login({
      success: ({ code }) => {
        wx.request({
          url: 'https://43.139.176.199/api/auth/login',
          method: 'POST',
          data: { code },
          success: (res) => {
            if (res.data?.code === 0) {
              wx.setStorageSync('token', res.data.data.token);
              wx.setStorageSync('user', res.data.data.user);
            }
          },
        });
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
      if (res.data?.isAdmin) {
        wx.setTabBarItem({
          index: 1,
          pagePath: 'admin/pages/jobs/list',
          text: '管理',
        });
        wx.showTabBar({ index: 1, animation: false });
      } else {
        wx.hideTabBar({ index: 1, animation: false });
      }
    } catch (e) {
      // 非 admin 或网络错，不显示
      wx.hideTabBar({ index: 1, animation: false });
    }
  },
});