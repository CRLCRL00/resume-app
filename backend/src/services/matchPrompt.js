const pool = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

async function build(resumeContent, jobs) {
  const [rows] = await pool.query(
    "SELECT content FROM prompts WHERE code = 'match_rerank' AND is_active = 1 LIMIT 1"
  );
  if (!rows.length) throw new AppError(1200, 'match_rerank prompt not configured', 500);

  const jobsJson = JSON.stringify(jobs.map(j => ({
    job_id: j.id, title: j.title, company: j.company, city: j.city,
    salary_min: j.salary_min, salary_max: j.salary_max,
    degree_required: j.degree_required, experience_required: j.experience_required,
    skills_required: j.skills_required,
  })), null, 2);

  const fullPrompt = rows[0].content
    .replace('{resume}', resumeContent)
    .replace('{jobs}', jobsJson);

  return {
    system: '你是专业的岗位匹配专家，严格按要求的 JSON 格式输出结果。',
    user: fullPrompt,
  };
}

module.exports = { build };
