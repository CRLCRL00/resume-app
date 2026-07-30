const { request } = require('../../../utils/request');

Page({
  data: {
    items: [], list: [], total: 0, page: 1, pageSize: 20, loading: false, emptyText: '暂无 admin',
    form: { openid: '', note: '' },
  },

  onShow() { this.loadList(); },

  async loadList() {
    this.setData({ loading: true });
    const { page, pageSize } = this.data;
    try {
      const res = await request({ url: `/admin/users?page=${page}&pageSize=${pageSize}` });
      if (res.data.code === 0) this.setData({ items: res.data.data.items, list: res.data.data.items, total: res.data.data.total, loading: false });
      else this.setData({ loading: false });
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  setField(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  async add() {
    const { form } = this.data;
    if (!form.openid) return wx.showToast({ title: 'openid 必填', icon: 'none' });
    try {
      const res = await request({
        url: '/admin/users', method: 'POST',
        data: { openid: form.openid, note: form.note },
      });
      if (res.data.code === 0) {
        wx.showToast({ title: '已加', icon: 'success' });
        this.setData({ 'form.openid': '', 'form.note': '' });
        this.loadList();
      } else {
        wx.showToast({ title: res.data.message || '失败', icon: 'none' });
      }
    } catch (err) {
      wx.showToast({ title: '请求失败', icon: 'none' });
    }
  },

  async remove(e) {
    const { openid } = e.currentTarget.dataset;
    if (!openid) return;
    const confirm = await new Promise(r => {
      wx.showModal({ title: '删除', content: `移除 admin: ${openid}?`, success: r });
    });
    if (!confirm.confirm) return;
    try {
      const res = await request({ url: `/admin/users/${encodeURIComponent(openid)}`, method: 'DELETE' });
      if (res.data.code === 0) {
        wx.showToast({ title: '删除成功', icon: 'success' });
        this.loadList();
      } else {
        wx.showToast({ title: res.data.message || '失败', icon: 'none' });
      }
    } catch (err) {
      wx.showToast({ title: '请求失败', icon: 'none' });
    }
  },
});
