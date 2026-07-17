/**
 * R97 大屏填简历 — AI 对话式 (气泡)
 *
 * 设计: 推翻传统表单, 用 chat-like 气泡推进 5 步
 *   - AI 提问 (左灰气泡)
 *   - 用户回答 (右绿气泡)
 *   - 浮动预览卡片 (实时拼简历)
 *
 * 兼容:
 *   - 5 步流程不变 (基本/教育/工作/期望/技能)
 *   - calcCompletion 不变
 *   - submit 复用 form 提交逻辑
 *   - 自适应 ≥1024 → 左 chat + 右 sticky preview; 否则 chat 顶满, preview 在底部
 */

// 5 段对话脚本 (step → 顺序问题列表)
// 每个问题: { ai: '...', field: 'name' | 'gender' | ..., type: 'text' | 'chips' | 'picker' | 'dateRange' | 'textarea', options?: [...] }
const CHAT_SCRIPT = [
  // Step 0: 基本信息 (4 问)
  { step: 0, stepName: '基本信息', ai: '嗨, 我是你的简历助手 ✨\n先告诉我你的名字吧?', field: 'name', type: 'text' },
  { step: 0, ai: '好的, 请问性别是?', field: 'gender', type: 'chips', options: [{label:'男',value:'male'},{label:'女',value:'female'},{label:'其他',value:'other'}] },
  { step: 0, ai: '最高学历呢?', field: 'degree', type: 'picker', options: ['高中','大专','本科','硕士','博士'] },
  { step: 0, ai: '留个手机号吗? (选填, 用作简历联系方式)', field: 'phone', type: 'text', optional: true },
  // Step 1: 教育经历 (3 问 + 多条)
  { step: 1, stepName: '教育经历', ai: '你的毕业院校和专业是?', field: 'edu.school', type: 'text' },
  { step: 1, ai: '起止时间呢?\n(例: 2020-09 至 2024-06, 或至今)', field: 'edu.date', type: 'dateRange' },
  { step: 1, ai: '+ 还有其他教育经历吗?', field: 'edu.addMore', type: 'addMore' },
  // Step 2: 工作经历
  { step: 2, stepName: '工作经历', ai: '在哪家公司工作过? 职位是?', field: 'exp.work', type: 'work' },
  { step: 2, ai: '时间段? (例: 2021-07 至 至今)', field: 'exp.date', type: 'dateRange' },
  { step: 2, ai: '简述一下工作内容 (一两句话)?', field: 'exp.desc', type: 'textarea' },
  { step: 2, ai: '+ 还有其他工作经历吗?', field: 'exp.addMore', type: 'addMore' },
  // Step 3: 求职期望
  { step: 3, stepName: '求职期望', ai: '你希望去哪个城市工作?', field: 'expected.city', type: 'text' },
  { step: 3, ai: '想做什么岗位?', field: 'expected.position', type: 'text' },
  { step: 3, ai: '期望薪资范围 (K)?', field: 'expected.salary', type: 'salaryRange' },
  // Step 4: 技能
  { step: 4, stepName: '技能', ai: '最后, 列出你的技能 (逗号分隔)\n例: React, Node.js, Python', field: 'skills', type: 'textarea' },
];

const STEP_LABELS = ['基本信息', '教育经历', '工作经历', '求职期望', '技能'];
const STEP_HINTS = ['姓名性别学历手机', '学校专业起止', '公司职位时间', '城市岗位薪资', '技能列表'];

function emptyForm() {
  return {
    name: '', gender: '', degree: '', phone: '',
    educations: [{ school: '', major: '', degree: '', start: '', end: '' }],
    experiences: [{ company: '', title: '', start: '', end: '', desc: '' }],
    expected: { city: '', position: '', salary_min: '', salary_max: '' },
    skills: [],
  };
}

function calcCompletion(form, skillsCount) {
  let total = 0;
  if (form.name?.trim()) total += 10;
  if (form.gender) total += 5;
  if (form.degree) total += 5;
  if (form.phone?.trim()) total += 5;
  const e0 = form.educations?.[0] || {};
  if (e0.school?.trim()) total += 10;
  if (e0.major?.trim()) total += 5;
  if (e0.start?.trim() && e0.end?.trim()) total += 5;
  const x0 = form.experiences?.[0] || {};
  if (x0.company?.trim()) total += 10;
  if (x0.title?.trim()) total += 5;
  if (x0.start?.trim() && x0.end?.trim()) total += 5;
  if (x0.desc?.trim()) total += 5;
  if (form.expected?.city?.trim()) total += 7;
  if (form.expected?.position?.trim()) total += 7;
  if (form.expected?.salary_min?.toString().trim()) total += 3;
  if (form.expected?.salary_max?.toString().trim()) total += 3;
  if (skillsCount > 0) total += 10;
  return Math.min(100, total);
}

// wx Page 包装 (node test 环境无 wx, 用 stub)
// 提前 export 给 test (在 PageImpl 之前)
module.exports = { _test: { emptyForm, calcCompletion, STEP_LABELS, STEP_HINTS, CHAT_SCRIPT } };

const PageImpl = typeof Page !== 'undefined'
  ? Page
  : function (config) { if (module.exports._test) module.exports._test._pageConfig = config; };

PageImpl({
  data: {
    wide: false,
    messages: [], // [{role:'ai'|'user', text:'...', field?:...}]
    chatStep: 0,  // 当前对话脚本索引
    step: 0,     // 当前 form step (用于预览标签)
    stepLabels: STEP_LABELS,
    stepHints: STEP_HINTS,
    chatScript: CHAT_SCRIPT,
    currentInput: '',
    currentField: '',
    currentType: '',
    currentOptions: null,
    currentDateStart: '',
    currentDateEnd: '',
    currentSalaryMin: '',
    currentSalaryMax: '',
    form: emptyForm(),
    skillsCount: 0,
    completion: 0,
    done: false,
  },

  onLoad() {
    const win = (wx.getWindowInfo && wx.getWindowInfo()) || {};
    const wide = (win.windowWidth || 0) >= 1024;
    this.setData({ wide });
    try {
      wx.onWindowResize((res) => {
        const w = (res && res.windowWidth) || 0;
        if (w >= 1024 !== this.data.wide) this.setData({ wide: w >= 1024 });
      });
    } catch (_) {}
    // 启动对话: push 第一条 AI 消息
    this._pushAI();
  },

  onUnload() {
    try { wx.offWindowResize && wx.offWindowResize(); } catch (_) {}
  },

  // ─── 推进对话 ───────────────────────────────────────
  _pushAI() {
    if (this.data.chatStep >= CHAT_SCRIPT.length) {
      // 完成, 显示提交按钮
      this.setData({ done: true });
      return;
    }
    const script = CHAT_SCRIPT[this.data.chatStep];
    const messages = this.data.messages.concat([{ role: 'ai', text: script.ai }]);
    this.setData({
      messages,
      currentInput: '',
      currentField: script.field,
      currentType: script.type,
      currentOptions: script.options || null,
      currentDateStart: '',
      currentDateEnd: '',
      currentSalaryMin: '',
      currentSalaryMax: '',
      step: script.step,
      stepName: script.stepName || '',
    });
    this._scrollToBottom();
  },

  onInput(e) {
    this.setData({ currentInput: e.detail.value });
  },

  onDateStart(e) {
    this.setData({ currentDateStart: e.detail.value });
  },

  onDateEnd(e) {
    this.setData({ currentDateEnd: e.detail.value });
  },

  onSalaryMin(e) {
    this.setData({ currentSalaryMin: e.detail.value });
  },

  onSalaryMax(e) {
    this.setData({ currentSalaryMax: e.detail.value });
  },

  onChip(e) {
    const value = e.currentTarget.dataset.value;
    this._submitAnswer(value);
  },

  onPicker(e) {
    const idx = parseInt(e.detail.value, 10);
    const script = CHAT_SCRIPT[this.data.chatStep];
    const value = script.options?.[idx] || '';
    this._submitAnswer(value);
  },

  onSend() {
    const input = this.data.currentInput.trim();
    const script = CHAT_SCRIPT[this.data.chatStep];
    if (!input && script.type === 'text') return;
    if (!input && script.type === 'textarea') return;
    this._submitAnswer(input);
  },

  onSkip() {
    // optional 字段 (如 phone) 跳过
    this._submitAnswer('');
  },

  onAddMore() {
    // 用户点 "+ 添加" → 加条空记录, 复用当前对话
    this._submitAnswer('__add_more__');
  },

  onNoMore() {
    // 用户点 "够了, 没了" → 不加条, 进入下一个字段
    this._submitAnswer('__no_more__');
  },

  _submitAnswer(value) {
    const script = CHAT_SCRIPT[this.data.chatStep];
    // 1) push user bubble
    const messages = this.data.messages.concat([{ role: 'user', text: this._formatAnswer(value, script) }]);
    // 2) apply to form
    this._applyToForm(script, value);
    // 3) advance
    let nextChatStep = this.data.chatStep + 1;
    const form = this.data.form;
    // addMore 重复当前 step 的同类问题
    if (value === '__add_more__' && script.field === 'edu.addMore') {
      form.educations.push({ school: '', major: '', degree: '', start: '', end: '' });
      // 跳回 school 字段 (本 step 第 1 问)
      nextChatStep = this.data.chatStep - 2;
    }
    if (value === '__no_more__' && script.field === 'edu.addMore') {
      nextChatStep = this.data.chatStep + 1; // 跳过
    }
    if (value === '__add_more__' && script.field === 'exp.addMore') {
      form.experiences.push({ company: '', title: '', start: '', end: '', desc: '' });
      nextChatStep = this.data.chatStep - 2;
    }
    if (value === '__no_more__' && script.field === 'exp.addMore') {
      nextChatStep = this.data.chatStep + 1;
    }
    // 4) update
    this.setData({
      messages,
      form,
      chatStep: nextChatStep,
    }, () => {
      this._recomputeCompletion();
      this._pushAI();
    });
  },

  _formatAnswer(value, script) {
    if (value === '__add_more__') return '+ 添加一条';
    if (value === '__no_more__') return '✓ 没有了';
    if (script.field === 'gender') {
      return script.options.find(o => o.value === value)?.label || value;
    }
    if (script.field === 'degree') return value;
    if (script.field === 'edu.school') return value;
    if (script.field === 'edu.date') return `${this.data.currentDateStart || '?'} 至 ${this.data.currentDateEnd || '?'}`;
    if (script.field === 'exp.work') return value;
    if (script.field === 'exp.date') return `${this.data.currentDateStart || '?'} 至 ${this.data.currentDateEnd || '?'}`;
    if (script.field === 'exp.desc') return value;
    if (script.field === 'expected.salary') return `${this.data.currentSalaryMin || '?'}-${this.data.currentSalaryMax || '?'} K`;
    return value;
  },

  _applyToForm(script, value) {
    const form = JSON.parse(JSON.stringify(this.data.form));
    switch (script.field) {
      case 'name': form.name = value; break;
      case 'gender': form.gender = value; break;
      case 'degree': form.degree = value; break;
      case 'phone': form.phone = value; break;
      case 'edu.school': {
        const last = form.educations.length - 1;
        form.educations[last] = { ...form.educations[last], school: value };
        break;
      }
      case 'edu.date': {
        const last = form.educations.length - 1;
        form.educations[last] = {
          ...form.educations[last],
          start: this.data.currentDateStart,
          end: this.data.currentDateEnd,
          major: form.educations[last].major || '专业',
        };
        break;
      }
      case 'exp.work': {
        const last = form.experiences.length - 1;
        // 简化: value = "公司 · 职位"
        const [company, ...rest] = (value || '').split(/[·,，]/).map(s => s.trim());
        form.experiences[last] = {
          ...form.experiences[last],
          company: company || value,
          title: rest.join(' · ') || '员工',
        };
        break;
      }
      case 'exp.date': {
        const last = form.experiences.length - 1;
        form.experiences[last] = {
          ...form.experiences[last],
          start: this.data.currentDateStart,
          end: this.data.currentDateEnd,
        };
        break;
      }
      case 'exp.desc': {
        const last = form.experiences.length - 1;
        form.experiences[last] = { ...form.experiences[last], desc: value };
        break;
      }
      case 'expected.city': form.expected.city = value; break;
      case 'expected.position': form.expected.position = value; break;
      case 'expected.salary': {
        form.expected.salary_min = this.data.currentSalaryMin;
        form.expected.salary_max = this.data.currentSalaryMax;
        break;
      }
      case 'skills': {
        const skills = (value || '').split(/[,，]/).map(s => s.trim()).filter(Boolean);
        form.skills = skills;
        this.setData({ skillsCount: skills.length });
        break;
      }
    }
    this.setData({ form });
  },

  _recomputeCompletion() {
    const completion = calcCompletion(this.data.form, this.data.skillsCount);
    this.setData({ completion });
  },

  _scrollToBottom() {
    setTimeout(() => {
      try {
        wx.pageScrollTo({ selector: '.chat-end', duration: 200 });
      } catch (_) {
        wx.pageScrollTo({ scrollTop: 99999, duration: 200 });
      }
    }, 50);
  },

  onSubmit() {
    // 复用原 form.submit 逻辑
    const raw = this.data.form;
    const form = {
      ...raw,
      name: raw.name?.trim() || '求职者',
      gender: raw.gender || 'male',
      degree: raw.degree || '本科',
      phone: raw.phone?.trim() || '',
      educations: raw.educations?.length
        ? raw.educations
        : [{ school: '待补充', major: '待补充', degree: '本科', start: '2020-01', end: '至今' }],
      experiences: raw.experiences?.length
        ? raw.experiences
        : [{ company: '待补充', title: '员工', start: '2021-01', end: '至今', desc: '工作内容待补充' }],
      skills: raw.skills?.length ? raw.skills : ['待补充'],
      expected: {
        city: raw.expected?.city?.trim() || '深圳',
        position: raw.expected?.position?.trim() || '岗位待定',
        salary_min: parseInt(raw.expected?.salary_min, 10) || 0,
        salary_max: parseInt(raw.expected?.salary_max, 10) || Math.max(parseInt(raw.expected?.salary_min, 10) || 0, 10),
      },
    };

    wx.showLoading({ title: '正在生成简历...', mask: true });

    const isWx = typeof wx !== 'undefined';
    const { request } = isWx
      ? require('../../../utils/request')
      : { request: async () => ({ data: { data: { resume_id: 1 } } }) };

    request({ url: '/resume/save', method: 'POST', data: { source_form: form } })
      .then((saveRes) => request({ url: '/resume/generate', method: 'POST', data: { resume_id: saveRes.data.data.resume_id } }))
      .then(() => {
        wx.hideLoading();
        wx.redirectTo({ url: '/pages/preview/preview' });
      })
      .catch(() => wx.hideLoading());
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  },
});

// _test 已提前 export (顶部)