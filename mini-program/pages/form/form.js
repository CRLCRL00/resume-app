const { request } = require('../../utils/request');
const { parseSkills } = require('../../utils/format');

const genderDisplay = ['男', '女', '其他'];
const genderValues = ['male', 'female', 'other'];
const degreeOptions = ['高中', '大专', '本科', '硕士', '博士'];

Page({
  data: {
    genderOptions: genderDisplay,
    degreeOptions,
    genderIndex: -1,
    degreeIndex: -1,
    skillsInput: '',
    form: {
      name: '', gender: '', degree: '', phone: '',
      educations: [{ school: '', major: '', degree: '', start: '', end: '' }],
      experiences: [{ company: '', title: '', start: '', end: '', desc: '' }],
      expected: { city: '', position: '', salary_min: '', salary_max: '' },
      skills: [],
    },
  },

  setField(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  setGender(e) {
    const idx = parseInt(e.detail.value, 10);
    this.setData({
      genderIndex: idx,
      'form.gender': genderValues[idx],
      genderDisplay: genderDisplay[idx],
    });
  },

  setDegree(e) {
    const idx = parseInt(e.detail.value, 10);
    this.setData({ degreeIndex: idx, 'form.degree': degreeOptions[idx] });
  },

  setEdu(e) {
    const { index, field } = e.currentTarget.dataset;
    const educations = this.data.form.educations.slice();
    educations[index] = { ...educations[index], [field]: e.detail.value };
    this.setData({ 'form.educations': educations });
  },

  addEdu() {
    const educations = this.data.form.educations.concat([{ school: '', major: '', degree: '', start: '', end: '' }]);
    this.setData({ 'form.educations': educations });
  },

  removeEdu(e) {
    const { index } = e.currentTarget.dataset;
    const educations = this.data.form.educations.filter((_, i) => i !== index);
    this.setData({ 'form.educations': educations });
  },

  setExp(e) {
    const { index, field } = e.currentTarget.dataset;
    const experiences = this.data.form.experiences.slice();
    experiences[index] = { ...experiences[index], [field]: e.detail.value };
    this.setData({ 'form.experiences': experiences });
  },

  addExp() {
    const experiences = this.data.form.experiences.concat([{ company: '', title: '', start: '', end: '', desc: '' }]);
    this.setData({ 'form.experiences': experiences });
  },

  removeExp(e) {
    const { index } = e.currentTarget.dataset;
    const experiences = this.data.form.experiences.filter((_, i) => i !== index);
    this.setData({ 'form.experiences': experiences });
  },

  setExpected(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`form.expected.${field}`]: e.detail.value });
  },

  setSkillsInput(e) {
    this.setData({ skillsInput: e.detail.value });
  },

  async submit() {
    // 缺字段自动填默认（让 LLM 也能用）
    const raw = this.data.form;
    const skills = parseSkills(this.data.skillsInput);
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
      skills: skills?.length ? skills : ['待补充'],
      expected: {
        city: raw.expected?.city?.trim() || '深圳',
        position: raw.expected?.position?.trim() || '岗位待定',
        salary_min: parseInt(raw.expected?.salary_min, 10) || 0,
        salary_max: parseInt(raw.expected?.salary_max, 10) || Math.max(parseInt(raw.expected?.salary_min, 10) || 0, 10),
      },
    };

    // 跳过 validateResume：缺字段已 above 自动填默认，后端仍校验最终字段

    // 3 段 loading
    const stages = require('../../utils/loading').loadingStages();
    wx.showLoading({ title: stages[0].text, mask: true });
    const timer1 = setTimeout(() => wx.showLoading({ title: stages[1].text, mask: true }), stages[1].at);
    const timer2 = setTimeout(() => wx.showLoading({ title: stages[2].text, mask: true }), stages[2].at);

    try {
      const saveRes = await request({ url: '/resume/save', method: 'POST', data: { source_form: form } });
      const resumeId = saveRes.data.data.resume_id;
      await request({ url: '/resume/generate', method: 'POST', data: { resume_id: resumeId } });
      wx.hideLoading();
      clearTimeout(timer1);
      clearTimeout(timer2);
      wx.navigateTo({ url: '/pages/preview/preview' });
    } catch (e) {
      wx.hideLoading();
      clearTimeout(timer1);
      clearTimeout(timer2);
      // request.js 已 toast 过错误
    }
  },
});