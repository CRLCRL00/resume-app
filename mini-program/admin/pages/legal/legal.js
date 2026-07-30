const { request } = require('../../../utils/request');

Page({
  data: {
    versions: { privacy: { version: '' }, terms: { version: '' } },
    form: { doc_type: 'privacy', version: '', note: '' },
    saving: false,
  },

  onShow() { this.load(); },

  async load() {
    try {
      const res = await request({ url: '/legal/versions' });
      if (res.data && res.data.code === 0) {
        this.setData({ versions: res.data.data });
      }
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  setField(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  pickDocType(e) {
    this.setData({ 'form.doc_type': e.detail.value });
  },

  async bump() {
    const { form } = this.data;
    if (!form.version || !/^\d{4}-\d{2}-\d{2}$/.test(form.version)) {
      wx.showToast({ title: '版本需 YYYY-MM-DD', icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    try {
      const res = await request({
        url: '/admin/legal-version',
        method: 'POST',
        data: { doc_type: form.doc_type, version: form.version, note: form.note },
      });
      if (res.data.code === 0) {
        wx.showToast({ title: '已 bump', icon: 'success' });
        this.setData({ 'form.note': '' });
        this.load();
      } else {
        wx.showToast({ title: res.data.message || '失败', icon: 'none' });
      }
    } catch (err) {
      wx.showToast({ title: '请求失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },
});
