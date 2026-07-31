const express = require('express');
const router = express.Router();
const { userAuth } = require('../middleware/auth');
const { resumeSchema } = require('../middleware/validate');
const { AppError } = require('../middleware/errorHandler');
const resumeGenerator = require('../services/resumeGenerator');
const rateLimit = require('../services/rateLimit');
const pool = require('../config/db');
const { sanitizeForLlmDeep } = require('../utils/sanitize');
const { idempotency, idempotencyCapture, captureBody } = require('../middleware/idempotency');

router.post('/save', userAuth, async (req, res, next) => {
  try {
    const { error, value } = resumeSchema.validate(req.body.source_form);
    if (error) throw new AppError(1000, error.message, 400);

    const userId = req.user.userId;
    // R136 fix: save 时同步生成 content_md (从 source_form 拼 markdown, 给 matchService LLM 评分用)
    // 不再 INSERT 空 content_md (LLM 评分时 '无简历内容,无法评估')
    const contentMd = buildContentMd(value);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('UPDATE resumes SET is_active = 0 WHERE user_id = ?', [userId]);
      const [r] = await conn.query(
        'INSERT INTO resumes (user_id, source_form, content_md, is_active) VALUES (?, ?, ?, 1)',
        [userId, JSON.stringify(value), contentMd]
      );
      await conn.commit();
      res.json({ code: 0, data: { resume_id: r.insertId, created_at: new Date().toISOString() } });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    next(err);
  }
});

/**
 * R136 fix: 从 source_form 拼 markdown content_md, 给 matchService LLM 评分用
 * 之前 save 时 content_md=空, LLM 评分返 score=0 "无简历内容,无法评估"
 */
function buildContentMd(form) {
  const lines = [];
  if (form.name) lines.push(`# ${form.name}`);
  if (form.expected) {
    lines.push(`## 期望`);
    lines.push(`- 城市: ${form.expected.city || ''}`);
    lines.push(`- 岗位: ${form.expected.position || ''}`);
    lines.push(`- 薪资: ${form.expected.salary_min || 0}-${form.expected.salary_max || 0} K/月`);
  }
  if (form.educations && form.educations.length) {
    lines.push(`## 教育背景`);
    for (const e of form.educations) {
      lines.push(`- ${e.school} | ${e.major || ''} | ${e.degree || ''} (${e.start || ''} - ${e.end || ''})`);
    }
  }
  if (form.experiences && form.experiences.length) {
    lines.push(`## 工作经历`);
    for (const x of form.experiences) {
      lines.push(`- **${x.company} | ${x.title}** (${x.start || ''} - ${x.end || ''})`);
      if (x.desc) lines.push(`  - ${x.desc}`);
    }
  }
  if (form.skills && form.skills.length) {
    lines.push(`## 技能: ${form.skills.join(', ')}`);
  }
  if (form.degree) lines.push(`## 学历: ${form.degree}`);
  return lines.join('\n');
}

async function generateHandler(req, res, next) {
  try {
    const { resume_id } = req.body;
    if (!resume_id) throw new AppError(1000, 'resume_id required', 400);

    const userId = req.user.userId;

    // 1. 限流
    const rl = await rateLimit.check(`generate:${userId}`, 4, 60);
    if (!rl.allowed) {
      throw new AppError(1429, '请求过于频繁，请稍后再试', 429);
    }

    // 2. 取 resume（含 content_md）
    const [rows] = await pool.query(
      'SELECT id, source_form, content_md FROM resumes WHERE id = ? AND user_id = ? LIMIT 1',
      [resume_id, userId]
    );
    if (!rows.length) throw new AppError(1004, 'resume not found', 404);

    const row = rows[0];
    const sourceForm = typeof row.source_form === 'string'
      ? JSON.parse(row.source_form)
      : row.source_form;

    // 3. DB 缓存命中
    if (row.content_md && row.content_md.length > 0) {
      return res.json({ code: 0, data: { resume_id, content_md: row.content_md, cached: true } });
    }

    // 4. 真调 LLM — 先 sanitize 用户文本（防 prompt injection）
    const safeForm = sanitizeForLlmDeep(sourceForm);
    const result = await resumeGenerator.generate(safeForm);
    // R-JobSearch-Insight-4: result 现在是 {resume, storyPoints, mode}
    // 向后兼容: contentMd 用 result.resume (fallback 到 plaintext)

    // 5. 写 DB (resume + story_points)
    await pool.query(
      'UPDATE resumes SET content_md = ?, story_points = ? WHERE id = ?',
      [result.resume, JSON.stringify(result.storyPoints || []), resume_id]
    );

    res.json({
      code: 0,
      data: {
        resume_id,
        content_md: result.resume,
        story_points: result.storyPoints || [],
        mode: result.mode || 'plaintext',
        cached: false,
      },
    });
  } catch (err) {
    next(err);
  }
}

router.post('/generate', userAuth, idempotency({ prefix: 'resume' }), captureBody(), generateHandler, idempotencyCapture());

router.get('/current', userAuth, async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const [rows] = await pool.query(
      'SELECT id, content_md, story_points, source_form FROM resumes WHERE user_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1',
      [userId]
    );
    if (!rows.length) throw new AppError(1005, 'no active resume', 404);

    const row = rows[0];
    const sourceForm = typeof row.source_form === 'string'
      ? JSON.parse(row.source_form)
      : row.source_form;
    const storyPoints = typeof row.story_points === 'string'
      ? JSON.parse(row.story_points || '[]')
      : (row.story_points || []);
    res.json({
      code: 0,
      data: {
        resume_id: row.id,
        content_md: row.content_md,
        story_points: storyPoints,
        source_form: sourceForm,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * R-JobSearch-Insight-4: 单独获取 STAR 故事点
 * GET /api/resume/story-points/:resumeId
 * 用途: 用户在准备面试时单独调,不用重新生成简历
 */
router.get('/story-points/:resumeId', userAuth, async (req, res, next) => {
  try {
    const resumeId = Number(req.params.resumeId);
    if (!Number.isFinite(resumeId)) throw new AppError(1000, 'resumeId must be numeric', 400);

    const [rows] = await pool.query(
      'SELECT story_points FROM resumes WHERE id = ? AND user_id = ? LIMIT 1',
      [resumeId, req.user.userId]
    );
    if (!rows.length) throw new AppError(1404, 'resume not found', 404);

    const storyPoints = typeof rows[0].story_points === 'string'
      ? JSON.parse(rows[0].story_points || '[]')
      : (rows[0].story_points || []);

    res.json({ code: 0, data: { resume_id: resumeId, story_points: storyPoints } });
  } catch (err) { next(err); }
});

module.exports = router;