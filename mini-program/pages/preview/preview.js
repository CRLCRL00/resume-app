const { request } = require('../../utils/request');
const { mdToHtml } = require('../../utils/format');

Page({
  data: {
    loading: true,
    error: false,
    contentMd: '',
    mdHtml: '',
    resumeId: null,
    generating: false,
  },

  onShow() {
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: false });
    try {
      const res = await request({ url: '/resume/current' });
      const contentMd = res.data.content_md || '';
      const resumeId = res.data.resume_id || null;
      this.setData({ loading: false, error: false, contentMd, resumeId, mdHtml: mdToHtml(contentMd) });
    } catch (e) {
      this.setData({ loading: false, error: true });
    }
  },

  async ensureResumeId() {
    if (this.data.resumeId) return this.data.resumeId;
    const res = await request({ url: '/resume/current' });
    if (res.data && res.data.resume_id) {
      this.setData({ resumeId: res.data.resume_id });
      return res.data.resume_id;
    }
    throw new Error('无 resume_id：请先填写并保存表单');
  },

  async onGenerate() {
    if (this.data.generating) return;
    this.setData({ generating: true });
    try {
      const resumeId = await this.ensureResumeId();
      wx.showLoading({ title: '生成中...', mask: true });
      const res = await request({ url: '/resume/generate', method: 'POST', data: { resume_id: resumeId } });
      wx.hideLoading();
      const md = res.data.content_md || '';
      this.setData({ generating: false, contentMd: md, mdHtml: mdToHtml(md) });
      wx.showToast({ title: '生成成功', icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      this.setData({ generating: false });
      wx.showToast({ title: '生成失败', icon: 'none' });
    }
  },

  async onRegenerate() {
    return this.onGenerate();
  },

  async onRetry() {
    this.load();
  },

  goForm() {
    wx.navigateTo({ url: '/pages/form/form' });
  },

  goMatch() {
    wx.navigateTo({ url: '/pages/match/list' });
  },
});
