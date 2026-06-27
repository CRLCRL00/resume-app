App({
  onLaunch() {
    const token = wx.getStorageSync('token');
    if (token) return;
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
});