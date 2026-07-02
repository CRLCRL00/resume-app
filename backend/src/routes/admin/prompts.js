const express = require('express');
const router = express.Router();
const { userAuth } = require('../../middleware/auth');
const { adminAuth } = require('../../middleware/adminAuth');
const { AppError } = require('../../middleware/errorHandler');
const { promptUpdateSchema, validateBody } = require('../../middleware/validate');
const pool = require('../../config/db');
const adminLog = require('../../services/adminLog');

router.get('/prompts', userAuth, adminAuth, async (req, res, next) => {
  try {
    const [items] = await pool.query(
      'SELECT id, code, name, version, is_active, updated_at FROM prompts WHERE is_active = 1 ORDER BY code'
    );
    res.json({ code: 0, data: { items } });
  } catch (err) { next(err); }
});

router.get('/prompts/:code', userAuth, adminAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT code, content, version, is_active, updated_at FROM prompts WHERE code = ? AND is_active = 1 LIMIT 1',
      [req.params.code]
    );
    if (!rows.length) throw new AppError(1004, 'prompt not found', 404);
    res.json({ code: 0, data: rows[0] });
  } catch (err) { next(err); }
});

router.put('/prompts/:code', userAuth, adminAuth, validateBody(promptUpdateSchema), async (req, res, next) => {
  try {
    const value = req.body;
    const code = req.params.code;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('UPDATE prompts SET is_active = 0 WHERE code = ? AND is_active = 1', [code]);
      const [vrows] = await conn.query('SELECT MAX(version) AS max_v FROM prompts WHERE code = ?', [code]);
      const newVersion = (vrows[0].max_v || 0) + 1;
      const [r] = await conn.query(
        'INSERT INTO prompts (code, name, content, version, is_active) VALUES (?, ?, ?, ?, 1)',
        [code, code, value.content, newVersion]
      );
      await conn.commit();
      await adminLog.record(req.user.openid, 'prompt.update', 'prompt', code,
        { old_version: vrows[0].max_v || 0, new_version: newVersion }, req.ip);
      res.json({ code: 0, data: { prompt_id: r.insertId, version: newVersion } });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) { next(err); }
});

module.exports = router;