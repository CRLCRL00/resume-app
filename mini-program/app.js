// 工具栏 → 详情 → 本地设置 → 勾「不校验合法域名」才能访问 https://43.139.176.199
// 真机预览时 wx.login 自动跑，模拟器 timeout 所以跳过
App({
  onLaunch() {
    const token = wx.getStorageSync('token');
    if (token) return;

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
});