const { request } = require('../../../utils/request');
const { parseSkills } = require('../../../utils/format');

Page({
  data: {
    id: null,
    skillsInput: '',
    form: {
      title: '', company: '', city: '',
      salary_min: '', salary_max: '',
      degree_required: '不限', experience_required: '不限',
      description_md: '',
    },
  },

  onLoad(query) {
    if (query.id) {
      this.setData({ id: query.id });
      this.load(query.id);
    }
  },

  async load(id) {
    try {
      const res = await request({ url: `/admin/jobs?page=1&pageSize=100` });
      const job = res.data.items.find(j => String(j.id) === String(id));
      if (job) {
        // 注意：列表不返 description_md，需要 GET /api/jobs/:id（Phase 5 加）
        // MVP: 这里先用列表里有的字段，description_md 留空让用户重新填
        this.setData({
          form: {
            title: job.title, company: job.company, city: job.city,
            salary_min: job.salary_min, salary_max: job.salary_max,
            degree_required: '不限', experience_required: '不限',
            description_md: '',
          },
        });
      }
    } catch (e) {}
  },

  setField(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  setSkillsInput(e) {
    this.setData({ skillsInput: e.detail.value });
  },

  async submit() {
    const form = {
      ...this.data.form,
      salary_min: parseInt(this.data.form.salary_min, 10) || 0,
      salary_max: parseInt(this.data.form.salary_max, 10) || 0,
      skills_required: parseSkills(this.data.skillsInput),
    };
    if (form.salary_max < form.salary_min) {
      wx.showToast({ title: '薪资上限不能低于下限', icon: 'none' });
      return;
    }
    try {
      if (this.data.id) {
        await request({ url: `/admin/jobs/${this.data.id}`, method: 'PUT', data: form });
      } else {
        await request({ url: '/admin/jobs', method: 'POST', data: form });
      }
      wx.showToast({ title: '保存成功' });
      setTimeout(() => wx.navigateBack(), 1000);
    } catch (err) {}
  },
});
