/**
 * R-JobSearch 重构 v3: AI 求职助手 - 6 步流程入口页 (整合 BigScreen + 原 5 步)
 *
 * 优化点 (vs v2):
 *   - R129: 整合 BigScreen 5 星座填基础资料进 5 步流 — 6 步变 1 流程,user 不再被干扰
 *   - Step 0: 基本信息 (姓名/性别/学历/工作年限/期望岗位/期望薪资) — 6 字段
 *   - Step 1-5: 原画像诊断/项目提取/岗位匹配/简历生成/投递追踪
 *   - 表单持久化 (storage)
 *
 * 步骤:
 *   0. 基本信息 (姓名/性别/学历/工作年限/期望岗位/期望薪资) [整合自 BigScreen]
 *   1. 画像诊断 (学历/AI能力/项目经验/求职目标/时间窗口)
 *   2. 项目提取 (项目名/技术栈/AI协作方式/我的角色/项目地址)
 *   3. 岗位匹配 (调 /api/match)
 *   4. 简历生成 (调 /api/resume/generate)
 *   5. 投递追踪 (调 /api/match/applications)
 */

const { apiBaseUrl } = require('../../../src/config');
const { request } = require('../../../utils/request');
const { getToken } = require('../../../utils/auth');

const STORAGE_KEY = 'jobpilot_state_v2';

const app = getApp();

Page({
  data: {
    currentStep: 0,
    completedSteps: [],
    steps: [
      { id: 'basic', name: '基本信息', icon: '📝' },
      { id: 'profile', name: '画像诊断', icon: '👤' },
      { id: 'project', name: '项目提取', icon: '📦' },
      { id: 'match', name: '岗位匹配', icon: '🎯' },
      { id: 'resume', name: '简历生成', icon: '📄' },
      { id: 'tracker', name: '投递追踪', icon: '📮' },
    ],

    // Step 0: 基本信息 (整合自 BigScreen, R139 加 expectedCity 共 7 字段)
    basicForm: { name: '', gender: '', education: '', workYears: '', expectedPosition: '', expectedCity: '', expectedSalary: '' },

    // Step 1: 画像诊断
    profileForm: { education: '', aiAbility: '', projects: '', target: '', timeline: '' },
    profileResult: null,

    // Step 2: 项目提取
    projectForm: { name: '', techStack: '', aiCollaboration: '', myRole: '', url: '' },
    projectResult: null,

    // Step 3: 岗位匹配
    matchResumeId: '',
    matchResults: [],
    matchLoading: false,

    // Step 4: 简历生成
    generateResumeId: '',
    generateResult: null,
    generateLoading: false,
    copied: false, // R140: 复制 markdown 按钮反馈状态

    // Step 5: 投递追踪
    applications: [],
    trackerLoading: false,
  },

  onLoad(options) {
    // R-JobPilot-v2 W3 fix: 跳 me 页引导登录 (而非 navigateBack, 用户可能没上一页)
    if (!getToken()) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      setTimeout(() => wx.navigateTo({ url: '/pages/me/me' }), 800);
      return;
    }
    // R139: 加载 AI 助手 loading 提示 (用户从首页跳转过来有感知)
    wx.showLoading({ title: '加载 AI 助手...', mask: true });

    // 修复: token 在 wx.storage,不在 globalData
    const token = getToken();
    if (!token) {
      wx.hideLoading();
      wx.showToast({ title: '请先登录', icon: 'none' });
      setTimeout(() => wx.navigateBack({ delta: 1 }), 1000);
      return;
    }

    // 恢复上次的 state (持久化)
    const saved = wx.getStorageSync(STORAGE_KEY);
    let prefill = {};
    if (saved) {
      try {
        const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
        this.setData({
          basicForm: parsed.basicForm || this.data.basicForm,
          profileForm: parsed.profileForm || this.data.profileForm,
          profileResult: parsed.profileResult || null,
          projectForm: parsed.projectForm || this.data.projectForm,
          projectResult: parsed.projectResult || null,
          completedSteps: parsed.completedSteps || [],
        });
      } catch (e) {
        // 损坏 state 忽略
      }
    }

    // R130 + R139: 从首页带 query 来的行业, 预填 Step 0 expectedPosition + city + salary
    if (options) {
      if (options.industry && !this.data.basicForm.expectedPosition) {
        this.setData({ 'basicForm.expectedPosition': decodeURIComponent(options.industry) });
      }
      // R139: 新加 city + salary 预填 (来自 industries API 统计)
      if (options.city && !this.data.basicForm.expectedCity) {
        this.setData({ 'basicForm.expectedCity': decodeURIComponent(options.city) });
      }
      if (options.salary && !this.data.basicForm.expectedSalary) {
        // avg_salary_max 数字 → picker range 标签
        const salary = Number(options.salary);
        const range = salary <= 15 ? '10-20K'
          : salary <= 25 ? '20-30K'
          : salary <= 40 ? '30-50K'
          : '50K+';
        this.setData({ 'basicForm.expectedSalary': range });
      }
    }

    // 自动 fetch 当前简历 ID (用户不用手动填)
    this.fetchResumeId().finally(() => {
      // R139: fetchResumeId 完成后才 hideLoading (无论成功失败)
      wx.hideLoading();
    });
  },

  /**
   * 自动从 /resume/current 获取 resume_id
   * Step 3/4 都需要,统一在这里处理
   */
  async fetchResumeId() {
    try {
      const res = await request({ url: '/resume/current', silent: true });
      if (res.code === 0 && res.data) {
        const id = String(res.data.resume_id || '');
        if (id) {
          this.setData({
            matchResumeId: id,
            generateResumeId: id,
          });
        }
      }
    } catch (e) {
      // 没有 resume → 用户需要先去首页点"开始填写"
    }
  },

  // ===== 通用:tab 切换 =====

  /**
   * R-JobPilot-v2 W3: 跳到 chat-build 对话建简历页面
   * 把当前 profileResult.image 传给 chat-build (如果已有画像诊断, 直接预选)
   */
  goChatBuild() {
    const image = (this.data.profileResult && this.data.profileResult.image) || '';
    const url = image
      ? `/pages/jobpilot/chat-build/index?image=${encodeURIComponent(image)}`
      : '/pages/jobpilot/chat-build/index';
    wx.navigateTo({ url });
  },

  // ===== 通用:tab 切换 =====
  switchStep(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    this.setData({ currentStep: idx });
    // Step 5 自动加载
    if (idx === 5 && this.data.applications.length === 0) {
      this.loadApplications();
    }
  },

  /**
   * 自动跳到下一步 (R129: 6 步)
   */
  nextStep() {
    const idx = this.data.currentStep;
    if (idx < 5) {
      this.setData({ currentStep: idx + 1 });
      if (idx + 1 === 5) this.loadApplications();
    }
  },

  // ===== State 持久化 =====
  saveState() {
    wx.setStorageSync(STORAGE_KEY, {
      basicForm: this.data.basicForm,
      profileForm: this.data.profileForm,
      profileResult: this.data.profileResult,
      projectForm: this.data.projectForm,
      projectResult: this.data.projectResult,
      completedSteps: this.data.completedSteps,
    });
  },

  markCompleted(stepIdx) {
    if (!this.data.completedSteps.includes(stepIdx)) {
      this.setData({ completedSteps: [...this.data.completedSteps, stepIdx] });
      this.saveState();
    }
  },

  // ===== Step 0: 基本信息 (R129 整合自 BigScreen) =====

  onBasicInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`basicForm.${field}`]: e.detail.value });
  },

  onBasicPickerChange(e) {
    const { field, options } = e.currentTarget.dataset;
    const idx = Number(e.detail.value);
    const value = options[idx];
    this.setData({ [`basicForm.${field}`]: value });
  },

  submitBasic() {
    const { basicForm } = this.data;
    if (!basicForm.name || basicForm.name.trim().length < 1) {
      return wx.showToast({ title: '请填姓名', icon: 'none' });
    }
    if (!basicForm.gender) {
      return wx.showToast({ title: '请选择性别', icon: 'none' });
    }
    if (!basicForm.education) {
      return wx.showToast({ title: '请选择学历', icon: 'none' });
    }
    if (!basicForm.workYears) {
      return wx.showToast({ title: '请选择工作年限', icon: 'none' });
    }
    if (!basicForm.expectedPosition) {
      return wx.showToast({ title: '请填期望岗位', icon: 'none' });
    }
    // R139: 加期望城市校验 (Step 0 加了 picker)
    if (!basicForm.expectedCity) {
      return wx.showToast({ title: '请选择期望城市', icon: 'none' });
    }
    if (!basicForm.expectedSalary) {
      return wx.showToast({ title: '请选择期望薪资', icon: 'none' });
    }
    this.markCompleted(0);
    this.saveState();
    wx.showToast({ title: '基本信息已保存 → Step 1', icon: 'success' });
    setTimeout(() => this.nextStep(), 800);
  },

  // ===== Step 1: 画像诊断 =====

  onProfileInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`profileForm.${field}`]: e.detail.value });
  },

  async submitProfile() {
    const { profileForm } = this.data;
    if (!profileForm.education) {
      return wx.showToast({ title: '请选择学历', icon: 'none' });
    }
    if (!profileForm.target) {
      return wx.showToast({ title: '请选择求职目标', icon: 'none' });
    }
    wx.showLoading({ title: 'AI 诊断中...' });
    try {
      const res = await this._api('/jobpilot/profile-diagnose', 'POST', profileForm);
      if (res.ok) {
        this.setData({ profileResult: res });
        this.markCompleted(1);
        this.saveState();
        wx.hideLoading();
        wx.showToast({ title: '诊断完成 → 自动到 Step 2', icon: 'success' });
        setTimeout(() => this.nextStep(), 800);
      } else {
        throw new Error(res.error || '诊断失败');
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: this._errMsg(err, '诊断失败'), icon: 'none' });
    }
  },

  // ===== Step 2: 项目提取 =====

  onProjectInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`projectForm.${field}`]: e.detail.value });
  },

  // R134: project-score 改 async (POST → 写 task + poll status + 读 result)
  async submitProject() {
    const { projectForm } = this.data;
    if (!projectForm.name || projectForm.name.length < 2) {
      return wx.showToast({ title: '请填项目名 (至少 2 字)', icon: 'none' });
    }
    wx.showLoading({ title: 'AI 评估中...' });
    try {
      // 1. POST async → 返 task_id
      const createRes = await this._api('/jobpilot/project-score-async', 'POST', projectForm);
      if (!createRes.ok || !createRes.task_id) {
        throw new Error(createRes.error || '提交失败');
      }
      const taskId = createRes.task_id;

      // 2. poll 查 status (每 2s 一次, 最多 60s)
      let task = null;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        task = await this._api(`/tasks/${taskId}`, 'GET');
        if (task?.code === 0 && (task.data.status === 'done' || task.data.status === 'failed')) break;
      }

      if (!task || task.code !== 0 || task.data.status !== 'done') {
        throw new Error(task?.data?.error || 'AI 评估超时,稍后看 5 步追踪');
      }

      // 3. task.result 含完整 AI 评分, 转成原 sync 格式 (字段名匹配)
      const result = { ok: true, ...task.data.result };
      this.setData({ projectResult: result });
      this.markCompleted(2);
      this.saveState();
      wx.hideLoading();
      wx.showToast({ title: '评估完成 → 自动到 Step 3', icon: 'success' });
      setTimeout(() => this.nextStep(), 800);
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: this._errMsg(err, '评估失败'), icon: 'none' });
    }
  },

  // ===== Step 3: 岗位匹配 =====

  async doMatch() {
    if (!this.data.matchResumeId) {
      return wx.showToast({ title: '请先去首页填写简历', icon: 'none' });
    }
    this.setData({ matchLoading: true });
    wx.showLoading({ title: '匹配中...' });
    try {
      const res = await this._api('/match/', 'POST', {
        resume_id: Number(this.data.matchResumeId),
      });
      if (res.code === 0) {
        this.setData({ matchResults: res.data.results || [] });
        this.markCompleted(3);
        wx.hideLoading();
      } else {
        throw new Error(res.error || '匹配失败');
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: this._errMsg(err, '匹配失败'), icon: 'none' });
    }
    this.setData({ matchLoading: false });
  },

  async applyToJob(e) {
    const { jobid } = e.currentTarget.dataset;
    wx.showLoading({ title: '标记投递...' });
    try {
      const res = await this._api('/match/apply', 'POST', { job_id: Number(jobid) });
      if (res.code === 0) {
        wx.hideLoading();
        const msg = res.data.status === 'already_applied' ? '已投递过' : '已标记投递';
        wx.showToast({ title: msg, icon: 'success' });
        if (this.data.currentStep === 4) this.loadApplications();
      } else {
        throw new Error(res.error || '标记失败');
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: this._errMsg(err, '标记失败'), icon: 'none' });
    }
  },

  // ===== Step 4: 简历生成 =====

  async generateResume() {
    if (!this.data.generateResumeId) {
      return wx.showToast({ title: '请先去首页填写简历', icon: 'none' });
    }
    this.setData({ generateLoading: true });
    wx.showLoading({ title: 'AI 生成中...' });
    try {
      const res = await this._api('/resume/generate', 'POST', {
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
        this.markCompleted(4);
        wx.hideLoading();
        wx.showToast({ title: '生成完成 → 自动到 Step 5', icon: 'success' });
        setTimeout(() => this.nextStep(), 800);
      } else {
        throw new Error(res.error || '生成失败');
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: this._errMsg(err, '生成失败'), icon: 'none' });
    }
    this.setData({ generateLoading: false });
  },

  /**
   * R140: 复制简历 markdown 到剪贴板 (用户可贴到 Notion/邮箱/招聘网站)
   */
  copyResumeMarkdown() {
    const resume = this.data.generateResult && this.data.generateResult.resume;
    if (!resume) {
      return wx.showToast({ title: '没有简历内容', icon: 'none' });
    }
    wx.setClipboardData({
      data: resume,
      success: () => {
        // 按钮状态变 "已复制" + 绿色 (CSS .copy-md-btn.copied)
        this.setData({ copied: true });
        wx.showToast({ title: '已复制到剪贴板', icon: 'success' });
        // 2 秒后恢复
        setTimeout(() => this.setData({ copied: false }), 2000);
      },
      fail: () => {
        wx.showToast({ title: '复制失败,请手动选择', icon: 'none' });
      },
    });
  },

  // ===== Step 5: 投递追踪 =====

  async loadApplications() {
    this.setData({ trackerLoading: true });
    try {
      const res = await this._api('/match/applications', 'GET');
      if (res.code === 0) {
        this.setData({ applications: res.data.applications || [], trackerLoading: false });
        this.markCompleted(5);
      } else {
        throw new Error(res.error || '加载失败');
      }
    } catch (err) {
      this.setData({ trackerLoading: false });
      wx.showToast({ title: this._errMsg(err, '加载失败'), icon: 'none' });
    }
  },

  async updateAppStatus(e) {
    const { id, status } = e.currentTarget.dataset;
    wx.showLoading({ title: '更新中...' });
    try {
      const res = await this._api(`/match/applications/${id}`, 'PATCH', { status });
      wx.hideLoading();
      if (res.code === 0) {
        wx.showToast({ title: '已更新', icon: 'success' });
        this.loadApplications();
      } else {
        throw new Error(res.error || '更新失败');
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: this._errMsg(err, '更新失败'), icon: 'none' });
    }
  },

  // ===== 工具 =====

  /**
   * API 调用 (统一鉴权 + 错误处理)
   * 修复: 用 wx.getStorageSync('token') 而不是 app.globalData.userToken
   */
  _api(path, method, body) {
    return request({ url: path, method, data: body });
  },

  /**
   * 统一错误信息
   * 区分网络错 / API 错 / 业务错
   */
  _errMsg(err, fallback) {
    if (!err) return fallback;
    const msg = err.message || String(err);
    if (/timeout|network|request:fail/i.test(msg)) return '网络出错,请检查后端';
    if (/401|未授权|token/i.test(msg)) return '请重新登录';
    if (/404/i.test(msg)) return '接口不存在,需后端部署';
    if (msg.length > 30) return fallback;
    return msg;
  },
});