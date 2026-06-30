const { request } = require('../../../utils/request');

Page({
  data: { items: [], total: 0, page: 1, pageSize: 20, loading: false },

  onShow() { this.load(); },

  async load() {
    this.setData({ loading: true });
    try {
      const res = await request({ url: `/admin/logs?page=${this.data.page}&pageSize=${this.data.pageSize}` });
      const all = this.data.page === 1 ? res.data.data.items : this.data.items.concat(res.data.data.items);
      this.setData({ items: all, total: res.data.data.total, loading: false });
    } catch (e) { this.setData({ loading: false }); }
  },

  onReachBottom() {
    if (this.data.items.length < this.data.total) {
      this.setData({ page: this.data.page + 1 });
      this.load();
    }
  },
});
