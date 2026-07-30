const pool = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

/**
 * R-JobSearch 重构版:
 * - 加 verify_status 字段 (基于求职 verify 过的真实岗位)
 * - 要求 LLM 输出 match_score 0-100 (前端展示除以 10)
 * - 要求 LLM 输出 interview_focus (面试重点准备方向)
 *
 * @param {string} resumeContent - 用户简历内容 (Markdown)
 * @param {Array} jobs - 候选岗位 (含 verify_status 字段)
 * @returns {Promise<{system: string, user: string}>}
 */
async function build(resumeContent, jobs) {
  const [rows] = await pool.query(
    "SELECT content FROM prompts WHERE code = 'match_rerank' AND is_active = 1 LIMIT 1"
  );
  if (!rows.length) throw new AppError(1200, 'match_rerank prompt not configured', 500);

  // R-JobSearch: 加 verify_status + verified_at 字段到 jobs JSON
  const jobsJson = JSON.stringify(jobs.map(j => ({
    job_id: j.id,
    title: j.title,
    company: j.company,
    city: j.city,
    salary_min: j.salary_min,
    salary_max: j.salary_max,
    degree_required: j.degree_required,
    experience_required: j.experience_required,
    skills_required: j.skills_required,
    verify_status: j.verify_status || 'unverified', // verified / stale / unverified
    verified_at: j.verified_at || null,
  })), null, 2);

  const fullPrompt = rows[0].content
    .replace('{resume}', resumeContent)
    .replace('{jobs}', jobsJson);

  return {
    // R-JobSearch: 系统提示强调 verify_status 和面试重点
    system: `你是专业的岗位匹配专家,严格按要求的 JSON 格式输出结果。
评分时考虑:
1. 技能匹配度 (核心)
2. 经验匹配度
3. 学历匹配度 (学历不足时适当降低,但不全扣)
4. verify_status:verified 的岗位加分 (说明现在真实在招)
5. AI 协作项目经验:如果有 AI 协作 / Coze / Dify / DeepSeek 相关项目,加分`,
    user: fullPrompt,
  };
}

module.exports = { build };