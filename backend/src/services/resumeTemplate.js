function renderResume(form) {
  const lines = [];
  lines.push(`# ${form.name}`);
  lines.push('');
  lines.push('## 基本信息');
  lines.push(`- 性别：${form.gender}`);
  lines.push(`- 学历：${form.degree}`);
  lines.push(`- 联系方式：${form.phone || '未提供'}`);
  lines.push('');

  lines.push('## 教育经历');
  for (const e of form.educations) {
    lines.push(`### ${e.school} (${e.start} - ${e.end})`);
    lines.push(`- 专业：${e.major}`);
    lines.push(`- 学历：${e.degree}`);
    lines.push('');
  }

  lines.push('## 工作经历');
  for (const x of form.experiences) {
    lines.push(`### ${x.company} - ${x.title} (${x.start} - ${x.end})`);
    lines.push(x.desc);
    lines.push('');
  }

  lines.push('## 求职期望');
  lines.push(`- 城市：${form.expected.city}`);
  lines.push(`- 岗位：${form.expected.position}`);
  lines.push(`- 薪资：${form.expected.salary_min}K - ${form.expected.salary_max}K`);
  lines.push('');

  lines.push('## 技能');
  lines.push(form.skills.join('、'));

  return lines.join('\n');
}

module.exports = { renderResume };
