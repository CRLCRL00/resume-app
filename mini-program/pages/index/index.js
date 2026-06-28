const { request } = require('../../utils/request');

Page({
  data: { hasResume: false },

  onShow() {
    this.checkResume();
  },

  async checkResume() {
    try {
      const res = await request({ url: '/resume/current' });
      if (res.code === 0) this.setData({ hasResume: true });
    } catch (e) {
      // 404 or other -> no resume
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