const app = getApp();
const { clearToken, getToken } = require('../../utils/auth');

Page({
  data: {
    isAdmin: false,
    isLoggedIn: false,
    openidTail: '',
  },
  onLoad() {
    this._refreshAuthState();
  },
  onShow() {
    const isAdmin = !!wx.getStorageSync('is_admin');
    this.setData({ isAdmin });
    this._refreshAuthState();
  },
  // R-JobPilot-v2 W3: 登录入口 (IDE 模拟器跳过自动登录)
  onLogin() {
    wx.showLoading({ title: '登录中...', mask: true });
    wx.login({
      success: ({ code }) => {
        this._doLogin(code);
      },
      fail: () => {
        // IDE 模拟器沙箱: wx.login fail → fallback 到 dev-bypass
        // (需要 prod server ENABLE_DEV_BYPASS=true)
        wx.hideLoading();
        this._doLogin('dev-bypass');
      },
    });
  },
  // 实际发起 /api/auth/login
  _doLogin(code) {
    wx.request({
      url: `${require('../../src/config').apiBaseUrl}/api/auth/login`,
      method: 'POST',
      data: { code, openid: 'dev-admin' },
      success: (res) => {
        wx.hideLoading();
        if (res.data && res.data.code === 0) {
          const { token, user } = res.data.data;
          wx.setStorageSync('token', token);
          if (user) wx.setStorageSync('user', user);
          wx.showToast({ title: '登录成功', icon: 'success' });
          this._refreshAuthState();
        } else {
          wx.showToast({ title: res.data?.message || '登录失败', icon: 'none' });
        }
      },
      fail: (err) => {
        wx.hideLoading();
        wx.showToast({ title: '网络错误, 请检查后端', icon: 'none' });
        console.error('[me._doLogin] fail:', err);
      },
    });
  },
  onLogout() {
    clearToken();
    this._refreshAuthState();
    wx.showToast({ title: '已退出', icon: 'none' });
  },
  _refreshAuthState() {
    const token = getToken();
    const user = wx.getStorageSync('user') || {};
    this.setData({
      isLoggedIn: !!token,
      openidTail: user.openid ? `...${user.openid.slice(-6)}` : '',
    });
  },
  onAbout() {
    wx.showModal({
      title: '智能简历助手',
      content: '一键生成专业简历 + 智能岗位匹配推荐',
      showCancel: false,
    });
  },
  onPrivacy() {
    wx.navigateTo({ url: '/pages/legal/privacy' });
  },
  onTerms() {
    wx.navigateTo({ url: '/pages/legal/terms' });
  },
  onAdminJobs() {
    wx.navigateTo({ url: '/admin/pages/jobs/list' });
  },
  onAdminDashboard() {
    wx.navigateTo({ url: '/admin/pages/dashboard/dashboard' });
  },
  onAdminPrompts() {
    wx.navigateTo({ url: '/admin/pages/prompts/list' });
  },
  onAdminLogs() {
    wx.navigateTo({ url: '/admin/pages/logs/list' });
  },

  onAdminLegal() {
    wx.navigateTo({ url: '/admin/pages/legal/legal' });
  },

  onAdminAdmins() {
    wx.navigateTo({ url: '/admin/pages/admins/admins' });
  },
});
