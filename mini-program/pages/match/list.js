const { request } = require('../../utils/request');
const { loadingStages } = require('../../utils/loading');
const { scoreColor } = require('../../utils/constants');

Page({
  data: { results: [], batchId: '', loading: true, error: '', message: '' },

  onShow() { this.load(); },

  onPullDownRefresh() { this.load(); },

  async load() {
    try {
      const resumeRes = await request({ url: '/resume/current' });
      this.match(resumeRes.data.data.resume_id);
    } catch (e) {
      this.setData({ loading: false, error: '请先生成简历' });
      wx.stopPullDownRefresh();
    }
  },

  async match(resumeId) {
    const stages = loadingStages();
    wx.showLoading({ title: stages[0].text, mask: true });
    const t1 = setTimeout(() => wx.showLoading({ title: stages[1].text, mask: true }), stages[1].at);
    const t2 = setTimeout(() => wx.showLoading({ title: stages[2].text, mask: true }), stages[2].at);

    try {
      const res = await request({ url: '/match', method: 'POST', data: { resume_id: resumeId } });
      wx.hideLoading(); clearTimeout(t1); clearTimeout(t2); wx.stopPullDownRefresh();
      const results = (res.data.data && res.data.data.results || []).map(r => ({ ...r, color: scoreColor(r.score) }));
      this.setData({
        loading: false,
        results,
        batchId: (res.data.data && res.data.data.batch_id) || '',
        message: (res.data.data && res.data.data.message) || '',
      });
    } catch (e) {
      wx.hideLoading(); clearTimeout(t1); clearTimeout(t2); wx.stopPullDownRefresh();
      this.setData({ loading: false, error: '匹配失败，请重试' });
    }
  },

  goDetail(e) {
    const { id, score, reason } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/match/detail?id=${id}&score=${score}&reason=${encodeURIComponent(reason || '')}` });
  },

  goForm() { wx.navigateTo({ url: '/pages/form/form' }); },
});
