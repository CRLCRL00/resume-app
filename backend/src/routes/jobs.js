const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) throw new AppError(1000, 'invalid id', 400);
    const [rows] = await pool.query(
      `SELECT id, title, company, city, salary_min, salary_max,
              degree_required, experience_required, skills_required, description_md,
              is_online, is_deleted, created_at
       FROM jobs WHERE id = ? AND is_online = 1 AND is_deleted = 0 LIMIT 1`,
      [id]
    );
    if (!rows.length) throw new AppError(1004, 'job not found', 404);
    const j = rows[0];
    if (typeof j.skills_required === 'string') j.skills_required = JSON.parse(j.skills_required);
    res.json({ code: 0, data: j });
  } catch (err) { next(err); }
});

module.exports = router;