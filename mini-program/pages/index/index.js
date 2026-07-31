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

  goPreview() {
    wx.navigateTo({ url: '/pages/preview/preview' });
  },

  // R129 整合: 唯一入口, 跳 6 步流 (jobpilot/index)
  // Step 0 基本信息 (整合自 BigScreen) → Step 1 画像 → Step 2 项目 → Step 3 匹配 → Step 4 简历 → Step 5 投递
  goJobPilot() {
    wx.navigateTo({ url: '/pages/jobpilot/index/index' });
  },
});