const express = require('express');
const router = express.Router();
const { userAuth } = require('../middleware/auth');
const { resumeSchema } = require('../middleware/validate');
const { AppError } = require('../middleware/errorHandler');
const { renderResume } = require('../services/resumeTemplate');
const pool = require('../config/db');

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
    const [rows] = await pool.query(
      'SELECT id, source_form FROM resumes WHERE id = ? AND user_id = ? LIMIT 1',
      [resume_id, userId]
    );
    if (!rows.length) throw new AppError(1004, 'resume not found', 404);

    const sourceForm = typeof rows[0].source_form === 'string'
      ? JSON.parse(rows[0].source_form)
      : rows[0].source_form;
    const contentMd = renderResume(sourceForm);

    await pool.query('UPDATE resumes SET content_md = ? WHERE id = ?', [contentMd, resume_id]);

    res.json({ code: 0, data: { resume_id, content_md: contentMd } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;