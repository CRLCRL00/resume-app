const { request } = require('../../../utils/request');

Page({
  data: { items: [], total: 0, page: 1, pageSize: 20, loading: false },

  onShow() { this.load(); },

  async load() {
    this.setData({ loading: true });
    try {
      const res = await request({
        url: `/admin/jobs?page=${this.data.page}&pageSize=${this.data.pageSize}`,
      });
      const all = this.data.page === 1 ? res.data.items : this.data.items.concat(res.data.items);
      this.setData({ items: all, total: res.data.total, loading: false });
    } catch (e) {
      this.setData({ loading: false });
    }
  },

  onReachBottom() {
    if (this.data.items.length < this.data.total) {
      this.setData({ page: this.data.page + 1 });
      this.load();
    }
  },

  goCreate() { wx.navigateTo({ url: '/admin/pages/jobs/edit' }); },
  goEdit(e) { wx.navigateTo({ url: `/admin/pages/jobs/edit?id=${e.currentTarget.dataset.id}` }); },

  async toggleOnline(e) {
    const { id, online } = e.currentTarget.dataset;
    try {
      await request({ url: `/admin/jobs/${id}/online`, method: 'PATCH' });
      this.setData({ page: 1 });
      this.load();
    } catch (err) {}
  },

  async deleteJob(e) {
    const id = e.currentTarget.dataset.id;
    const ok = await wx.showModal({ title: '确认删除？', content: '软删除，可恢复' }).then(r => r.confirm);
    if (!ok) return;
    try {
      await request({ url: `/admin/jobs/${id}`, method: 'DELETE' });
      this.setData({ page: 1 });
      this.load();
    } catch (err) {}
  },

  async restoreJob(e) {
    const id = e.currentTarget.dataset.id;
    try {
      await request({ url: `/admin/jobs/${id}/restore`, method: 'PATCH' });
      this.setData({ page: 1 });
      this.load();
    } catch (err) {}
  },
});
