/**
 * R98 粒子星图填简历
 *
 * 推翻传统: 用星图可视化, 5 星座 (基本/教育/工作/期望/技能)
 * 每个字段是发光粒子, 点击 → 弹窗填 → 星变亮
 * 实时预览在右下角浮动
 *
 * 与之前兼容:
 *   - emptyForm / calcCompletion 不变
 *   - submit 复用原 form 提交
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

const STEP_LABELS = CONSTELLATIONS.map(c => c.name);
const STEP_HINTS = ['点击粒子填字段', '教育背景', '工作经验', '求职方向', '技能列表'];

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

// 计算粒子位置 (5 星座环绕中心)
// 返回: constellations [{...const, particles: [{x, y, field}]}]
function layoutParticles(width, height) {
  const cx = width / 2;
  const cy = height / 2;
  const orbitR = Math.min(width, height) * 0.40;
  return CONSTELLATIONS.map((c, i) => {
    // 5 个星座均分 360°, 从顶部开始
    const angle = (i * 72 - 90) * Math.PI / 180;
    const ccx = cx + Math.cos(angle) * orbitR;
    const ccy = cy + Math.sin(angle) * orbitR;
    // 粒子在该星座周围小半径
    // R106b: filled 字段提前算好 (避开 WXML inline 函数调用, 那会让 view 整段不渲染)
    const partR = 90;
    const particles = c.fields.map((f, j) => {
      const partAngle = (j * 360 / c.fields.length) * Math.PI / 180;
      return {
        ...f,
        x: ccx + Math.cos(partAngle) * partR,
        y: ccy + Math.sin(partAngle) * partR,
        filled: false, // 初次 layout 全 false; _initLayout 后由 _refreshParticleFilled 重算
      };
    });
    return { ...c, cx: ccx, cy: ccy, particles };
  });
}

// 简易伪随机 (用于背景小星点)
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function genBackgroundStars(n, w, h, seed = 42) {
  const r = mulberry32(seed);
  const stars = [];
  for (let i = 0; i < n; i++) {
    stars.push({
      x: r() * w,
      y: r() * h,
      size: 1 + r() * 2.5,
      opacity: 0.3 + r() * 0.7,
    });
  }
  return stars;
}

// R114 T3: genMeteors 已删除 (流星 view 已删, 函数死码, 无消费者)

module.exports = {
  _test: {
    emptyForm, calcCompletion, CONSTELLATIONS, STEP_LABELS, STEP_HINTS,
    layoutParticles, genBackgroundStars, mulberry32,
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
    width: 750,
    height: 1200,
    constellations: [],
    backgroundStars: [],
    // R114 T3: meteors 字段已删 (流星 view 已删, 无消费者)
    stepLabels: STEP_LABELS,
    stepHints: STEP_HINTS,
    form: emptyForm(),
    skillsCount: 0,
    completion: 0,
    // Modal 状态
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
    // R114 T2 fix: 错误兜底 + 异步竞态防护 + 自动滚底
    aiError: '',
    aiRequestSeq: 0, // generation token, 每次请求 ++, 过期响应丢弃
    aiScrollTop: 0,
    // R107 T2: 完成度数字脉冲 + 阈值变色
    numTier: 'low',
    bumpTick: 0,
    // R107 T4: 完成度阈值 → 触发星座旋转 + 中心庆祝
    starfieldReady: false,
    // R108 T2 fix: touching 状态 — 触摸时暂停粒子 float 动画
    starfieldTouching: false,
    // R108 T2: 粒子拖尾 — 手指位置 (x/y=-1 表示未触摸)
    fingerPos: { x: -1, y: -1 },
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
    // R103: 数据更新后重绘连线 (中心完成度变 / 字段填满)
    setTimeout(() => this._drawLines(), 100);
  },

  onUnload() {
    // R114 T2 fix (Important #2): 页面卸载清 debounce timer + 作废在飞请求
    if (this._aiDebounceTimer) {
      clearTimeout(this._aiDebounceTimer);
      this._aiDebounceTimer = null;
    }
    this._aiRequestSeq = (this._aiRequestSeq || 0) + 1;
    try { wx.offWindowResize && wx.offWindowResize(); } catch (_) {}
  },

  _initLayout(width, height, wide, dpr = 2) {
    const constellations = layoutParticles(width, height);
    const backgroundStars = genBackgroundStars(80, width, height);
    this.setData({ width, height, wide, constellations, backgroundStars });
    // R106b: 初次 layout 全 false; form 加载完后重算 filled 视觉
    this._refreshParticleFilled();
    // R103: 划线 (需 dpr 适配 retina)
    setTimeout(() => this._drawLines(width, height, dpr), 50);
  },

  // R106b: 用 form 数据重算每个粒子的 filled 视觉态
  // (避免 WXML inline 调用 _isFieldFilled() — 实测会断整个 view 渲染)
  _refreshParticleFilled() {
    const constellations = (this.data.constellations || []).map((c) => ({
      ...c,
      particles: (c.particles || []).map((p) => ({
        ...p,
        filled: this._isFieldFilled(p.id),
      })),
    }));
    this.setData({ constellations });
  },

  // R103+R104: 在 type=2d Canvas 画 filled 粒子之间连线
  _drawLines(width, height, dpr = 2) {
    if (!width || !height) return;
    if (typeof wx === 'undefined') return; // node test 跳过
    const query = wx.createSelectorQuery();
    query.select('#starfield-lines')
      .fields({ node: true, size: true })
      .exec((res) => {
        const canvas = res && res[0] && res[0].node;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const w = width;
        const h = height;
        ctx.clearRect(0, 0, w, h);

        // 收集所有 filled 粒子 (按星座上色)
        const filledPoints = [];
        for (const c of this.data.constellations || []) {
          for (const p of c.particles || []) {
            if (this._isFieldFilled(p.id)) {
              filledPoints.push({ x: p.x, y: p.y, color: c.color, rgb: c.colorRgb });
            }
          }
        }
        if (filledPoints.length < 2) return;

        // 两两连线 (透明度 = 距中心越近越亮)
        const cx = w / 2, cy = h / 2;
        const maxDist = Math.hypot(w, h) / 2;
        ctx.lineWidth = 1;
        for (let i = 0; i < filledPoints.length; i++) {
          for (let j = i + 1; j < filledPoints.length; j++) {
            const a = filledPoints[i], b = filledPoints[j];
            const dx = a.x - b.x, dy = a.y - b.y;
            const dist = Math.hypot(dx, dy);
            const maxEdge = Math.max(w, h) * 0.45;
            if (dist > maxEdge) continue;
            const midX = (a.x + b.x) / 2;
            const midY = (a.y + b.y) / 2;
            const distToCenter = Math.hypot(midX - cx, midY - cy);
            const alpha = Math.max(0.15, 1 - distToCenter / maxDist);
            ctx.strokeStyle = `rgba(${a.rgb}, ${alpha.toFixed(2)})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
        // 中心 → 每个 filled 粒子的连线 (毛笔效应)
        ctx.lineWidth = 2;
        for (const p of filledPoints) {
          ctx.strokeStyle = `rgba(${p.rgb}, 0.6)`;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }
      });
  },

  onParticleTap(e) {
    const { field, constId } = e.currentTarget.dataset;
    const constDef = CONSTELLATIONS.find(c => c.id === constId);
    const fieldDef = constDef?.fields.find(f => f.id === field);
    const value = this._getFieldValue(field);
    const modalFieldAi = fieldDef?.ai || '';
    // R114 T2 fix: 切换字段前清理 debounce timer + 作废在飞请求 (防串话)
    if (this._aiDebounceTimer) {
      clearTimeout(this._aiDebounceTimer);
      this._aiDebounceTimer = null;
    }
    this._aiRequestSeq = (this._aiRequestSeq || 0) + 1;
    // R114 T2: 初始化 AI 对话历史 (首条 = R99 静态提示)
    const initAi = modalFieldAi
      ? [{ role: 'assistant', content: modalFieldAi, id: this._nextAiMsgId('init') }]
      : [];
    this.setData({
      modalVisible: true,
      modalField: field,
      modalFieldLabel: fieldDef?.label || field,
      modalFieldAi,
      modalConstId: constId,
      modalConstColor: constDef?.color || '#6366f1',
      modalValue: value || '',
      modalOptions: fieldDef?.options || null,
      modalPlaceholder: fieldDef?.placeholder || `请输入${fieldDef?.label || ''}`,
      // R114 T2: 重置 AI 对话状态
      aiHistory: initAi,
      aiFollowup: '',
      aiSuggestion: '',
      aiBusy: false,
      aiError: '',
      aiRequestSeq: this._aiRequestSeq,
      aiScrollTop: 0,
    });
  },

  // R114 T2 fix (Nit #1): 单调递增 msg id — 避免 Date.now 同毫秒重复
  _nextAiMsgId(prefix) {
    this._aiMsgCounter = (this._aiMsgCounter || 0) + 1;
    return prefix + '-' + this._aiMsgCounter;
  },

  onModalInput(e) {
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
    const val = (this.data.modalValue || '').trim();
    this._saveModal(val);
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
    });
  },

  _saveModal(value) {
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
      modalVisible: false,
      modalField: null,
      modalFieldLabel: '',
      modalFieldAi: '',
      modalConstId: '',
      modalConstColor: '#6366f1',
      modalValue: '',
      modalOptions: null,
      modalPlaceholder: '',
    }, () => {
      // R106b: 重算每个粒子的 filled 视觉态 (避免 WXML inline _isFieldFilled 整段 view 不渲染)
      this._refreshParticleFilled();
      this._drawLines(this.data.width, this.data.height);
      // R107 T2: 完成度变化 → 数字脉冲 + 阈值变色
      this._applyCompletionBump(prevCompletion, completion);
      // R107 T4: 完成度阈值 → 星座旋转 + 中心庆祝
      this._watchCompletionTier(completion);
    });
  },

  // R107 T2: 完成度数字脉冲 + 阈值变色 (每次 setData bumpTick++ 触发 CSS animation 重新运行)
  // tier: gold (100) / high (>=60) / mid (>=30) / low (else)
  _applyCompletionBump(prev, next) {
    let tier = 'low';
    if (next >= 100) tier = 'gold';
    else if (next >= 60) tier = 'high';
    else if (next >= 30) tier = 'mid';
    this.setData({ numTier: tier, bumpTick: this.data.bumpTick + 1 });
  },

  /**
   * R114 T3: 监听完成度阈值切换 (≥80% → starfieldReady 星座旋转; 100% celebrate 已删)
   */
  _watchCompletionTier(c) {
    this.setData({ starfieldReady: c >= 80 });
  },

  /**
   * R108 T2: 粒子拖尾 — 触摸事件
   * 手指按下/移动时, 重算每个粒子 dx/dy 让它们朝手指方向轻微偏移.
   * 偏移距离 = min(20px, 200/dist) 朝手指方向, 距离 > 400px 不偏移.
   */
  onTouchStart(e) {
    const t = e.touches && e.touches[0];
    if (!t) return;
    this.setData({
      fingerPos: { x: t.x, y: t.y },
      starfieldTouching: true, // R108 T2 fix: pause float
    });
    this._updateParticlesOffset(t.x, t.y);
  },

  onTouchMove(e) {
    const t = e.touches && e.touches[0];
    if (!t) return;
    // 节流: 每 50ms 更新一次 (高频 touchmove 会卡)
    const now = Date.now();
    if (this._lastTouchUpdate && now - this._lastTouchUpdate < 50) return;
    this._lastTouchUpdate = now;
    this.setData({ fingerPos: { x: t.x, y: t.y } });
    this._updateParticlesOffset(t.x, t.y);
  },

  onTouchEnd() {
    this.setData({
      fingerPos: { x: -1, y: -1 },
      starfieldTouching: false, // R108 T2 fix: resume float
    });
    // 复位所有粒子 (dx/dy = 0), CSS transition 会让粒子平滑回弹
    const constellations = (this.data.constellations || []).map((c) => ({
      ...c,
      particles: (c.particles || []).map((p) => ({ ...p, dx: 0, dy: 0 })),
    }));
    this.setData({ constellations });
  },

  /**
   * R108 T2: 重算每个粒子相对手指的偏移
   * 调用频繁, 必须 minimal cost — 用 map + 1 次 setData.
   */
  _updateParticlesOffset(fx, fy) {
    const constellations = (this.data.constellations || []).map((c) => ({
      ...c,
      particles: (c.particles || []).map((p) => {
        const dx = fx - p.x;
        const dy = fy - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist === 0 || dist > 400) return { ...p, dx: 0, dy: 0 };
        // 偏移距离 = min(20, 200/dist) 朝手指方向
        const mag = Math.min(20, 200 / dist);
        const ux = dx / dist;
        const uy = dy / dist;
        return { ...p, dx: ux * mag, dy: uy * mag };
      }),
    }));
    this.setData({ constellations });
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