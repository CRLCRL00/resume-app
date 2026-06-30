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

async function match(userId, resumeId) {
  const [rows] = await pool.query(
    'SELECT id, source_form, content_md FROM resumes WHERE id = ? AND user_id = ? LIMIT 1',
    [resumeId, userId]
  );
  if (!rows.length) throw new AppError(1004, 'resume not found', 404);
  const resume = rows[0];
  const sourceForm = typeof resume.source_form === 'string'
    ? JSON.parse(resume.source_form) : resume.source_form;

  // 限流（路由层先 checkCache，这里只算真实调用）
  const rl = await rateLimit.check(`match:${userId}`, 4, 60);
  if (!rl.allowed) throw new AppError(1429, '请求过于频繁，请稍后再试', 429);

  // SQL 下推粗筛
  const userCity = sourceForm.expected?.city || '';
  const uMin = sourceForm.expected?.salary_min || 0;
  const uMax = sourceForm.expected?.salary_max || 0;
  const userDegreeRank = DEGREE_RANK[sourceForm.degree] || 0;

  const sqlFilters = ['is_online = 1', 'is_deleted = 0'];
  const sqlParams = [];
  if (userCity) { sqlFilters.push('city = ?'); sqlParams.push(userCity); }
  if (uMax > 0) { sqlFilters.push('salary_min <= ?'); sqlParams.push(uMax * 1.5); }
  if (uMin > 0) { sqlFilters.push('salary_max >= ?'); sqlParams.push(uMin * 0.8); }

  // 学历宽松：job.degree_required rank <= user.degree rank
  const degreeCases = Object.entries(DEGREE_RANK).map(([k, v]) => `WHEN '${k}' THEN ${v}`).join(' ');
  sqlFilters.push(`(degree_required = '不限' OR (${userDegreeRank} >= CASE degree_required ${degreeCases} ELSE 0 END))`);

  const [candidates] = await pool.query(
    `SELECT id, title, company, city, salary_min, salary_max, degree_required, experience_required, skills_required
     FROM jobs WHERE ${sqlFilters.join(' AND ')}
     ORDER BY sort_weight DESC, id ASC LIMIT 10`,
    sqlParams
  );

  // JS 兜底再 filter + slice top 5
  const filtered = coarseFilter(candidates, sourceForm, 5);

  if (!filtered.length) {
    return { results: [], batch_id: null, message: '暂未找到匹配岗位' };
  }

  // LLM 精排
  const batchId = `match_${Date.now()}_${userId}_${resumeId}`;
  const { system, user } = await buildPrompt(resume.content_md || 'no resume content', filtered);
  const llmResp = await llm.chatJson(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    { maxTokens: 1500, temperature: 0.5 }
  );

  // 校验
  const validJobIds = new Set(filtered.map(j => j.id));
  const validResults = (llmResp.parsed.results || [])
    .filter(r => validJobIds.has(r.job_id))
    .filter(r => typeof r.score === 'number' && r.score >= 0 && r.score <= 100)
    .map(r => ({ job_id: r.job_id, score: Math.round(r.score), reason: String(r.reason || '').slice(0, 60) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  // 写 matches 表
  if (validResults.length) {
    const values = validResults.map(r => [userId, resumeId, r.job_id, batchId, r.score, r.reason]);
    await pool.query(
      'INSERT INTO matches (user_id, resume_id, job_id, match_batch_id, score, reason) VALUES ?',
      [values]
    );
  }

  // 缓存 batch_id (24h) — redis 失败容忍
  await safeRedis('match.setBatchId',
    () => redis.set(`match:batch:${userId}:${resumeId}`, batchId, 'EX', 24 * 3600));

  // 关联 job 详情
  const jobMap = new Map(filtered.map(j => [j.id, j]));
  const enriched = validResults.map(r => {
    const j = jobMap.get(r.job_id);
    if (!j) return null;
    return {
      job_id: j.id, title: j.title, company: j.company, city: j.city,
      salary_min: j.salary_min, salary_max: j.salary_max,
      score: r.score, reason: r.reason,
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
      score: r.score, reason: r.reason,
    })),
    batch_id: batchId,
    cached: true,
  };
}

module.exports = { match, checkCache };
