const { request } = require('../../utils/request');

Page({
  data: { hasResume: false },

  onShow() {
    this.checkResume();
  },

  async checkResume() {
    try {
      const res = await request({ url: '/resume/current', silent: true });
      if (res.code === 0) this.setData({ hasResume: true });
    } catch (e) {
      // 401/404/其他: 无 resume 或未登录 — 都视为无
      this.setData({ hasResume: false });
    }
  },

  goForm() {
    wx.navigateTo({ url: '/pages/form/form' });
  },

  goPreview() {
    wx.navigateTo({ url: '/pages/preview/preview' });
  },

  goMatch() {
    wx.navigateTo({ url: '/pages/match/list' });
  },
});