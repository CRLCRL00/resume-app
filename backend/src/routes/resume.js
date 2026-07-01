const express = require('express');
const router = express.Router();
const { userAuth } = require('../middleware/auth');
const { resumeSchema } = require('../middleware/validate');
const { AppError } = require('../middleware/errorHandler');
const resumeGenerator = require('../services/resumeGenerator');
const rateLimit = require('../services/rateLimit');
const pool = require('../config/db');
const { sanitizeForLlm, sanitizeForLlmDeep } = require('../utils/sanitize');

router.post('/save', userAuth, async (req, res, next) => {
  try {
    const { error, value } = resumeSchema.validate(req.body.source_form);
    if (error) throw new AppError(1000, error.message, 400);

    const userId = req.user.userId;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('UPDATE resumes SET is_active = 0 WHERE user_id = ?', [userId]);
      const [r] = await conn.query(
        'INSERT INTO resumes (user_id, source_form, content_md, is_active) VALUES (?, ?, ?, 1)',
        [userId, JSON.stringify(value), '']
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

router.post('/generate', userAuth, async (req, res, next) => {
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
    const contentMd = await resumeGenerator.generate(safeForm);

    // 5. 写 DB
    await pool.query('UPDATE resumes SET content_md = ? WHERE id = ?', [contentMd, resume_id]);

    res.json({ code: 0, data: { resume_id, content_md: contentMd, cached: false } });
  } catch (err) {
    next(err);
  }
});

router.get('/current', userAuth, async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const [rows] = await pool.query(
      'SELECT id, content_md, source_form FROM resumes WHERE user_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1',
      [userId]
    );
    if (!rows.length) throw new AppError(1005, 'no active resume', 404);

    const row = rows[0];
    const sourceForm = typeof row.source_form === 'string'
      ? JSON.parse(row.source_form)
      : row.source_form;
    res.json({ code: 0, data: { resume_id: row.id, content_md: row.content_md, source_form: sourceForm } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;