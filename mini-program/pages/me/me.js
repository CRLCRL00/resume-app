const app = getApp();

Page({
  data: { isAdmin: false },
  onShow() {
    const isAdmin = !!wx.getStorageSync('is_admin');
    this.setData({ isAdmin });
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
  onAdminPrompts() {
    wx.navigateTo({ url: '/admin/pages/prompts/list' });
  },
  onAdminLogs() {
    wx.navigateTo({ url: '/admin/pages/logs/list' });
  },
});
