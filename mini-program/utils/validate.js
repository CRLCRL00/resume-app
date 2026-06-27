function validatePhone(phone) {
  if (!phone) return true;
  return /^1[3-9]\d{9}$/.test(phone);
}

function validateYearMonth(s) {
  if (s === '至今') return true;
  return /^(\d{4})-(0[1-9]|1[0-2])$/.test(s);
}

function validateResume(form) {
  const errors = {};
  if (!form.name) errors.name = '姓名必填';
  if (!['male', 'female', 'other'].includes(form.gender)) errors.gender = '性别必填';
  if (!form.degree) errors.degree = '学历必填';

  if (!form.educations?.length) errors.educations = '至少 1 段教育';
  if (!form.experiences?.length) errors.experiences = '至少 1 段工作';
  if (!form.expected) errors.expected = '期望必填';
  else if (form.expected.salary_max < form.expected.salary_min) {
    errors.expected = '薪资上限不能低于下限';
  }

  if (!form.skills?.length) errors.skills = '至少 1 个技能';

  return errors;
}

module.exports = { validatePhone, validateYearMonth, validateResume };