const express = require('express');
const router = express.Router();
const { userAuth } = require('../../middleware/auth');
const { adminAuth } = require('../../middleware/adminAuth');
const { twoFactorRequired } = require('../../middleware/twoFactorRequired');
const { AppError } = require('../../middleware/errorHandler');
const { idempotency, idempotencyCapture } = require('../../middleware/idempotency');
const pool = require('../../config/db');
const adminLog = require('../../services/adminLog');

// LIKE escape: \ % _  → 字面字符
function escapeLike(s) {
  return String(s).replace(/[\\%_]/g, (m) => '\\' + m);
}

/**
 * GET /api/admin/users — 列出 admin 用户（未删除）
 * Query: ?page=&pageSize=&q=  (q 搜 openid + LEFT JOIN users.nickname)
 */
router.get('/users', userAuth, adminAuth, async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(parseInt(req.query.pageSize, 10) || 20, 100);
    const offset = (page - 1) * pageSize;
    const q = (req.query.q || '').toString().trim();
    if (q) {
      const like = `%${escapeLike(q)}%`;
      const [items] = await pool.query(
        `SELECT a.id, a.openid, a.note, a.created_at, u.nickname
         FROM admins a
         LEFT JOIN users u ON u.openid = a.openid
         WHERE a.openid LIKE ? OR u.nickname LIKE ?
         ORDER BY a.id DESC LIMIT ? OFFSET ?`,
        [like, like, pageSize, offset]
      );
      const [[{ total }]] = await pool.query(
        `SELECT COUNT(*) AS total
         FROM admins a
         LEFT JOIN users u ON u.openid = a.openid
         WHERE a.openid LIKE ? OR u.nickname LIKE ?`,
        [like, like]
      );
      return res.json({ code: 0, data: { items, total, page, pageSize, q } });
    }
    const [items] = await pool.query(
      `SELECT a.id, a.openid, a.note, a.created_at, u.nickname
       FROM admins a
       LEFT JOIN users u ON u.openid = a.openid
       ORDER BY a.id DESC LIMIT ? OFFSET ?`,
      [pageSize, offset]
    );
    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM admins');
    res.json({ code: 0, data: { items, total, page, pageSize } });
  } catch (err) { next(err); }
});

/**
 * POST /api/admin/users — 添加 admin
 * Body: { openid, note? }
 */
router.post('/users', userAuth, adminAuth, twoFactorRequired, idempotency({ prefix: 'admin-users' }), async (req, res, next) => {
  try {
    const { openid, note } = req.body || {};
    if (!openid || typeof openid !== 'string' || openid.length > 64) {
      throw new AppError(1000, 'openid 必填且 ≤ 64 字', 400);
    }
    // 检查 user 是否存在；不在 users 表则插占位
    await pool.query('INSERT IGNORE INTO users (openid) VALUES (?)', [openid]);
    const [r] = await pool.query(
      'INSERT IGNORE INTO admins (openid, note) VALUES (?, ?)',
      [openid, note || '']
    );
    await adminLog.record(req.user.openid, 'admin.add', 'admins', String(r.insertId || ''), { new_admin_openid: openid }, req.ip);
    res.json({ code: 0, data: { id: r.insertId, openid } });
  } catch (err) { next(err); }
}, idempotencyCapture());

/**
 * DELETE /api/admin/users/:openid — 删除 admin（不删 user row）
 */
router.delete('/users/:openid', userAuth, adminAuth, twoFactorRequired, idempotency({ prefix: 'admin-users' }), async (req, res, next) => {
  try {
    const openid = req.params.openid;
    if (!openid) throw new AppError(1000, 'openid required', 400);
    if (openid === req.user.openid) {
      throw new AppError(1000, '不能删除自己', 400);
    }
    const [r] = await pool.query('DELETE FROM admins WHERE openid = ?', [openid]);
    await adminLog.record(req.user.openid, 'admin.remove', 'admins', openid, null, req.ip);
    res.json({ code: 0, data: { deleted: r.affectedRows, openid } });
  } catch (err) { next(err); }
}, idempotencyCapture());

module.exports = router;
