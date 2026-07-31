const { request } = require('../../utils/request');

Page({
  data: {
    hasResume: false,
    industries: [],
    loading: true,
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
        this.setData({ industries: res.data.industries, loading: false });
      } else {
        this.setData({ industries: [], loading: false });
      }
    } catch (e) {
      // 没数据或未登录
      this.setData({ industries: [], loading: false });
    }
  },

  // R130: 点行业 → 跳 jobpilot/index, query 传行业名, Step 0 期望岗位预填
  // R139: 加 loading 提示 + query 传 city + salary (供 Step 0 预填更多字段)
  onSelectIndustry(e) {
    const { industry, topcity, avgsalary } = e.currentTarget.dataset;
    wx.showLoading({ title: '打开 AI 助手...', mask: true });
    const params = new URLSearchParams({ industry });
    if (topcity) params.set('city', topcity);
    if (avgsalary) params.set('salary', avgsalary);
    // 短延迟让用户感知加载 (0.3s, 不阻塞太久)
    setTimeout(() => {
      wx.hideLoading();
      wx.navigateTo({
        url: `/pages/jobpilot/index/index?${params.toString()}`,
      });
    }, 300);
  },

  goPreview() {
    wx.navigateTo({ url: '/pages/preview/preview' });
  },
});