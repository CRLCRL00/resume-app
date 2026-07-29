/**
 * R-JobSearch 重构: AI 实习求职助手 - 5 步流程入口页
 *
 * 步骤:
 *   1. 画像诊断 (5 题 → AI 输出 4 种画像分类)
 *   2. 项目提取 (用户描述项目 → AI 评分 1-10)
 *   3. 岗位匹配 (调用 /api/match,显示 verify_status + score_10)
 *   4. 简历生成 (调用 /api/resume/generate,显示 storyPoints)
 *   5. 投递追踪 (调用 /api/match/applications,管理投递状态)
 *
 * 设计原则:
 *   - 单页 5 tabs (不要 5 个页面)
 *   - 每个 tab 独立状态,可不按顺序使用
 *   - 复用现有后端 API (不改后端)
 */

const app = getApp();

Page({
  data: {
    currentStep: 0,  // 0-4: 当前激活的 tab
    steps: [
      { id: 'profile', name: '画像诊断', icon: '👤' },
      { id: 'project', name: '项目提取', icon: '📦' },
      { id: 'match', name: '岗位匹配', icon: '🎯' },
      { id: 'resume', name: '简历生成', icon: '📄' },
      { id: 'tracker', name: '投递追踪', icon: '📮' },
    ],

    // Step 1: 画像诊断
    profileForm: {
      education: '',
      aiAbility: '',
      projects: '',
      target: '',
      timeline: '',
    },
    profileResult: null,  // {image, confidence, recommendedJobs, resumeStrategy}

    // Step 2: 项目提取
    projectForm: {
      name: '',
      techStack: '',
      aiCollaboration: '',
      myRole: '',
      url: '',
    },
    projectResult: null,  // {score, breakdown, storyPoints, improvements}

    // Step 3: 岗位匹配
    matchResumeId: '',
    matchResults: [],     // [{job_id, title, company, score_10, verify_status, ...}]
    matchLoading: false,

    // Step 4: 简历生成
    generateResumeId: '',
    generateResult: null, // {resume, story_points, mode}
    generateLoading: false,

    // Step 5: 投递追踪
    applications: [],     // [{id, job, status, applied_at, needs_follow_up}]
    trackerLoading: false,
  },

  onLoad() {
    // 检查登录态 (复用现有 auth)
    if (!app.globalData.userToken) {
      wx.redirectTo({ url: '/pages/index/index' });
    }
  },

  // ===== 通用:tab 切换 =====
  switchStep(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    this.setData({ currentStep: idx });
    // 进入特定 tab 时加载数据
    if (idx === 3 && this.data.applications.length === 0) {
      this.loadApplications();
    }
  },

  // ===== Step 1: 画像诊断 =====

  onProfileInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`profileForm.${field}`]: e.detail.value });
  },

  async submitProfile() {
    const { profileForm } = this.data;
    if (!profileForm.education || !profileForm.target) {
      return wx.showToast({ title: '请填写学历和求职目标', icon: 'none' });
    }
    wx.showLoading({ title: 'AI 诊断中...' });
    try {
      const res = await this._api('/api/jobpilot/profile-diagnose', 'POST', profileForm);
      if (res.ok) {
        this.setData({ profileResult: res });
        wx.hideLoading();
        wx.showToast({ title: '诊断完成', icon: 'success' });
      } else {
        throw new Error(res.error || '诊断失败');
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '诊断失败', icon: 'none' });
    }
  },

  // ===== Step 2: 项目提取 =====

  onProjectInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`projectForm.${field}`]: e.detail.value });
  },

  async submitProject() {
    const { projectForm } = this.data;
    if (!projectForm.name) {
      return wx.showToast({ title: '请填写项目名', icon: 'none' });
    }
    wx.showLoading({ title: 'AI 评估中...' });
    try {
      const res = await this._api('/api/jobpilot/project-score', 'POST', projectForm);
      if (res.ok) {
        this.setData({ projectResult: res });
        wx.hideLoading();
        wx.showToast({ title: '评估完成', icon: 'success' });
      } else {
        throw new Error(res.error || '评估失败');
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '评估失败', icon: 'none' });
    }
  },

  // ===== Step 3: 岗位匹配 =====

  async doMatch() {
    if (!this.data.matchResumeId) {
      return wx.showToast({ title: '请先填写简历 ID', icon: 'none' });
    }
    this.setData({ matchLoading: true });
    wx.showLoading({ title: '匹配中...' });
    try {
      const res = await this._api('/api/match/', 'POST', {
        resume_id: Number(this.data.matchResumeId),
      });
      if (res.code === 0) {
        this.setData({ matchResults: res.data.results || [] });
        wx.hideLoading();
      } else {
        throw new Error(res.error || '匹配失败');
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '匹配失败', icon: 'none' });
    }
    this.setData({ matchLoading: false });
  },

  async applyToJob(e) {
    const { jobid } = e.currentTarget.dataset;
    wx.showLoading({ title: '标记投递...' });
    try {
      const res = await this._api('/api/match/apply', 'POST', { job_id: jobid });
      if (res.code === 0) {
        wx.hideLoading();
        wx.showToast({ title: '已标记投递', icon: 'success' });
        // 刷新投递列表
        if (this.data.currentStep === 4) this.loadApplications();
      } else {
        throw new Error(res.error || '标记失败');
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '标记失败', icon: 'none' });
    }
  },

  // ===== Step 4: 简历生成 =====

  async generateResume() {
    if (!this.data.generateResumeId) {
      return wx.showToast({ title: '请先填写简历 ID', icon: 'none' });
    }
    this.setData({ generateLoading: true });
    wx.showLoading({ title: 'AI 生成中...' });
    try {
      const res = await this._api('/api/resume/generate', 'POST', {
        resume_id: Number(this.data.generateResumeId),
      });
      if (res.code === 0) {
        this.setData({
          generateResult: {
            resume: res.data.content_md,
            story_points: res.data.story_points || [],
            mode: res.data.mode,
          },
        });
        wx.hideLoading();
      } else {
        throw new Error(res.error || '生成失败');
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '生成失败', icon: 'none' });
    }
    this.setData({ generateLoading: false });
  },

  // ===== Step 5: 投递追踪 =====

  async loadApplications() {
    this.setData({ trackerLoading: true });
    try {
      const res = await this._api('/api/match/applications', 'GET');
      if (res.code === 0) {
        this.setData({ applications: res.data.applications || [] });
      } else {
        throw new Error(res.error || '加载失败');
      }
    } catch (err) {
      wx.showToast({ title: err.message || '加载失败', icon: 'none' });
    }
    this.setData({ trackerLoading: false });
  },

  async updateAppStatus(e) {
    const { id, status } = e.currentTarget.dataset;
    try {
      const res = await this._api(`/api/match/applications/${id}`, 'PATCH', { status });
      if (res.code === 0) {
        wx.showToast({ title: '已更新', icon: 'success' });
        this.loadApplications();
      } else {
        throw new Error(res.error || '更新失败');
      }
    } catch (err) {
      wx.showToast({ title: err.message || '更新失败', icon: 'none' });
    }
  },

  // ===== 工具 =====

  async _api(path, method, body) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: app.globalData.apiBase + path,
        method,
        data: body,
        header: {
          'Authorization': `Bearer ${app.globalData.userToken}`,
          'Content-Type': 'application/json',
        },
        success: (res) => resolve(res.data),
        fail: (err) => reject(err),
      });
    });
  },
});