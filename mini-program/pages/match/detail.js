const { request } = require('../../utils/request');
const { mdToHtml } = require('../../utils/format');
const { scoreColor } = require('../../utils/constants');

Page({
  data: { job: null, mdHtml: '', score: 0, reason: '', scoreColor: '#999', skillsText: '', loading: true },

  onLoad(query) {
    this.load(query.id, query.score, query.reason);
  },

  async load(id, score, reason) {
    try {
      const res = await request({ url: `/jobs/${id}` });
      const job = res.data;
      this.setData({
        loading: false,
        job,
        score: parseInt(score || 0, 10),
        reason: decodeURIComponent(reason || ''),
        scoreColor: scoreColor(parseInt(score || 0, 10)),
        skillsText: (job.skills_required || []).join('、'),
        mdHtml: mdToHtml(job.description_md || ''),
      });
    } catch (e) {
      this.setData({ loading: false });
    }
  },
});
