const express = require('express');
const router = express.Router();
const { userAuth } = require('../../middleware/auth');
const { adminAuth } = require('../../middleware/adminAuth');
const pool = require('../../config/db');

// LIKE escape: \ % _  → 字面字符
function escapeLike(s) {
  return String(s).replace(/[\\%_]/g, (m) => '\\' + m);
}

/**
 * GET /api/admin/resumes/search — 简历全文搜索 (admin)
 * Query: ?q=&page=&pageSize=
 *   q 搜: users.nickname / users.openid / resumes.source_form JSON 内
 *       name / education[].school / experience[].company
 */
router.get('/resumes/search', userAuth, adminAuth, async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(parseInt(req.query.pageSize, 10) || 20, 100);
    const offset = (page - 1) * pageSize;
    const q = (req.query.q || '').toString().trim();
    if (q) {
      const like = `%${escapeLike(q)}%`;
      const [items] = await pool.query(
        `SELECT r.id, r.user_id, r.source_form, r.is_active, r.created_at, r.updated_at,
                u.openid, u.nickname
         FROM resumes r
         LEFT JOIN users u ON u.id = r.user_id
         WHERE u.nickname LIKE ?
            OR u.openid LIKE ?
            OR JSON_UNQUOTE(JSON_EXTRACT(r.source_form, '$.name')) LIKE ?
            OR JSON_UNQUOTE(JSON_EXTRACT(r.source_form, '$.education[0].school')) LIKE ?
            OR JSON_UNQUOTE(JSON_EXTRACT(r.source_form, '$.experience[0].company')) LIKE ?
         ORDER BY r.id DESC LIMIT ? OFFSET ?`,
        [like, like, like, like, like, pageSize, offset]
      );
      const [[{ total }]] = await pool.query(
        `SELECT COUNT(*) AS total
         FROM resumes r
         LEFT JOIN users u ON u.id = r.user_id
         WHERE u.nickname LIKE ?
            OR u.openid LIKE ?
            OR JSON_UNQUOTE(JSON_EXTRACT(r.source_form, '$.name')) LIKE ?
            OR JSON_UNQUOTE(JSON_EXTRACT(r.source_form, '$.education[0].school')) LIKE ?
            OR JSON_UNQUOTE(JSON_EXTRACT(r.source_form, '$.experience[0].company')) LIKE ?`,
        [like, like, like, like, like]
      );
      return res.json({ code: 0, data: { items, total, page, pageSize, q } });
    }
    const [items] = await pool.query(
      `SELECT r.id, r.user_id, r.source_form, r.is_active, r.created_at, r.updated_at,
              u.openid, u.nickname
       FROM resumes r
       LEFT JOIN users u ON u.id = r.user_id
       ORDER BY r.id DESC LIMIT ? OFFSET ?`,
      [pageSize, offset]
    );
    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM resumes');
    res.json({ code: 0, data: { items, total, page, pageSize } });
  } catch (err) { next(err); }
});

module.exports = router;
