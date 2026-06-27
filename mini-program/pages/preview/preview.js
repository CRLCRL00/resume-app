const { request } = require('../../utils/request');
const { mdToHtml } = require('../../utils/format');

Page({
  data: { loading: true, contentMd: '', mdHtml: '' },

  onShow() {
    this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      const res = await request({ url: '/resume/current' });
      const contentMd = res.data.content_md || '';
      this.setData({ loading: false, contentMd, mdHtml: mdToHtml(contentMd) });
    } catch (e) {
      this.setData({ loading: false, contentMd: '' });
    }
  },

  goForm() {
    wx.navigateTo({ url: '/pages/form/form' });
  },
});