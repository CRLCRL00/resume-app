const { request } = require('../../utils/request');
const { parseSkills, validateResume } = require('../../utils/validate');

const genderOptions = ['male', 'female', 'other'];
const degreeOptions = ['高中', '大专', '本科', '硕士', '博士'];

Page({
  data: {
    genderOptions,
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
    this.setData({ genderIndex: idx, 'form.gender': genderOptions[idx] });
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
    const form = {
      ...this.data.form,
      skills: parseSkills(this.data.skillsInput),
      expected: {
        city: this.data.form.expected.city,
        position: this.data.form.expected.position,
        salary_min: parseInt(this.data.form.expected.salary_min, 10) || 0,
        salary_max: parseInt(this.data.form.expected.salary_max, 10) || 0,
      },
    };

    const errors = validateResume(form);
    const firstError = Object.values(errors)[0];
    if (firstError) {
      wx.showToast({ title: firstError, icon: 'none' });
      return;
    }

    wx.showLoading({ title: '生成中...' });
    try {
      const saveRes = await request({ url: '/resume/save', method: 'POST', data: { source_form: form } });
      const resumeId = saveRes.data.resume_id;
      await request({ url: '/resume/generate', method: 'POST', data: { resume_id: resumeId } });
      wx.hideLoading();
      wx.navigateTo({ url: '/pages/preview/preview' });
    } catch (e) {
      wx.hideLoading();
    }
  },
});