function validateJob(form) {
  const errors = {};
  if (!form.title) errors.title = '岗位名必填';
  if (!form.company) errors.company = '公司必填';
  if (!form.city) errors.city = '城市必填';
  if (form.salary_max != null && form.salary_min != null && form.salary_max < form.salary_min) {
    errors.salary = '薪资上限不能低于下限';
  }
  if (!form.description_md || form.description_md.length < 10) {
    errors.description_md = '描述至少 10 字';
  }
  if (form.description_md && form.description_md.length > 20000) {
    errors.description_md = '描述不能超过 20000 字';
  }
  return errors;
}

function validatePrompt(form) {
  const errors = {};
  if (!form.content || !form.content.trim()) errors.content = '内容必填';
  if (form.content && form.content.length > 50000) errors.content = '内容不能超过 50000 字';
  return errors;
}

module.exports = { validateJob, validatePrompt };