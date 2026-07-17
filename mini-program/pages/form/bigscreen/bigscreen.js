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
  const orbitR = Math.min(width, height) * 0.32;
  return CONSTELLATIONS.map((c, i) => {
    // 5 个星座均分 360°, 从顶部开始
    const angle = (i * 72 - 90) * Math.PI / 180;
    const ccx = cx + Math.cos(angle) * orbitR;
    const ccy = cy + Math.sin(angle) * orbitR;
    // 粒子在该星座周围小半径
    const partR = 90;
    const particles = c.fields.map((f, j) => {
      const partAngle = (j * 360 / c.fields.length) * Math.PI / 180;
      return {
        ...f,
        x: ccx + Math.cos(partAngle) * partR,
        y: ccy + Math.sin(partAngle) * partR,
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
  },

  onLoad() {
    const win = (wx.getWindowInfo && wx.getWindowInfo()) || {};
    const wide = (win.windowWidth || 0) >= 1024;
    const width = win.windowWidth || 375;
    const height = win.windowHeight || 667;
    this._initLayout(width, height, wide);
  },

  onUnload() {
    try { wx.offWindowResize && wx.offWindowResize(); } catch (_) {}
  },

  _initLayout(width, height, wide) {
    const constellations = layoutParticles(width, height);
    const backgroundStars = genBackgroundStars(80, width, height);
    this.setData({ width, height, wide, constellations, backgroundStars });
  },

  onParticleTap(e) {
    const { field, constId } = e.currentTarget.dataset;
    const constDef = CONSTELLATIONS.find(c => c.id === constId);
    const fieldDef = constDef?.fields.find(f => f.id === field);
    const value = this._getFieldValue(field);
    this.setData({
      modalVisible: true,
      modalField: field,
      modalFieldLabel: fieldDef?.label || field,
      modalFieldAi: fieldDef?.ai || '',
      modalConstId: constId,
      modalConstColor: constDef?.color || '#6366f1',
      modalValue: value || '',
      modalOptions: fieldDef?.options || null,
      modalPlaceholder: fieldDef?.placeholder || `请输入${fieldDef?.label || ''}`,
    });
  },

  onModalInput(e) {
    this.setData({ modalValue: e.detail.value });
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

  _saveModal(value) {
    const { modalField } = this.data;
    const form = JSON.parse(JSON.stringify(this.data.form));
    let skillsCount = this.data.skillsCount;
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
    });
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