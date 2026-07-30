const { request } = require('../../utils/request');

Page({
  data: { hasResume: false },

  onShow() {
    this.checkResume();
  },

  async checkResume() {
    try {
      const res = await request({ url: '/resume/current', silent: true });
      if (res.code === 0) this.setData({ hasResume: true });
    } catch (e) {
      // 401/404/其他: 无 resume 或未登录 — 都视为无
      this.setData({ hasResume: false });
    }
  },

  goForm() {
    wx.navigateTo({ url: '/pages/form/bigscreen/bigscreen' });
  },

  goPreview() {
    wx.navigateTo({ url: '/pages/preview/preview' });
  },

  // R-JobSearch 重构: "找岗位" 改成跳 5 步流 (含 Step 3 岗位匹配 + Step 4 简历生成 + Step 5 投递追踪)
  goJobPilot() {
    wx.navigateTo({ url: '/pages/jobpilot/index/index' });
  },
});