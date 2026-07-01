const { request } = require('../../../utils/request');

Page({
  data: { items: [], list: [], loading: false, emptyText: '暂无 prompt' },

  onShow() { this.loadList(); },

  async loadList() {
    this.setData({ loading: true });
    try {
      const res = await request({ url: '/admin/prompts' });
      this.setData({ items: res.data.data.items, list: res.data.data.items, loading: false });
    } catch (e) { this.setData({ loading: false }); }
  },

  goEdit(e) {
    const { code } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/admin/pages/prompts/edit?code=${code}` });
  },
});
