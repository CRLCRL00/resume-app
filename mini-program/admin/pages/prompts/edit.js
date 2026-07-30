const { request } = require('../../../utils/request');

Page({
  data: { code: '', content: '', version: 0 },

  onLoad(query) {
    this.setData({ code: query.code });
    this.load(query.code);
  },

  async load(code) {
    try {
      const res = await request({ url: `/admin/prompts/${code}` });
      this.setData({ content: res.data.data.content, version: res.data.data.version });
    } catch (e) {}
  },

  setContent(e) {
    this.setData({ content: e.detail.value });
  },

  async save() {
    if (!this.data.content.trim()) {
      wx.showToast({ title: '内容不能为空', icon: 'none' });
      return;
    }
    try {
      await request({ url: `/admin/prompts/${this.data.code}`, method: 'PUT', data: { content: this.data.content } });
      wx.showToast({ title: '保存成功' });
      setTimeout(() => wx.navigateBack(), 1000);
    } catch (err) {}
  },
});
