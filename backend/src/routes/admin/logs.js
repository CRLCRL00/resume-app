const express = require('express');
const router = express.Router();
const { userAuth } = require('../../middleware/auth');
const { adminAuth } = require('../../middleware/adminAuth');
const { AppError } = require('../../middleware/errorHandler');
const pool = require('../../config/db');
const logger = require('../../utils/logger');

router.get('/logs', userAuth, adminAuth, async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(parseInt(req.query.pageSize, 10) || 20, 100);
    const offset = (page - 1) * pageSize;
    const [items] = await pool.query(
      'SELECT id, admin_openid, action, target_type, target_id, detail, ip, created_at FROM admin_operation_logs ORDER BY id DESC LIMIT ? OFFSET ?',
      [pageSize, offset]
    );
    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM admin_operation_logs');
    res.json({ code: 0, data: { items, total, page, pageSize } });
  } catch (err) { next(err); }
});

/**
 * GET /api/admin/logs/security — 只返 security.* 安全事件（高优先级审计）
 * Query: ?days=7 default
 */
router.get('/logs/security', userAuth, adminAuth, async (req, res, next) => {
  try {
    const days = Math.max(parseInt(req.query.days, 10) || 7, 1);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(parseInt(req.query.pageSize, 10) || 50, 200);
    const offset = (page - 1) * pageSize;
    const [items] = await pool.query(
      `SELECT id, admin_openid AS actor, action, target_id, detail, ip, created_at
       FROM admin_operation_logs
       WHERE action LIKE 'security.%' AND created_at > (NOW() - INTERVAL ? DAY)
       ORDER BY id DESC LIMIT ? OFFSET ?`,
      [days, pageSize, offset]
    );
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM admin_operation_logs
       WHERE action LIKE 'security.%' AND created_at > (NOW() - INTERVAL ? DAY)`,
      [days]
    );
    res.json({ code: 0, data: { items, total, page, pageSize, days } });
  } catch (err) { next(err); }
});

/**
 * DELETE /api/admin/logs/prune — admin trigger manual cleanup (>90 days)
 */
router.delete('/logs/prune', userAuth, adminAuth, async (req, res, next) => {
  try {
    const days = parseInt(req.query.days, 10) || 90;
    if (days < 7) throw new AppError(1000, 'days must be ≥ 7', 400);
    const [r] = await pool.query(
      'DELETE FROM admin_operation_logs WHERE created_at < (NOW() - INTERVAL ? DAY)',
      [days]
    );
    logger.info({ admin: req.user.openid, days, deleted: r.affectedRows }, 'admin log prune');
    res.json({ code: 0, data: { deleted: r.affectedRows, days } });
  } catch (err) { next(err); }
});

module.exports = router;
