/**
 * R94 大屏填简历 — 5 步状态机 + 实时完成度 + 左输入右预览
 *
 * 自适应:
 *   - windowWidth ≥ 1024 → wide=true → 两栏 (左输入 + 右预览)
 *   - 否则 → wide=false → 单栏堆叠
 *
 * 复用 form.js 提交逻辑: /resume/save → /resume/generate → /pages/preview/preview
 */
// 真实运行时使用 utils; node test 环境 (无 wx) 用 stub
const isWx = typeof wx !== 'undefined';
const { request } = isWx
  ? require('../../../utils/request')
  : { request: () => { throw new Error('no wx'); } };
const { parseSkills } = isWx
  ? require('../../../utils/format')
  : (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);
const { loadingStages } = isWx
  ? require('../../../utils/loading')
  : () => [{ text: '...', at: 0 }, { text: '...', at: 0 }, { text: '...', at: 0 }];

const genderValues = ['male', 'female', 'other'];
const degreeOptions = ['高中', '大专', '本科', '硕士', '博士'];
const STEP_LABELS = ['基本信息', '教育经历', '工作经历', '求职期望', '技能'];
const STEP_HINTS = [
  '从你的姓名和学历开始',
  '一段或多段教育经历',
  '实习或全职工作经验',
  '期望的城市、岗位和薪资',
  '用逗号分隔, 如: React, Node.js, Python',
];

function emptyForm() {
  return {
    name: '', gender: '', degree: '', phone: '',
    educations: [{ school: '', major: '', degree: '', start: '', end: '' }],
    experiences: [{ company: '', title: '', start: '', end: '', desc: '' }],
    expected: { city: '', position: '', salary_min: '', salary_max: '' },
    skills: [],
  };
}

// 提前 export 给 test (在 PageImpl 之前)
module.exports = { _test: { emptyForm, calcCompletion, STEP_LABELS, STEP_HINTS } };

// 完成度算法: 必填字段占比
// 基本 25% + 教育 20% + 工作 25% + 期望 20% + 技能 10% = 100%
function calcCompletion(form, skillsCount) {
  let total = 0;
  // 基本 25%: name(10) + gender(5) + degree(5) + phone(5)
  if (form.name?.trim()) total += 10;
  if (form.gender) total += 5;
  if (form.degree) total += 5;
  if (form.phone?.trim()) total += 5;
  // 教育 20%: 第一条学校(10) + 专业(5) + 起止(5)
  const e0 = form.educations?.[0] || {};
  if (e0.school?.trim()) total += 10;
  if (e0.major?.trim()) total += 5;
  if (e0.start?.trim() && e0.end?.trim()) total += 5;
  // 工作 25%: 第一条公司(10) + 职位(5) + 起止(5) + 描述(5)
  const x0 = form.experiences?.[0] || {};
  if (x0.company?.trim()) total += 10;
  if (x0.title?.trim()) total += 5;
  if (x0.start?.trim() && x0.end?.trim()) total += 5;
  if (x0.desc?.trim()) total += 5;
  // 期望 20%: 城市(7) + 岗位(7) + 薪资min(3) + max(3)
  if (form.expected?.city?.trim()) total += 7;
  if (form.expected?.position?.trim()) total += 7;
  if (form.expected?.salary_min?.toString().trim()) total += 3;
  if (form.expected?.salary_max?.toString().trim()) total += 3;
  // 技能 10%
  if (skillsCount > 0) total += 10;
  return Math.min(100, total);
}

// wx Page 包装 (node test 环境无 wx, 用 stub)
const PageImpl = typeof Page !== 'undefined'
  ? Page
  : function (config) { if (module.exports._test) module.exports._test._pageConfig = config; };

PageImpl({
  data: {
    wide: false,
    step: 0,
    focusIndex: 0,
    stepLabels: STEP_LABELS,
    stepHints: STEP_HINTS,
    genderValues,
    degreeOptions,
    degreeIndex: -1,
    skillsInput: '',
    skillsCount: 0,
    completion: 0,
    form: emptyForm(),
  },

  onLoad() {
    // R94: 自适应屏宽 (复用 R58 dashboard 模式)
    const win = (wx.getWindowInfo && wx.getWindowInfo()) || {};
    const wide = (win.windowWidth || 0) >= 1024;
    this.setData({ wide });
    // 旋转/窗口 resize 时重判
    try {
      wx.onWindowResize((res) => {
        const w = (res && res.windowWidth) || 0;
        if (w >= 1024 !== this.data.wide) {
          this.setData({ wide: w >= 1024 });
        }
      });
    } catch (_) { /* 旧版无此 API */ }
  },

  onUnload() {
    try { wx.offWindowResize && wx.offWindowResize(); } catch (_) {}
  },

  // ─── 步骤切换 ─────────────────────────────────────────
  goStep(e) {
    const { index } = e.currentTarget.dataset;
    this.setData({ step: Number(index), focusIndex: 0 });
  },

  prevStep() {
    if (this.data.step > 0) {
      this.setData({ step: this.data.step - 1, focusIndex: 0 });
    }
  },

  nextStep() {
    if (this.data.step < STEP_LABELS.length - 1) {
      this.setData({ step: this.data.step + 1, focusIndex: 0 });
    }
  },

  // ─── 字段更新 ─────────────────────────────────────────
  setField(e) {
    const { field } = e.currentTarget.dataset;
    this._updateForm(`form.${field}`, e.detail.value);
  },

  setGender(e) {
    const value = e.currentTarget.dataset.value;
    this._updateForm('form.gender', value);
  },

  setDegree(e) {
    const idx = parseInt(e.detail.value, 10);
    this.setData({
      degreeIndex: idx,
      'form.degree': degreeOptions[idx],
    }, this._recomputeCompletion);
  },

  setEdu(e) {
    const { index, field } = e.currentTarget.dataset;
    const educations = this.data.form.educations.slice();
    educations[index] = { ...educations[index], [field]: e.detail.value };
    this.setData({ 'form.educations': educations }, this._recomputeCompletion);
  },

  addEdu() {
    const educations = this.data.form.educations.concat([
      { school: '', major: '', degree: '', start: '', end: '' },
    ]);
    this.setData({ 'form.educations': educations });
  },

  removeEdu(e) {
    const { index } = e.currentTarget.dataset;
    const educations = this.data.form.educations.filter((_, i) => i !== index);
    this.setData({ 'form.educations': educations }, this._recomputeCompletion);
  },

  setExp(e) {
    const { index, field } = e.currentTarget.dataset;
    const experiences = this.data.form.experiences.slice();
    experiences[index] = { ...experiences[index], [field]: e.detail.value };
    this.setData({ 'form.experiences': experiences }, this._recomputeCompletion);
  },

  addExp() {
    const experiences = this.data.form.experiences.concat([
      { company: '', title: '', start: '', end: '', desc: '' },
    ]);
    this.setData({ 'form.experiences': experiences });
  },

  removeExp(e) {
    const { index } = e.currentTarget.dataset;
    const experiences = this.data.form.experiences.filter((_, i) => i !== index);
    this.setData({ 'form.experiences': experiences }, this._recomputeCompletion);
  },

  setExpected(e) {
    const { field } = e.currentTarget.dataset;
    this._updateForm(`form.expected.${field}`, e.detail.value);
  },

  setSkillsInput(e) {
    const input = e.detail.value;
    const skills = parseSkills(input);
    this.setData({
      skillsInput: input,
      skillsCount: skills.length,
      'form.skills': skills,
    }, this._recomputeCompletion);
  },

  _updateForm(path, value) {
    this.setData({ [path]: value }, this._recomputeCompletion);
  },

  _recomputeCompletion() {
    const completion = calcCompletion(this.data.form, this.data.skillsCount);
    this.setData({ completion });
  },

  // ─── 提交 ─────────────────────────────────────────────
  async submit() {
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

    const stages = loadingStages();
    wx.showLoading({ title: stages[0].text, mask: true });
    const t1 = setTimeout(() => wx.showLoading({ title: stages[1].text, mask: true }), stages[1].at);
    const t2 = setTimeout(() => wx.showLoading({ title: stages[2].text, mask: true }), stages[2].at);

    try {
      const saveRes = await request({ url: '/resume/save', method: 'POST', data: { source_form: form } });
      const resumeId = saveRes.data.data.resume_id;
      await request({ url: '/resume/generate', method: 'POST', data: { resume_id: resumeId } });
      wx.hideLoading();
      clearTimeout(t1);
      clearTimeout(t2);
      wx.redirectTo({ url: '/pages/preview/preview' });
    } catch (e) {
      wx.hideLoading();
      clearTimeout(t1);
      clearTimeout(t2);
    }
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  },
});

// _test 已提前 export (顶部)