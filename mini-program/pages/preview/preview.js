const { request } = require('../../utils/request');
const { mdToHtml } = require('../../utils/format');

Page({
  data: { loading: true, error: false, contentMd: '', mdHtml: '' },

  onShow() {
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: false });
    try {
      const res = await request({ url: '/resume/current' });
      const contentMd = res.data.content_md || '';
      this.setData({ loading: false, error: false, contentMd, mdHtml: mdToHtml(contentMd) });
    } catch (e) {
      this.setData({ loading: false, error: true });
    }
  },

  goForm() {
    wx.navigateTo({ url: '/pages/form/form' });
  },
});