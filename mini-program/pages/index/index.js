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
  onSelectIndustry(e) {
    const { industry } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/jobpilot/index/index?industry=${encodeURIComponent(industry)}`,
    });
  },

  goPreview() {
    wx.navigateTo({ url: '/pages/preview/preview' });
  },
});