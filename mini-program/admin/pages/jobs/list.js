const { request } = require('../../../utils/request');

Page({
  data: { items: [], list: [], total: 0, page: 1, pageSize: 20, loading: false, emptyText: '暂无岗位' },

  onShow() { this.loadList(); },

  async loadList() {
    this.setData({ loading: true });
    try {
      const res = await request({
        url: `/admin/jobs?page=${this.data.page}&pageSize=${this.data.pageSize}`,
      });
      const all = this.data.page === 1 ? res.data.data.items : this.data.items.concat(res.data.data.items);
      this.setData({ items: all, list: all, total: res.data.data.total, loading: false });
    } catch (e) {
      this.setData({ loading: false });
    }
  },

  onReachBottom() {
    if (this.data.items.length < this.data.total) {
      this.setData({ page: this.data.page + 1 });
      this.loadList();
    }
  },

  goCreate() { wx.navigateTo({ url: '/admin/pages/jobs/edit' }); },
  goEdit(e) { wx.navigateTo({ url: `/admin/pages/jobs/edit?id=${e.currentTarget.dataset.id}` }); },

  async toggleOnline(e) {
    const { id, online } = e.currentTarget.dataset;
    try {
      await request({ url: `/admin/jobs/${id}/online`, method: 'PATCH' });
      this.setData({ page: 1 });
      this.loadList();
    } catch (err) {}
  },

  async deleteJob(e) {
    const id = e.currentTarget.dataset.id;
    const modal = await wx.showModal({ title: '确认删除？', content: '软删除，可恢复' });
    if (!modal.confirm) return;
    try {
      await request({ url: `/admin/jobs/${id}`, method: 'DELETE' });
      this.setData({ page: 1 });
      this.loadList();
    } catch (err) {}
  },

  async restoreJob(e) {
    const id = e.currentTarget.dataset.id;
    try {
      await request({ url: `/admin/jobs/${id}/restore`, method: 'PATCH' });
      this.setData({ page: 1 });
      this.loadList();
    } catch (err) {}
  },
});
