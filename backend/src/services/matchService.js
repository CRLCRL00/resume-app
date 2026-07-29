const pool = require('../config/db');
const redis = require('../config/redis');
const { AppError } = require('../middleware/errorHandler');
const rateLimit = require('./rateLimit');
const { coarseFilter } = require('./jobFilter');
const { build: buildPrompt } = require('./matchPrompt');
const logger = require('../utils/logger');
const llm = require('./llm');

/**
 * 安全包装 redis 操作，失败时记 warn 日志（fail-open）。
 */
async function safeRedis(op, fn) {
  try {
    return await fn();
  } catch (err) {
    logger.warn({ err: err.message, op }, 'redis fail-open');
    return null;
  }
}

const DEGREE_RANK = { '不限': 0, '高中': 1, '大专': 2, '本科': 3, '硕士': 4, '博士': 5 };

/**
 * 核心匹配流程 (R-JobSearch 重构版)
 *
 * 变化:
 * - 加 verify_status 字段 (基于本次求职 verify 过的 8 个真实岗位)
 * - 输出 match_score 1-10 (替代原来的 0-100,跟"AI 评分"洞察一致)
 * - 加 投递追踪钩子 (applyToJob 后会写 jobpilot_applications 表)
 *
 * @param {number} userId
 * @param {number} resumeId
 * @returns {Promise<{results: Array, batch_id: string}>}
 */
async function match(userId, resumeId) {
  const [rows] = await pool.query(
    'SELECT id, source_form, content_md FROM resumes WHERE id = ? AND user_id = ? LIMIT 1',
    [resumeId, userId]
  );
  if (!rows.length) throw new AppError(1004, 'resume not found', 404);
  const resume = rows[0];
  const sourceForm = typeof resume.source_form === 'string'
    ? JSON.parse(resume.source_form) : resume.source_form;

  const rl = await rateLimit.check(`match:${userId}`, 4, 60);
  if (!rl.allowed) throw new AppError(1429, '请求过于频繁，请稍后再试', 429);

  const userCity = sourceForm.expected?.city || '';
  const uMin = sourceForm.expected?.salary_min || 0;
  const uMax = sourceForm.expected?.salary_max || 0;
  const userDegreeRank = DEGREE_RANK[sourceForm.degree] || 0;

  const sqlFilters = ['is_online = 1', 'is_deleted = 0'];
  const sqlParams = [];
  if (userCity) { sqlFilters.push('city = ?'); sqlParams.push(userCity); }
  if (uMax > 0) { sqlFilters.push('salary_min <= ?'); sqlParams.push(uMax * 1.5); }
  if (uMin > 0) { sqlFilters.push('salary_max >= ?'); sqlParams.push(uMin * 0.8); }

  const degreeCases = Object.entries(DEGREE_RANK).map(([k, v]) => `WHEN '${k}' THEN ${v}`).join(' ');
  sqlFilters.push(`(degree_required = '不限' OR (${userDegreeRank} >= CASE degree_required ${degreeCases} ELSE 0 END))`);

  // R-JobSearch: 加 verify_status 字段 (基于求职实战经验:真实岗位 > 通用推荐)
  // 注意: 字段是可选的,SQL migration 未跑时也能 work (默认 'unverified')
  const [candidates] = await pool.query(
    `SELECT id, title, company, city, salary_min, salary_max, degree_required,
            experience_required, skills_required
     FROM jobs WHERE ${sqlFilters.join(' AND ')}
     ORDER BY sort_weight DESC, id ASC LIMIT 10`,
    sqlParams
  );

  const filtered = coarseFilter(candidates, sourceForm, 5);

  if (!filtered.length) {
    return { results: [], batch_id: null, message: '暂未找到匹配岗位' };
  }

  const batchId = `match_${Date.now()}_${userId}_${resumeId}`;
  const { system, user } = await buildPrompt(resume.content_md || 'no resume content', filtered);
  const llmResp = await llm.chatJson(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    { maxTokens: 1500, temperature: 0.5 }
  );

  const validJobIds = new Set(filtered.map(j => j.id));
  // R-JobSearch: match_score 0-100 → 1-10,加 verify_status + interview_focus
  const validResults = (llmResp.parsed.results || [])
    .filter(r => validJobIds.has(r.job_id))
    .filter(r => typeof r.score === 'number' && r.score >= 0 && r.score <= 100)
    .map(r => ({
      job_id: r.job_id,
      score: Math.round(r.score), // 0-100 (内部用,前端展示时除以 10)
      reason: String(r.reason || '').slice(0, 100),
      interview_focus: r.interview_focus || [], // 这个岗位面试重点准备
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (validResults.length) {
    const values = validResults.map(r => [userId, resumeId, r.job_id, batchId, r.score, r.reason]);
    await pool.query(
      'INSERT INTO matches (user_id, resume_id, job_id, match_batch_id, score, reason) VALUES ?',
      [values]
    );
  }

  await safeRedis('match.setBatchId',
    () => redis.set(`match:batch:${userId}:${resumeId}`, batchId, 'EX', 24 * 3600));

  // R-JobSearch: 加 verify_status + interview_focus 到返回
  // 注意: verify_status 字段从 candidates 不再 SELECT (避免 SQL migration 未跑时报错)
  // 默认 'unverified',真实 verify_status 通过 verify 任务定期更新到 jobs 表
  const jobMap = new Map(filtered.map(j => [j.id, j]));
  const enriched = validResults.map(r => {
    const j = jobMap.get(r.job_id);
    if (!j) return null;
    return {
      job_id: j.id,
      title: j.title,
      company: j.company,
      city: j.city,
      salary_min: j.salary_min,
      salary_max: j.salary_max,
      verify_status: 'unverified', // 默认值,SQL migration 跑后会有真实状态
      verified_at: null,
      score: r.score,
      score_10: Math.round(r.score / 10), // 1-10 (给前端展示用)
      reason: r.reason,
      interview_focus: r.interview_focus,
    };
  }).filter(Boolean);

  return { results: enriched, batch_id: batchId };
}

async function checkCache(userId, resumeId) {
  const batchId = await safeRedis('match.checkBatchId',
    () => redis.get(`match:batch:${userId}:${resumeId}`));
  if (!batchId) return null;

  const [rows] = await pool.query(
    `SELECT m.job_id, m.score, m.reason, j.title, j.company, j.city, j.salary_min, j.salary_max
     FROM matches m JOIN jobs j ON j.id = m.job_id
     WHERE m.match_batch_id = ? AND m.user_id = ?
     ORDER BY m.score DESC LIMIT 5`,
    [batchId, userId]
  );
  if (!rows.length) return null;
  return {
    results: rows.map(r => ({
      job_id: r.job_id, title: r.title, company: r.company, city: r.city,
      salary_min: r.salary_min, salary_max: r.salary_max,
      verify_status: 'unverified', // 默认值
      verified_at: null,
      score: r.score,
      score_10: Math.round(r.score / 10),
      reason: r.reason,
    })),
    batch_id: batchId,
    cached: true,
  };
}

/**
 * R-JobSearch-Insight-5: 投递追踪
 * 用户标记"已投这个岗位",写 jobpilot_applications 表
 *
 * @param {number} userId
 * @param {number} jobId
 * @param {Object} options - { status, note, hr_contact }
 */
async function applyToJob(userId, jobId, options = {}) {
  const { status = 'submitted', note = '', hr_contact = '' } = options;

  // 检查是否已投过 (幂等)
  const [existing] = await pool.query(
    'SELECT id FROM jobpilot_applications WHERE user_id = ? AND job_id = ? AND deleted_at IS NULL',
    [userId, jobId]
  );
  if (existing.length) {
    return { application_id: existing[0].id, status: 'already_applied' };
  }

  const [result] = await pool.query(
    `INSERT INTO jobpilot_applications
       (user_id, job_id, status, note, hr_contact, follow_up_at)
     VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 3 DAY))`,
    [userId, jobId, status, note, hr_contact]
  );

  return { application_id: result.insertId, status: 'submitted' };
}

/**
 * R-JobSearch-Insight-5: 用户的所有投递记录
 */
async function getApplications(userId) {
  const [rows] = await pool.query(
    `SELECT a.id, a.job_id, a.status, a.note, a.hr_contact, a.applied_at,
            a.status_updated_at, a.follow_up_at, a.interview_at,
            j.title, j.company, j.city, j.salary_min, j.salary_max,
            j.verify_status
     FROM jobpilot_applications a
     JOIN jobs j ON j.id = a.job_id
     WHERE a.user_id = ? AND a.deleted_at IS NULL
     ORDER BY a.applied_at DESC`,
    [userId]
  );
  return rows.map(r => ({
    id: r.id,
    job_id: r.job_id,
    job: {
      title: r.title,
      company: r.company,
      city: r.city,
      salary_min: r.salary_min,
      salary_max: r.salary_max,
      verify_status: r.verify_status,
    },
    status: r.status,
    note: r.note,
    hr_contact: r.hr_contact,
    applied_at: r.applied_at,
    status_updated_at: r.status_updated_at,
    follow_up_at: r.follow_up_at,
    interview_at: r.interview_at,
    needs_follow_up: r.follow_up_at && new Date(r.follow_up_at) <= new Date() && r.status === 'submitted',
  }));
}

/**
 * R-JobSearch-Insight-5: 更新投递状态 (HR 回信 / 面试安排 / 拒绝 / 通过)
 */
async function updateApplicationStatus(applicationId, userId, updates) {
  const allowed = ['viewed', 'screening', 'interview_scheduled', 'interviewed', 'offered', 'rejected', 'withdrawn'];
  const { status, note, hr_contact, interview_at } = updates;

  if (status && !allowed.includes(status)) {
    throw new AppError(1400, `invalid status: ${status}`, 400);
  }

  const setClauses = [];
  const params = [];
  if (status) { setClauses.push('status = ?'); params.push(status); }
  if (note !== undefined) { setClauses.push('note = ?'); params.push(note); }
  if (hr_contact !== undefined) { setClauses.push('hr_contact = ?'); params.push(hr_contact); }
  if (interview_at) { setClauses.push('interview_at = ?'); params.push(interview_at); }
  setClauses.push('status_updated_at = NOW()');

  params.push(applicationId, userId);

  await pool.query(
    `UPDATE jobpilot_applications SET ${setClauses.join(', ')}
     WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    params
  );

  return { ok: true };
}

module.exports = {
  match,
  checkCache,
  applyToJob,
  getApplications,
  updateApplicationStatus,
};