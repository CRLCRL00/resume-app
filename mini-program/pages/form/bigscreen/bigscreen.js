/**
 * R116 抖音式大屏填简历
 *
 * 推翻 R98 星图: 用竖滑 scroll-view + 字段卡片 + AI 头像大字
 * 5 星座纵向切换 (sections = CONSTELLATIONS 派生)
 * 字段卡片横滑 (feed-fields)
 * R115 wizard + 后端 deepseek 仍工作
 */

// 5 个星座, 每个含字段 (id, label, type, options?, ai 文案)
const CONSTELLATIONS = [
  {
    id: 'basic', name: '基本信息', color: '#6366f1', colorRgb: '99,102,241',
    fields: [
      { id: 'name', label: '姓名', type: 'text', required: true,
        ai: '嗨, 先告诉我你的名字吧?' },
      { id: 'gender', label: '性别', type: 'chips', options: [{label:'男',value:'male'},{label:'女',value:'female'},{label:'其他',value:'other'}], required: true,
        ai: '好的, 请问性别是?' },
      { id: 'degree', label: '学历', type: 'picker', options: ['高中','大专','本科','硕士','博士'], required: true,
        ai: '最高学历呢?' },
      { id: 'phone', label: '手机', type: 'text', optional: true,
        ai: '留个手机号吗? (选填, 用作简历联系方式)' },
    ],
  },
  {
    id: 'education', name: '教育', color: '#06b6d4', colorRgb: '6,182,212',
    fields: [
      { id: 'edu_school', label: '学校', type: 'text', required: true,
        ai: '你的毕业院校是?' },
      { id: 'edu_major', label: '专业', type: 'text', required: true,
        ai: '专业呢?' },
      { id: 'edu_start', label: '起', type: 'text', placeholder: '2020-09', required: true,
        ai: '起始时间 (例: 2020-09)?' },
      { id: 'edu_end', label: '止', type: 'text', placeholder: '至今', required: true,
        ai: '结束时间 (至今 或 YYYY-MM)?' },
    ],
  },
  {
    id: 'work', name: '工作', color: '#f59e0b', colorRgb: '245,158,11',
    fields: [
      { id: 'work_company', label: '公司', type: 'text', required: true,
        ai: '在哪家公司工作过?' },
      { id: 'work_title', label: '职位', type: 'text', required: true,
        ai: '职位是什么?' },
      { id: 'work_start', label: '起', type: 'text', placeholder: '2021-07', required: true,
        ai: '起始时间?' },
      { id: 'work_end', label: '止', type: 'text', placeholder: '至今', required: true,
        ai: '结束时间?' },
      { id: 'work_desc', label: '描述', type: 'textarea',
        ai: '简述工作内容 (一两句话)?' },
    ],
  },
  {
    id: 'expected', name: '期望', color: '#ec4899', colorRgb: '236,72,153',
    fields: [
      { id: 'exp_city', label: '城市', type: 'text', required: true,
        ai: '想去哪个城市工作?' },
      { id: 'exp_position', label: '岗位', type: 'text', required: true,
        ai: '想做什么岗位?' },
      { id: 'exp_salary_min', label: '薪资下限 K', type: 'text', placeholder: '15',
        ai: '期望薪资下限 (K)?' },
      { id: 'exp_salary_max', label: '薪资上限 K', type: 'text', placeholder: '25',
        ai: '期望薪资上限 (K)?' },
    ],
  },
  {
    id: 'skills', name: '技能', color: '#eab308', colorRgb: '234,179,8',
    fields: [
      { id: 'skills_list', label: '技能 (逗号分隔)', type: 'textarea', placeholder: 'React, Node.js, Python', required: true,
        ai: '最后, 列出你的技能 (逗号分隔)' },
    ],
  },
];

// R115 fix: 派生字段顺序 + 总数, 避免硬编码 14 (实际 18 字段: 4+4+5+4+1)
const FIELD_ORDER = CONSTELLATIONS.flatMap((c) => c.fields.map((f) => f.id));
const FIELD_COUNT = FIELD_ORDER.length;

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

// R118 T1: 拼接简历 markdown
function _buildResumeMarkdown(form, skills) {
  if (!form) return '';
  const lines = [];
  const name = form.name || '未命名';
  const gender = form.gender === 'male' ? '男' : form.gender === 'female' ? '女' : form.gender || '';
  const degree = form.degree || '';
  const phone = form.phone || '';
  lines.push(`# ${name}`);
  if (gender || degree) lines.push(`${gender}${degree ? ' · ' + degree : ''}`);
  if (phone) lines.push(`📱 ${phone}`);
  lines.push('');
  const e0 = (form.educations && form.educations[0]) || {};
  if (e0.school) {
    lines.push('## 🎓 教育');
    lines.push(`**${e0.school}** · ${e0.major || ''}${e0.degree ? ' · ' + e0.degree : ''}`);
    if (e0.start || e0.end) lines.push(`${e0.start || ''} - ${e0.end || ''}`);
    lines.push('');
  }
  const x0 = (form.experiences && form.experiences[0]) || {};
  if (x0.company) {
    lines.push('## 💼 工作');
    lines.push(`**${x0.title || ''}** @ ${x0.company}`);
    if (x0.start || x0.end) lines.push(`${x0.start || ''} - ${x0.end || ''}`);
    if (x0.desc) lines.push(`> ${x0.desc}`);
    lines.push('');
  }
  const exp = form.expected || {};
  if (exp.city || exp.position) {
    lines.push('## 🎯 期望');
    const sal = (exp.salary_min && exp.salary_max) ? `${exp.salary_min}-${exp.salary_max}K` : '';
    lines.push(`${exp.position || ''} · ${exp.city || ''}${sal ? ' · ' + sal : ''}`);
    lines.push('');
  }
  if (skills && skills.length) {
    lines.push('## ✨ 技能');
    lines.push(skills.join(' · '));
  }
  return lines.join('\n');
}

// R118 T2: 计算 5 维度能力分数 (0-100)
function _calcRadarScores(form, skillsCount) {
  const score = (obj, fields) => {
    let filled = 0;
    for (const f of fields) {
      const v = obj && obj[f];
      if (v && String(v).trim()) filled++;
    }
    return Math.round((filled / fields.length) * 100);
  };
  const f = form || {};
  const e0 = (f.educations && f.educations[0]) || {};
  const x0 = (f.experiences && f.experiences[0]) || {};
  const exp = f.expected || {};
  return {
    basic: score({ name: f.name, gender: f.gender, degree: f.degree, phone: f.phone },
                 ['name', 'gender', 'degree', 'phone']),
    education: score(e0, ['school', 'major', 'start', 'end']),
    work: score(x0, ['company', 'title', 'start', 'end', 'desc']),
    expected: score(exp, ['city', 'position', 'salary_min', 'salary_max']),
    skills: skillsCount >= 3 ? 100 : skillsCount >= 1 ? 60 : 0,
  };
}

module.exports = {
  _test: {
    emptyForm, calcCompletion, CONSTELLATIONS, FIELD_ORDER, FIELD_COUNT,
    _buildResumeMarkdown, _calcRadarScores, // R118 导出
  },
};

// ─────────────────────────────────────────────────────────
// Page 注册 (用 stub 兼容 node test)
// ─────────────────────────────────────────────────────────
const PageImpl = typeof Page !== 'undefined'
  ? Page
  : function (config) { if (module.exports._test) module.exports._test._pageConfig = config; };

PageImpl({
  data: {
    wide: false,
    // R116: 竖滑 feed 状态
    currentSection: 0,
    currentFieldIndex: 0,
    currentFieldId: '',
    currentFieldPrompt: '',
    sections: [],
    form: emptyForm(),
    skillsCount: 0,
    completion: 0,
    // Modal 状态 (保留 R99+R114+R115 弹窗兜底)
    modalVisible: false,
    modalField: null,
    modalFieldLabel: '',
    modalFieldAi: '',
    modalConstId: '',
    modalConstColor: '#6366f1',
    modalValue: '',
    modalOptions: null,
    modalPlaceholder: '',
    // R114 T2: AI 多轮对话状态
    aiHistory: [],
    aiFollowup: '',
    aiSuggestion: '',
    aiBusy: false,
    aiError: '',
    aiRequestSeq: 0, // generation token, 每次请求 ++, 过期响应丢弃
    aiScrollTop: 0,
    // R107 T2: 完成度数字脉冲 + 阈值变色 (保留 dead state)
    numTier: 'low',
    bumpTick: 0,
    // R115: Wizard 模式状态
    wizardMode: false,              // 是否在 wizard 模式
    wizardCurrentField: '',         // 当前正在问的字段 id
    wizardNextQuestion: '',         // AI 给的提问
    wizardHint: '',                 // AI 给的提示
    wizardProgress: 0,              // 已答字段数 (0-FIELD_COUNT)
    wizardTotal: FIELD_COUNT,       // 总字段数 (R115 fix: 从 CONSTELLATIONS 派生, 非硬编码 14)
    wizardAnswered: [],             // [{fieldId, value}, ...]
    wizardIsComplete: false,        // AI 判当前字段是否完成
    wizardIsLoading: false,         // AI 调用 in-flight
    // R117: Tinder 划卡 — AI 推荐答案
    recommendations: [],             // [{value, reason}, ...] AI 给的 3 个推荐
    currentRecommendationIdx: 0,    // 当前显示的推荐 index
    currentRecommendation: null,     // 预计算的当前推荐对象 (避免 wxml inline array index, R106b 教训)
    // R118 T1: 简历实时预览
    resumeMarkdown: '',              // 每填字段实时拼接的 markdown 简历
    // R118 T2: 技能雷达图
    radarScores: { basic: 0, education: 0, work: 0, expected: 0, skills: 0 },  // 5 维 0-100 分
    radarLabels: [
      { id: 'basic', name: '基础' },
      { id: 'education', name: '教育' },
      { id: 'work', name: '工作' },
      { id: 'expected', name: '期望' },
      { id: 'skills', name: '技能' },
    ],
  },

  onLoad() {
    const win = (wx.getWindowInfo && wx.getWindowInfo()) || {};
    const wide = (win.windowWidth || 0) >= 1024;
    const width = win.windowWidth || 375;
    const height = win.windowHeight || 667;
    const dpr = (win.pixelRatio || 2);
    this._initLayout(width, height, wide, dpr);
  },

  onShow() {
    // R116: 不再需要 _drawLines (无粒子无 canvas)
  },

  onUnload() {
    // R114 T2 fix (Important #2): 页面卸载清 debounce timer + 作废在飞请求
    if (this._aiDebounceTimer) {
      clearTimeout(this._aiDebounceTimer);
      this._aiDebounceTimer = null;
    }
    this._aiRequestSeq = (this._aiRequestSeq || 0) + 1;
    try { wx.offWindowResize && wx.offWindowResize(); } catch (_) {}
    // R115: 清 wizard 状态
    this.setData({
      wizardMode: false,
      wizardCurrentField: '',
      wizardNextQuestion: '',
      wizardHint: '',
      wizardProgress: 0,
      wizardAnswered: [],
      wizardIsComplete: false,
    });
  },

  /**
   * R116: 初始化 — 从 CONSTELLATIONS 派生 sections, 立即启动 wizard 让 AI 主动引导用户
   * 删 R98 粒子布局 (R98 星点生成 + 连线 + 粒子刷新函数 全部变 no-op)
   */
  _initLayout(width, height, wide, dpr = 2) {
    this.setData({
      wide,
      currentSection: 0,
      currentFieldIndex: 0,
      currentFieldId: FIELD_ORDER[0],
      currentFieldPrompt: '点击下方输入开始填简历',
    }, () => {
      this.setData({ sections: this._buildFieldStates() });
      // R118 T1: 初始化简历预览 (空 form)
      const md = _buildResumeMarkdown(this.data.form || {}, this.data.form ? this.data.form.skills : []);
      // R118 T2: 初始化雷达分数 + 重画
      const radar = _calcRadarScores(this.data.form || {}, 0);
      this.setData({ resumeMarkdown: md, radarScores: radar });
      if (typeof setTimeout !== 'undefined') {
        setTimeout(() => this._drawRadarChart(), 200);
      }
    });
    // R116: 大屏不靠粒子交互, 立即启动 wizard (AI 主动提问)
    this._wizardStart();
  },

  /**
   * R116 fix: 预计算每个 field 的 state (filled / current / done / value)
   * 避免 WXML inline function (R106b 教训: 会断整个 view 渲染).
   * 调用时机: _initLayout / onFieldCardTap / _writeFormAndSideEffects (form 变更后).
   */
  _buildFieldStates() {
    return CONSTELLATIONS.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      fields: c.fields.map((f) => {
        const filled = this._isFieldFilled(f.id);
        const value = this._getFieldValue(f.id) || '';
        const current = this.data.currentFieldId === f.id;
        const idx = FIELD_ORDER.indexOf(f.id);
        const done = idx < this.data.currentFieldIndex;
        return {
          ...f,
          fieldState: { filled, current, done, value },
        };
      }),
    }));
  },

  // R116: no-op (无粒子, 保留函数体兼容 R107 测试引用)
  _refreshParticleFilled() {
    // R116: 大屏无粒子, 改为 no-op
  },

  // R116: no-op (无粒子无 canvas 划线)
  _drawLines(width, height, dpr = 2) {
    // R116: 大屏无粒子, 改为 no-op
  },

  /**
   * R116: 字段卡片点击 → 跳到该字段的 section + field index + 启动 wizard
   */
  onFieldCardTap(e) {
    const { fieldId, sectionIdx } = e.currentTarget.dataset;
    const idx = FIELD_ORDER.indexOf(fieldId);
    if (idx < 0) return;
    // 计算该字段所在的 section index (按字段索引落入对应星座)
    let sIdx = 0;
    let fIdx = idx;
    for (let i = 0; i < CONSTELLATIONS.length; i++) {
      if (fIdx < CONSTELLATIONS[i].fields.length) {
        sIdx = i;
        break;
      }
      fIdx -= CONSTELLATIONS[i].fields.length;
    }
    const constDef = CONSTELLATIONS[sIdx];
    const fieldDef = constDef?.fields.find((f) => f.id === fieldId);
    // R114 T2 fix: 切换字段前清理 debounce timer + 作废在飞请求 (防串话)
    if (this._aiDebounceTimer) {
      clearTimeout(this._aiDebounceTimer);
      this._aiDebounceTimer = null;
    }
    this._aiRequestSeq = (this._aiRequestSeq || 0) + 1;
    this.setData({
      currentSection: sIdx,
      currentFieldIndex: idx,
      currentFieldId: fieldId,
      currentFieldPrompt: this._getFieldAiById(fieldId),
      modalVisible: true,
      modalField: fieldId,
      modalFieldLabel: fieldDef?.label || fieldId,
      modalFieldAi: this._getFieldAiById(fieldId),
      modalConstId: constDef?.id,
      modalConstColor: constDef?.color || '#6366f1',
      modalValue: this._getFieldValue(fieldId) || '',
      modalOptions: this._getFieldOptionsById(fieldId),
      modalPlaceholder: `请输入${fieldDef?.label || fieldId}`,
      // Wizard 模式
      wizardMode: true,
      wizardCurrentField: fieldId,
      wizardNextQuestion: '',
      wizardHint: '',
      wizardProgress: idx,
      wizardAnswered: this._buildAnsweredFields(idx, fieldId),
      wizardIsComplete: false,
      wizardIsLoading: true,
    }, () => {
      this.setData({ sections: this._buildFieldStates() });
      this._wizardStart();
    });
  },

  /**
   * R116 T2: 竖滑 scroll 监听 — 实时计算当前 section, 顶部进度点同步
   */
  onFeedScroll(e) {
    const { scrollTop, scrollHeight } = e.detail;
    const sectionCount = (this.data.sections || []).length;
    if (sectionCount === 0) return;
    const sectionHeight = scrollHeight / sectionCount;
    const idx = Math.round(scrollTop / sectionHeight);
    if (idx !== this.data.currentSection && idx >= 0 && idx < sectionCount) {
      this.setData({ currentSection: idx });
    }
  },

  /**
   * R116 T2: scroll-end 时 snap 到最近 section (弹性反馈)
   * 单元测试环境无 wx.createSelectorQuery, 加守卫
   */
  _snapToSection() {
    if (typeof wx === 'undefined' || !wx.createSelectorQuery) return;
    const query = wx.createSelectorQuery().in(this);
    query.select('.feed-scroll').scrollOffset();
    query.selectAll('.feed-section').boundingClientRect();
    query.exec((res) => {
      if (!res || !res[0] || !res[1] || !res[1].length) return;
      const scrollTop = res[0].scrollTop || 0;
      const sectionRects = res[1];
      // 找最近 section (假设 ideal snap 位置在顶部 + 100rpx)
      let closestIdx = 0;
      let minDist = Infinity;
      sectionRects.forEach((rect, idx) => {
        const dist = Math.abs(rect.top - 100);
        if (dist < minDist) {
          minDist = dist;
          closestIdx = idx;
        }
      });
      if (closestIdx !== this.data.currentSection) {
        const targetTop = scrollTop + sectionRects[closestIdx].top - 100;
        const q2 = wx.createSelectorQuery().in(this);
        q2.select('.feed-scroll').scrollOffset({ scrollTop: Math.max(0, targetTop) });
        q2.exec();
      }
    });
  },

  /**
   * R116: 滑到底触发 (类似抖音"加载更多"模式, 调 _snapToSection 弹性反馈)
   */
  onFeedScrollLower() {
    this._snapToSection();
  },

  /**
   * R116: 通过 fieldId 查 field 在 18 字段中的全局 index (0-17)
   */
  _getFieldIndex(fieldId) {
    return FIELD_ORDER.indexOf(fieldId);
  },

  /**
   * R116: 辅助 — 从 form 构建前 N 个 answeredFields
   */
  _buildAnsweredFields(upToIdx, currentFieldId) {
    const answered = [];
    for (let i = 0; i < upToIdx; i++) {
      const fid = FIELD_ORDER[i];
      const value = this._getFieldValue(fid);
      if (value) {
        answered.push({ fieldId: fid, fieldLabel: this._getFieldLabelById(fid), value });
      }
    }
    return answered;
  },

  /**
   * R116: 辅助 — 查字段 ai 文案
   */
  _getFieldAiById(fieldId) {
    for (const c of CONSTELLATIONS) {
      for (const f of c.fields) {
        if (f.id === fieldId) return f.ai || '';
      }
    }
    return '';
  },

  /**
   * R116: 辅助 — 查字段 options (chips/picker)
   */
  _getFieldOptionsById(fieldId) {
    for (const c of CONSTELLATIONS) {
      for (const f of c.fields) {
        if (f.id === fieldId) return f.options || null;
      }
    }
    return null;
  },

  /**
   * R116: 保留函数兼容 — wxml 不再 bindtap 粒子 (改为 onFieldCardTap)
   */
  onParticleTap(e) {
    // R116: 大屏无粒子, 改为空函数 (wxml 不再触发)
  },

  // R114 T2 fix (Nit #1): 单调递增 msg id — 避免 Date.now 同毫秒重复
  _nextAiMsgId(prefix) {
    this._aiMsgCounter = (this._aiMsgCounter || 0) + 1;
    return prefix + '-' + this._aiMsgCounter;
  },

  onModalInput(e) {
    // R115 fix: wizard 模式不需要 AI 追问 (AI 是主动提问方), 跳过 debounce + _aiSuggest
    // 否则会浪费 LLM + 污染 aiHistory + aiBusy 锁死 _wizardNext
    if (this.data.wizardMode) {
      this.setData({ modalValue: e.detail.value });
      return;
    }
    this.setData({ modalValue: e.detail.value, aiError: '' });
    // R114 T2: debounce 800ms 触发 AI 追问 (防 LLM 风暴 + 防 input 卡顿)
    if (this._aiDebounceTimer) clearTimeout(this._aiDebounceTimer);
    this._aiDebounceTimer = setTimeout(() => this._aiSuggest(), 800);
  },

  /**
   * R114 T2: AI 多轮对话 — 调 /api/ai/assist-field, 把 AI 回应写入 aiHistory/aiFollowup/aiSuggestion
   * 必须 debounce 防 LLM 风暴 (前端 onModalInput 已 setTimeout 800ms 调度)
   * 注: request() 直接 resolve 响应体 {code, data:{...}} (见 utils/request.js line 44)
   *
   * R114 T2 fix:
   *   - overrideValue: 可选, 直接传当前值 (绕过 setData 异步读旧 modalValue 问题)
   *   - seq 防竞态: 每次请求领一个 generation token, 响应回来发现 token 过期则丢弃 (防串话)
   *   - 失败兜底: LLM 返回异常 / 网络异常 → 设 aiError + 清过期 followup/suggestion
   */
  _aiSuggest(overrideValue) {
    if (this.data.aiBusy) return;
    const { modalField, modalFieldLabel, modalValue } = this.data;
    if (!modalField) return;
    // 领一个 generation token (同步, 不走 setData 异步)
    this._aiRequestSeq = (this._aiRequestSeq || 0) + 1;
    const mySeq = this._aiRequestSeq;
    this.setData({ aiBusy: true, aiError: '', aiRequestSeq: mySeq });

    const valueToSend = overrideValue !== undefined ? overrideValue : modalValue;

    // 截断 history 到最近 4 条 (避免 token 爆炸)
    const recentHistory = (this.data.aiHistory || []).slice(-4).map((m) => ({
      role: m.role,
      content: String(m.content).slice(0, 2000),
    }));

    const { request } = require('../../../utils/request');
    request({
      url: '/ai/assist-field',
      method: 'POST',
      data: {
        fieldId: modalField,
        fieldLabel: modalFieldLabel,
        currentValue: valueToSend || '',
        history: recentHistory,
      },
    }).then((res) => {
      // R114 T2 fix: 防竞态 — 过期响应 (字段已切 / modal 已关) 直接丢弃, 不写状态
      if (mySeq !== this._aiRequestSeq) return;
      // request() 直接 resolve body = {code, data:{opening, followups, suggestion}}
      const body = res || {};
      if (body.code === 0 && body.data) {
        const { opening, followups, suggestion } = body.data;
        const newAiHistory = (this.data.aiHistory || []).slice();
        // 追加 user 消息 (如果当前值还没作为 user 消息存在)
        if (valueToSend && !newAiHistory.some((m) => m.role === 'user' && m.content === valueToSend)) {
          newAiHistory.push({ role: 'user', content: valueToSend, id: this._nextAiMsgId('u') });
        }
        // 追加 AI 回应
        if (opening) {
          newAiHistory.push({ role: 'assistant', content: opening, id: this._nextAiMsgId('a') });
        }
        this.setData({
          aiHistory: newAiHistory,
          aiFollowup: (followups && followups[0]) || '',
          aiSuggestion: suggestion || '',
          aiBusy: false,
          aiError: '',
          // R114 T2 fix (Nit #3): 自动滚到底 (累加确保每轮触发 scroll-view 更新)
          aiScrollTop: (this.data.aiScrollTop || 0) + 10000,
        });
      } else {
        // LLM 返回失败 — 给用户错误提示, 清过期建议
        this.setData({
          aiBusy: false,
          aiError: 'AI 助手返回异常, 请稍后重试',
          aiFollowup: '',
          aiSuggestion: '',
        });
      }
    }).catch((err) => {
      if (mySeq !== this._aiRequestSeq) return;
      console.error('_aiSuggest failed:', err);
      this.setData({
        aiBusy: false,
        aiError: 'AI 助手暂时不可用, 请稍后重试',
        aiFollowup: '',
        aiSuggestion: '',
      });
    });
  },

  /**
   * R115: Wizard 启动 — 用户点粒子后, 调 /assist-field mode=wizard 拿第 1 问
   */
  _wizardStart() {
    const { modalField, modalFieldLabel } = this.data;
    if (!modalField) return;
    this.setData({ wizardIsLoading: true });
    this._aiRequestSeq++;
    const mySeq = this._aiRequestSeq;
    const { request } = require('../../../utils/request');
    request({
      url: '/ai/assist-field',
      method: 'POST',
      data: {
        mode: 'wizard',
        fieldId: modalField,
        fieldLabel: modalFieldLabel,
        currentValue: this.data.modalValue || '',
        answeredFields: this.data.wizardAnswered || [],
      },
    }).then((res) => {
      if (mySeq !== this._aiRequestSeq) return;
      if (res && res.code === 0 && res.data) {
        this.setData(Object.assign(
          this._buildTinderState({
            recommendations: res.data.recommendations || [],
            currentRecommendationIdx: 0,
          }),
          {
            wizardNextQuestion: res.data.nextQuestion || '',
            wizardHint: res.data.hint || '',
            wizardIsComplete: !!res.data.isComplete,
            wizardIsLoading: false,
          }
        ));
      } else {
        this.setData({ wizardIsLoading: false });
      }
    }).catch(() => {
      if (mySeq !== this._aiRequestSeq) return;
      this.setData({ wizardIsLoading: false });
    });
  },

  /**
   * R115: Wizard 推进 — 用户答完当前问, 写 form + 拿下一问 (或跳到下一字段)
   */
  _wizardNext() {
    const { modalField, modalFieldLabel, modalValue, wizardAnswered } = this.data;
    if (!modalValue || !modalValue.trim()) return;
    if (this.data.aiBusy) return;

    // 1. 写 form (R115 fix: 调 _writeFormAndSideEffects 而不是 _saveModal, 避免 modalVisible:false)
    this._writeFormAndSideEffects(modalValue.trim());

    // 2. 累加 answeredFields
    const newAnswered = (wizardAnswered || []).slice();
    newAnswered.push({ fieldId: modalField, fieldLabel: modalFieldLabel, value: modalValue.trim() });

    // 3. 计算下一字段 (R115 fix: 用 FIELD_ORDER 常量, 避免重复 flatMap)
    const idx = FIELD_ORDER.indexOf(modalField);
    const nextFieldId = idx >= 0 && idx < FIELD_ORDER.length - 1 ? FIELD_ORDER[idx + 1] : null;

    if (!nextFieldId) {
      // 全部答完
      this.setData({
        wizardProgress: newAnswered.length,
        wizardAnswered: newAnswered,
        modalVisible: false,
        wizardMode: false,
      });
      return;
    }

    // 4. 调 AI 拿下一问 (R115 fix: 显式 modalVisible: true, 保持 modal 打开给下一问)
    const nextLabel = this._getFieldLabelById(nextFieldId);
    // 算下一字段所属 section
    let sIdx = 0;
    let fRemain = idx + 1;
    for (let i = 0; i < CONSTELLATIONS.length; i++) {
      if (fRemain < CONSTELLATIONS[i].fields.length) {
        sIdx = i;
        break;
      }
      fRemain -= CONSTELLATIONS[i].fields.length;
    }
    this.setData({
      currentSection: sIdx,
      currentFieldIndex: idx + 1,
      currentFieldId: nextFieldId,
      currentFieldPrompt: this._getFieldAiById(nextFieldId),
      wizardCurrentField: nextFieldId,
      wizardProgress: newAnswered.length,
      wizardAnswered: newAnswered,
      modalField: nextFieldId,
      modalFieldLabel: nextLabel,
      modalValue: '',
      modalPlaceholder: `请输入${nextLabel}`,
      modalVisible: true,
      modalFieldAi: this._getFieldAiById(nextFieldId),
      wizardNextQuestion: '',
      wizardHint: '',
      wizardIsLoading: true,
    });

    this._aiRequestSeq++;
    const mySeq = this._aiRequestSeq;
    const { request } = require('../../../utils/request');
    request({
      url: '/ai/assist-field',
      method: 'POST',
      data: {
        mode: 'wizard',
        fieldId: nextFieldId,
        fieldLabel: nextLabel,
        currentValue: '',
        answeredFields: newAnswered,
      },
    }).then((res) => {
      if (mySeq !== this._aiRequestSeq) return;
      if (res && res.code === 0 && res.data) {
        this.setData(Object.assign(
          this._buildTinderState({
            recommendations: res.data.recommendations || [],
            currentRecommendationIdx: 0,
          }),
          {
            wizardNextQuestion: res.data.nextQuestion || '',
            wizardHint: res.data.hint || '',
            wizardIsComplete: !!res.data.isComplete,
            wizardIsLoading: false,
          }
        ));
      } else {
        this.setData({ wizardIsLoading: false });
      }
    }).catch(() => {
      if (mySeq !== this._aiRequestSeq) return;
      this.setData({ wizardIsLoading: false });
    });
  },

  /**
   * R115: 通过 fieldId 查 label
   */
  _getFieldLabelById(fieldId) {
    for (const c of CONSTELLATIONS) {
      for (const f of c.fields) {
        if (f.id === fieldId) return f.label;
      }
    }
    return fieldId;
  },

  /**
   * R114 T2 fix (Important #1): AI 失败重试 — 清 error 后重触发 _aiSuggest
   */
  onAIErrorRetry() {
    this.setData({ aiError: '' });
    this._aiSuggest();
  },

  /**
   * R114 T2: AI 建议 chip 点击 — 把 AI 建议填入 input, 然后触发新一轮 AI 追问
   * R114 T2 fix (Important #3): setData 异步 — 用 callback 保证 modalValue 已更新后再
   * 触发追问, 并直接把新值传给 _aiSuggest 避免读旧值; 先清旧 debounce timer 防重复触发.
   */
  onAISuggestionTap() {
    if (!this.data.aiSuggestion) return;
    if (this._aiDebounceTimer) {
      clearTimeout(this._aiDebounceTimer);
      this._aiDebounceTimer = null;
    }
    const newVal = this.data.aiSuggestion;
    this.setData({ modalValue: newVal, aiSuggestion: '', aiError: '' }, () => {
      this._aiSuggest(newVal);
    });
  },

  /**
   * R117: Tinder 左滑 — 不用当前推荐, 推进到下一个
   */
  onSwipeLeft() {
    this._advanceRecommendation();
  },

  /**
   * R117: Tinder 右滑 — 用当前推荐, 直接写 form + 推进下一字段
   */
  onSwipeRight() {
    const cur = (this.data.recommendations || [])[this.data.currentRecommendationIdx];
    if (!cur) return;
    // R115 fix: 用 _writeFormAndSideEffects (不关 modal) + 主动推下一字段
    // R117: recommendations 清空时 currentRecommendation 也置 null (避免 wxml 引用已清空数组)
    this.setData({
      modalValue: cur.value,
      recommendations: [],
      currentRecommendationIdx: 0,
      currentRecommendation: null,
    }, () => {
      this._writeFormAndSideEffects(cur.value);
      this._wizardNext();
    });
  },

  /**
   * R117: Tinder 上滑 — 改当前推荐 (填入 input 让用户编辑)
   */
  onSwipeUp() {
    const cur = (this.data.recommendations || [])[this.data.currentRecommendationIdx];
    if (!cur) return;
    // 推荐值填入 input, 让用户编辑后保存
    this.setData({ modalValue: cur.value });
  },

  /**
   * R117: 推进到下一个推荐 (3 个用完则清空, 让用户自己输入)
   */
  _advanceRecommendation() {
    const nextIdx = this.data.currentRecommendationIdx + 1;
    if (nextIdx >= (this.data.recommendations || []).length) {
      // 推荐用完, 清空让用户自己输入
      this.setData(this._buildTinderState());
      return;
    }
    this.setData(this._buildTinderState({ currentRecommendationIdx: nextIdx }));
  },

  /**
   * R118 T1: 复制简历 markdown 到剪贴板
   */
  onCopyMarkdown() {
    if (!this.data.resumeMarkdown) return;
    if (typeof wx !== 'undefined' && wx.setClipboardData) {
      wx.setClipboardData({
        data: this.data.resumeMarkdown,
        success: () => {
          if (wx.showToast) wx.showToast({ title: '已复制', icon: 'success', duration: 1500 });
        },
      });
    }
  },

  /**
   * R118 T2: Canvas 2D 画 5 维雷达图 (类似脉脉个人画像)
   */
  _drawRadarChart() {
    if (typeof wx === 'undefined' || !wx.createSelectorQuery) return;
    const query = wx.createSelectorQuery().in(this);
    query.select('#radar-canvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        const canvas = res && res[0] && res[0].node;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const dpr = (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2;
        const w = res[0].width;
        const h = res[0].height;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.scale(dpr, dpr);
        const cx = w / 2, cy = h / 2;
        const r = Math.min(w, h) * 0.35;
        const keys = ['basic', 'education', 'work', 'expected', 'skills'];
        const scores = this.data.radarScores || {};
        // 画 5 圈背景网格
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        for (let i = 1; i <= 5; i++) {
          ctx.beginPath();
          for (let j = 0; j < 5; j++) {
            const angle = (Math.PI * 2 / 5) * j - Math.PI / 2;
            const radius = (r / 5) * i;
            const x = cx + Math.cos(angle) * radius;
            const y = cy + Math.sin(angle) * radius;
            if (j === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.stroke();
        }
        // 画 5 条轴
        for (let j = 0; j < 5; j++) {
          const angle = (Math.PI * 2 / 5) * j - Math.PI / 2;
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
        // 画数据多边形
        ctx.fillStyle = 'rgba(99,102,241,0.3)';
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let j = 0; j < 5; j++) {
          const score = scores[keys[j]] || 0;
          const radius = (r * score) / 100;
          const angle = (Math.PI * 2 / 5) * j - Math.PI / 2;
          const x = cx + Math.cos(angle) * radius;
          const y = cy + Math.sin(angle) * radius;
          if (j === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // 画数据点
        ctx.fillStyle = '#6366f1';
        for (let j = 0; j < 5; j++) {
          const score = scores[keys[j]] || 0;
          const radius = (r * score) / 100;
          const angle = (Math.PI * 2 / 5) * j - Math.PI / 2;
          const x = cx + Math.cos(angle) * radius;
          const y = cy + Math.sin(angle) * radius;
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      });
  },

  /**
   * R117: 构造 Tinder 状态对象 (含 currentRecommendation, 避免 wxml inline array index)
   * 调用方: 任何 setData 改 recommendations / currentRecommendationIdx 都应同时算 currentRecommendation
   */
  _buildTinderState(overrides = {}) {
    const recs = overrides.recommendations !== undefined ? overrides.recommendations : (this.data.recommendations || []);
    const idx = overrides.currentRecommendationIdx !== undefined ? overrides.currentRecommendationIdx : (this.data.currentRecommendationIdx || 0);
    return {
      recommendations: recs,
      currentRecommendationIdx: idx,
      currentRecommendation: recs[idx] || null,
      ...overrides,
    };
  },


  onModalChip(e) {
    const value = e.currentTarget.dataset.value;
    this._saveModal(value);
  },

  onModalPicker(e) {
    const idx = parseInt(e.detail.value, 10);
    const value = this.data.modalOptions?.[idx] || '';
    this._saveModal(value);
  },

  onModalSave() {
    if (this.data.wizardMode) {
      this._wizardNext();
    } else {
      this._saveModal((this.data.modalValue || '').trim());
    }
  },

  onModalCancel() {
    // R114 T2 fix (Important #2): modal 关闭时清 debounce timer + 作废在飞请求 (防串话)
    if (this._aiDebounceTimer) {
      clearTimeout(this._aiDebounceTimer);
      this._aiDebounceTimer = null;
    }
    this._aiRequestSeq = (this._aiRequestSeq || 0) + 1;
    this.setData({
      modalVisible: false,
      modalField: null,
      modalFieldLabel: '',
      modalFieldAi: '',
      modalConstId: '',
      modalConstColor: '#6366f1',
      modalValue: '',
      modalOptions: null,
      modalPlaceholder: '',
      // R114 T2 fix: 彻底重置 AI 对话状态 (避免下次开弹窗残留)
      aiHistory: [],
      aiFollowup: '',
      aiSuggestion: '',
      aiBusy: false,
      aiError: '',
      aiRequestSeq: this._aiRequestSeq,
      aiScrollTop: 0,
      // R115: 重置 wizard 状态
      wizardMode: false,
      wizardCurrentField: '',
      wizardNextQuestion: '',
      wizardHint: '',
      wizardProgress: 0,
      wizardAnswered: [],
      wizardIsComplete: false,
      wizardIsLoading: false,
    });
  },

  /**
   * R115 fix (Critical Bug): 纯写 form + 副作用 (刷新粒子/划线/完成度), 不动 modal 状态.
   * _saveModal 和 _wizardNext 共用此函数, 避免 _saveModal 内含 modalVisible:false 导致 wizard
   * 首问后即关闭.
   *
   * R116: 不再调用 _refreshParticleFilled/_drawLines (无粒子无 canvas)
   */
  _writeFormAndSideEffects(value) {
    const { modalField } = this.data;
    const form = JSON.parse(JSON.stringify(this.data.form));
    let skillsCount = this.data.skillsCount;
    // R107 T2: 记录完成度变化前值, 供 setData callback 触发 _applyCompletionBump
    const prevCompletion = this.data.completion;
    switch (modalField) {
      case 'name': form.name = value; break;
      case 'gender': form.gender = value; break;
      case 'degree': form.degree = value; break;
      case 'phone': form.phone = value; break;
      case 'edu_school': form.educations[0].school = value; break;
      case 'edu_major': form.educations[0].major = value; break;
      case 'edu_start': form.educations[0].start = value; break;
      case 'edu_end': form.educations[0].end = value; break;
      case 'work_company': form.experiences[0].company = value; break;
      case 'work_title': form.experiences[0].title = value; break;
      case 'work_start': form.experiences[0].start = value; break;
      case 'work_end': form.experiences[0].end = value; break;
      case 'work_desc': form.experiences[0].desc = value; break;
      case 'exp_city': form.expected.city = value; break;
      case 'exp_position': form.expected.position = value; break;
      case 'exp_salary_min': form.expected.salary_min = value; break;
      case 'exp_salary_max': form.expected.salary_max = value; break;
      case 'skills_list': {
        form.skills = value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
        skillsCount = form.skills.length;
        break;
      }
    }
    const completion = calcCompletion(form, skillsCount);
    this.setData({
      form,
      skillsCount,
      completion,
      // 不动 modal 状态 — 由调用方决定
    }, () => {
      // R116 fix: form 变更后重新派生 sections (fieldState filled 更新)
      this.setData({ sections: this._buildFieldStates() });
      // R118 T1: 实时更新简历 markdown 预览
      const md = _buildResumeMarkdown(form, form.skills || []);
      // R118 T2: 实时更新雷达分数
      const radar = _calcRadarScores(form, skillsCount);
      this.setData({ resumeMarkdown: md, radarScores: radar });
      // R118 T2: 重画雷达图 (setTimeout 100ms 等 canvas ready)
      if (typeof setTimeout !== 'undefined') {
        setTimeout(() => this._drawRadarChart(), 100);
      }
      // R116: 删 _refreshParticleFilled + _drawLines (无粒子无 canvas)
      // R107 T2: 完成度变化 → 数字脉冲 + 阈值变色 (保留 dead state update)
      this._applyCompletionBump(prevCompletion, completion);
      // R107 T4 完成度阈值 watcher 已删 (R116 不再用)
    });
  },

  _saveModal(value) {
    // R115 fix: 调 _writeFormAndSideEffects 写 form, 然后显式关 modal
    this._writeFormAndSideEffects(value);
    this.setData({
      modalVisible: false,
      modalField: null,
      modalFieldLabel: '',
      modalFieldAi: '',
      modalConstId: '',
      modalConstColor: '#6366f1',
      modalValue: '',
      modalOptions: null,
      modalPlaceholder: '',
    });
  },

  // R107 T2: 完成度数字脉冲 + 阈值变色 (每次 setData bumpTick++ 触发 CSS animation 重新运行)
  // tier: gold (100) / high (>=60) / mid (>=30) / low (else)
  // R116: 保留 helper (仍有 dead state numTier + bumpTick 在 data 中, 测试引用)
  _applyCompletionBump(prev, next) {
    let tier = 'low';
    if (next >= 100) tier = 'gold';
    else if (next >= 60) tier = 'high';
    else if (next >= 30) tier = 'mid';
    this.setData({ numTier: tier, bumpTick: this.data.bumpTick + 1 });
  },

  _getFieldValue(field) {
    const f = this.data.form;
    switch (field) {
      case 'name': return f.name;
      case 'gender': return f.gender;
      case 'degree': return f.degree;
      case 'phone': return f.phone;
      case 'edu_school': return f.educations[0].school;
      case 'edu_major': return f.educations[0].major;
      case 'edu_start': return f.educations[0].start;
      case 'edu_end': return f.educations[0].end;
      case 'work_company': return f.experiences[0].company;
      case 'work_title': return f.experiences[0].title;
      case 'work_start': return f.experiences[0].start;
      case 'work_end': return f.experiences[0].end;
      case 'work_desc': return f.experiences[0].desc;
      case 'exp_city': return f.expected.city;
      case 'exp_position': return f.expected.position;
      case 'exp_salary_min': return f.expected.salary_min;
      case 'exp_salary_max': return f.expected.salary_max;
      case 'skills_list': return (f.skills || []).join(', ');
      default: return '';
    }
  },

  _isFieldFilled(field) {
    const v = this._getFieldValue(field);
    return !!(v && String(v).trim());
  },

  onSubmit() {
    // R106: token 缺失提示 (避免反复 401)
    const token = typeof wx !== 'undefined' ? wx.getStorageSync('token') : '';
    if (!token) {
      if (typeof wx !== 'undefined') {
        wx.showModal({
          title: '请先获取 Token',
          content: 'IDE Console 粘贴这段拿 token:',
          confirmText: '看代码',
          success: () => {
            wx.showModal({
              title: '复制这段到 Console',
              content: 'wx.request({url:"https://43.139.176.199/api/test/dev-reissue",method:"POST",header:{"Content-Type":"application/json"},data:{userId:2},success:(res)=>{if(res.data.code===0){wx.setStorageSync("token",res.data.data.token);wx.setStorageSync("user",{id:2,openid:res.data.data.openid,nickname:res.data.data.nickname,avatar:null});console.log("TOKEN OK")}else{console.error("FAIL",res.data)}}})',
              showCancel: false,
            });
          },
        });
      }
      return;
    }
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

    wx.showLoading({ title: '正在生成简历...', mask: true });
    request({ url: '/resume/save', method: 'POST', data: { source_form: form } })
      .then((saveRes) => request({ url: '/resume/generate', method: 'POST', data: { resume_id: saveRes.data.data.resume_id } }))
      .then(() => {
        wx.hideLoading();
        wx.redirectTo({ url: '/pages/preview/preview' });
      })
      .catch((err) => {
        wx.hideLoading();
        console.error('submit failed:', err);
      });
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  },
});
