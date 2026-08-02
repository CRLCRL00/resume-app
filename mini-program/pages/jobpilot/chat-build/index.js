/**
 * R-JobPilot-v2 W3: 对话建简历页面 (Step 2.5)
 *
 * 状态机:
 *   !started        → 选画像 (image picker)
 *   started, !done  → 跟 AI 来回对话 (5-8 轮)
 *   done            → 显示完成 banner + STAR 故事点 + 回到 jobpilot/index
 *
 * API:
 *   POST /api/jobpilot/v1/chat-build/start    创建 session + 第一问
 *   POST /api/jobpilot/v1/chat-build/next     接收用户回答 + 下一问
 *   POST /api/jobpilot/v1/chat-build/complete 强制完成 + 输出 STAR
 */

const { request } = require('../../../utils/request');

const IMAGE_OPTIONS = [
  { value: 'ai_collaboration_project_lead', icon: '🤖', label: 'AI 协作负责人' },
  { value: 'traditional_cs_fresh', icon: '💻', label: '传统 CS 应届' },
  { value: 'career_transition', icon: '🔄', label: '转型求职' },
  { value: 'algorithm_research', icon: '📊', label: '算法 / 研究' },
];

Page({
  data: {
    // 启动态
    imageOptions: IMAGE_OPTIONS,
    selectedImage: '',
    started: false,
    loading: false,

    // 对话态
    sessionId: '',
    image: '',
    imageLabel: '',
    imageIcon: '',
    currentFieldId: '',
    recommendedRounds: 7,
    currentRound: 0,
    messages: [],           // [{id, role, content, hint}]
    userAnswer: '',
    lastMessageId: '',

    // 完成态
    completed: false,
    storyPoints: [],
  },

  onLoad(options) {
    // R-JobPilot-v2 W3: 支持从 jobpilot/index 预选画像 (从 query 拿)
    if (options && options.image) {
      const matched = IMAGE_OPTIONS.find((o) => o.value === options.image);
      if (matched) {
        this.setData({
          selectedImage: matched.value,
          imageLabel: matched.label,
          imageIcon: matched.icon,
        });
      }
    }
  },

  /**
   * 选画像
   */
  onPickImage(e) {
    const { value } = e.currentTarget.dataset;
    const matched = IMAGE_OPTIONS.find((o) => o.value === value);
    if (!matched) return;
    this.setData({
      selectedImage: matched.value,
      imageLabel: matched.label,
      imageIcon: matched.icon,
    });
  },

  /**
   * 启动对话: POST /api/jobpilot/v1/chat-build/start
   */
  async onStart() {
    if (!this.data.selectedImage || this.data.loading) return;

    this.setData({ loading: true });
    try {
      const res = await request({
        url: '/api/jobpilot/v1/chat-build/start',
        method: 'POST',
        data: {
          image: this.data.selectedImage,
          answers: this._answersFromForm(),
        },
      });

      if (res && res.sessionId) {
        const firstMsg = this._mkMsg('assistant', res.firstQuestion, res.hint || '');
        this.setData({
          sessionId: res.sessionId,
          image: res.image,
          recommendedRounds: res.recommendedRounds,
          currentFieldId: res.currentFieldId,
          messages: [firstMsg],
          started: true,
          loading: false,
          lastMessageId: firstMsg.id,
        });
      } else {
        throw new Error(res && res.message ? res.message : '启动失败');
      }
    } catch (err) {
      this.setData({ loading: false });
      this._toast(this._errMsg(err, '启动失败'));
    }
  },

  /**
   * 输入变化
   */
  onInputChange(e) {
    this.setData({ userAnswer: e.detail.value });
  },

  /**
   * 提交回答: 循环 next 直到 isComplete
   */
  async onSubmit() {
    const answer = (this.data.userAnswer || '').trim();
    if (!answer || this.data.loading || this.data.completed) return;

    // 1) 先把用户消息 push 到 UI
    const userMsg = this._mkMsg('user', answer);
    this.setData({
      messages: [...this.data.messages, userMsg],
      userAnswer: '',
      loading: true,
      lastMessageId: userMsg.id,
    });

    try {
      // 2) 调 next API
      const res = await request({
        url: '/api/jobpilot/v1/chat-build/next',
        method: 'POST',
        data: {
          sessionId: this.data.sessionId,
          userAnswer: answer,
        },
      });

      if (res && res.nextQuestion) {
        const aiMsg = this._mkMsg('assistant', res.nextQuestion, res.hint || '');
        const newMessages = [...this.data.messages, aiMsg];
        this.setData({
          messages: newMessages,
          currentFieldId: res.nextFieldId,
          currentRound: res.currentRound,
          loading: false,
          lastMessageId: aiMsg.id,
        });

        // 3) 如果 isComplete → 调 complete 拿 storyPoints
        if (res.isComplete) {
          await this._complete();
        }
      } else {
        throw new Error(res && res.message ? res.message : '获取问题失败');
      }
    } catch (err) {
      this.setData({ loading: false });
      this._toast(this._errMsg(err, '提交失败'));
    }
  },

  /**
   * 完成: 调 complete API 拿 STAR 故事点
   */
  async _complete() {
    try {
      const res = await request({
        url: '/api/jobpilot/v1/chat-build/complete',
        method: 'POST',
        data: { sessionId: this.data.sessionId },
      });

      if (res && res.storyPoints) {
        this.setData({
          completed: true,
          storyPoints: res.storyPoints || [],
          loading: false,
        });
      }
    } catch (err) {
      // 不阻塞完成态, 仍标记 completed
      this.setData({
        completed: true,
        storyPoints: [],
        loading: false,
      });
      this._toast('STAR 故事点获取失败,但对话已完成');
    }
  },

  /**
   * 回到 jobpilot/index
   */
  goBack() {
    wx.navigateBack({ delta: 1 });
  },

  // ===== 内部工具 =====

  _mkMsg(role, content, hint) {
    return {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      content,
      hint: hint || '',
    };
  },

  /**
   * 从 wx.storage 拿已填的画像诊断 answers (跟 jobpilot/index 持久化格式一致)
   * 没用上也不会报错 (fallback 空对象)
   */
  _answersFromForm() {
    try {
      const saved = wx.getStorageSync('jobpilot_state_v2');
      if (!saved) return {};
      const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
      const profile = parsed.profileForm || {};
      return {
        education: profile.education || '',
        aiAbility: profile.aiAbility || '',
        projects: profile.projects || '',
        target: profile.target || '',
        timeline: profile.timeline || '',
      };
    } catch (_e) {
      return {};
    }
  },

  _toast(msg) {
    wx.showToast({ title: msg, icon: 'none' });
  },

  _errMsg(err, fallback) {
    if (!err) return fallback;
    const msg = err.message || String(err);
    if (/timeout|network|request:fail/i.test(msg)) return '网络出错,请检查后端';
    if (/401|未授权|token/i.test(msg)) return '请重新登录';
    if (/404/i.test(msg)) return '接口不存在,需后端部署';
    if (/500/i.test(msg)) return '后端报错,看 Sentry';
    if (msg.length > 30) return fallback;
    return msg;
  },
});