const { request } = require('../../utils/request');

Page({
  data: {
    hasResume: false,
    industries: [],
    loading: true,
    sortBy: 'hot',
  },

  onShow() {
    this.checkResume();
    this.loadIndustries();
  },

  async checkResume() {
    try {
      const res = await request({ url: '/resume/current', silent: true });
      if (res.code === 0) this.setData({ hasResume: true });
    } catch (e) {
      this.setData({ hasResume: false });
    }
  },

  async loadIndustries() {
    try {
      const res = await request({ url: '/industries', silent: true });
      if (res.code === 0 && res.data && res.data.industries) {
        const sorted = this._sortIndustries(res.data.industries, this.data.sortBy);
        this.setData({ industries: this._withDerived(sorted), loading: false });
      } else {
        this.setData({ industries: [], loading: false });
      }
    } catch (e) {
      // 没数据或未登录
      this.setData({ industries: [], loading: false });
    }
  },

  _sortIndustries(list, by) {
    const arr = [...list];
    if (by === 'salary') return arr.sort((a, b) => (b.avg_salary_max || 0) - (a.avg_salary_max || 0));
    if (by === 'count') return arr.sort((a, b) => (b.job_count || 0) - (a.job_count || 0));
    return arr;
  },

  _withDerived(list) {
    const maxHot = Math.max(...list.map((i) => i.hot_score || 0), 1);
    return list.map((i) => ({
      ...i,
      emoji: this._industryEmoji(i.industry),
      hot_bar_pct: Math.min(100, Math.round(((i.hot_score || 0) / maxHot) * 100)),
    }));
  },

  _industryEmoji(name) {
    const map = {
      AI: '🤖', 算法: '🤖', 数据: '📊', 产品: '📦',
      运营: '🚀', 设计: '🎨', 前端: '💻', 后端: '⚙️',
      测试: '🔍', 运维: '🛠️', 市场: '📣', 销售: '💼',
      HR: '👥', 财务: '💰', 法务: '⚖️',
    };
    for (const [k, v] of Object.entries(map)) {
      if (name && name.includes(k)) return v;
    }
    return '🏷️';
  },

  onSwitchSort(e) {
    const { sortBy } = e.currentTarget.dataset;
    if (!sortBy || sortBy === this.data.sortBy) return;
    const sorted = this._sortIndustries(this.data.industries, sortBy);
    this.setData({ sortBy, industries: this._withDerived(sorted) });
  },

  // R130: 点行业 → 跳 jobpilot/index, query 传行业名, Step 0 期望岗位预填
  // R139: 加 loading 提示 + query 传 city + salary (供 Step 0 预填更多字段)
  // R-JobPilot-v2 W3 fix: 不用 URLSearchParams (基础库 < 2.10 不支持), 手写 URL 拼接
  onSelectIndustry(e) {
    const { industry, topcity, avgsalary } = e.currentTarget.dataset;
    wx.showLoading({ title: '打开 AI 助手...', mask: true });
    const queryParts = [`industry=${encodeURIComponent(industry)}`];
    if (topcity) queryParts.push(`city=${encodeURIComponent(topcity)}`);
    if (avgsalary) queryParts.push(`salary=${encodeURIComponent(avgsalary)}`);
    const queryString = queryParts.join('&');
    // 短延迟让用户感知加载 (0.3s, 不阻塞太久)
    setTimeout(() => {
      wx.hideLoading();
      wx.navigateTo({
        url: `/pages/jobpilot/index/index?${queryString}`,
      });
    }, 300);
  },

  goPreview() {
    wx.navigateTo({ url: '/pages/preview/preview' });
  },
});