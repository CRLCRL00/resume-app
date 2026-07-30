// R71: admin logs viewer with filters + pagination
const { request } = require('../../../utils/request');

Page({
  data: {
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
    totalPages: 0,
    loading: false,
    emptyText: '暂无日志',
    actionTypes: ['全部'],
    actionIdx: 0,
    actorOpenids: ['全部'],
    actorIdx: 0,
    securityOnly: false,
    _filterAction: '',
    _filterActor: '',
  },

  onShow() {
    this._loadFilters();
    this.loadList(true);
  },

  onPullDownRefresh() {
    this.loadList(true).then(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.items.length < this.data.total && !this.data.loading) {
      this.setData({ page: this.data.page + 1 });
      this.loadList(false);
    }
  },

  async _loadFilters() {
    try {
      const [actions, actors] = await Promise.all([
        request({ url: '/api/admin/logs/actions', silent: true, retry: 0 }),
        request({ url: '/api/admin/logs/actors', silent: true, retry: 0 }),
      ]);
      const actionTypes = ['全部'].concat((actions.data.data || []).map((a) => a.action));
      const actorOpenids = ['全部'].concat((actors.data.data || []).map((a) => a.admin_openid));
      this.setData({ actionTypes, actorOpenids });
    } catch (_) { /* filters best-effort */ }
  },

  async loadList(reset = false) {
    this.setData({ loading: true });
    try {
      const base = this.data.securityOnly
        ? '/api/admin/logs/security'
        : '/api/admin/logs';
      const params = new URLSearchParams();
      params.set('page', String(this.data.page));
      params.set('pageSize', String(this.data.pageSize));
      if (this.data._filterAction) params.set('action', this.data._filterAction);
      if (this.data._filterActor) params.set('admin_openid', this.data._filterActor);
      const url = `${base}?${params.toString()}`;
      const res = await request({ url, silent: true, retry: 0 });
      const data = res.data.data || {};
      const newItems = data.items || [];
      const items = reset ? newItems : this.data.items.concat(newItems);
      const total = data.total || 0;
      this.setData({
        items,
        total,
        totalPages: Math.ceil(total / this.data.pageSize) || 1,
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false, emptyText: (e && e.errMsg) || '加载失败' });
    }
  },

  onActionPick(e) {
    const idx = Number(e.detail.value);
    const action = idx === 0 ? '' : this.data.actionTypes[idx];
    this.setData({ actionIdx: idx, _filterAction: action, page: 1 });
    this.loadList(true);
  },

  onActorPick(e) {
    const idx = Number(e.detail.value);
    const actor = idx === 0 ? '' : this.data.actorOpenids[idx];
    this.setData({ actorIdx: idx, _filterActor: actor, page: 1 });
    this.loadList(true);
  },

  toggleSecurity() {
    this.setData({ securityOnly: !this.data.securityOnly, page: 1 });
    this.loadList(true);
  },

  onRefresh() {
    this.setData({ page: 1 });
    this.loadList(true);
  },
});