const { request } = require('../../../utils/request');

Page({
  data: { items: [] },

  onShow() { this.load(); },

  async load() {
    try {
      const res = await request({ url: '/admin/prompts' });
      this.setData({ items: res.data.data.items });
    } catch (e) {}
  },

  goEdit(e) {
    const { code } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/admin/pages/prompts/edit?code=${code}` });
  },
});
