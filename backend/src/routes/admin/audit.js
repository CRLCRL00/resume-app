const express = require('express');
const router = express.Router();
const { userAuth } = require('../../middleware/auth');
const { adminAuth } = require('../../middleware/adminAuth');
const pool = require('../../config/db');

/**
 * GET /api/admin/audit
 * Query params:
 *   - openid: filter by openid (exact match)
 *   - action: filter by action prefix (LIKE 'POST /api/admin/jobs%')
 *   - target_type: filter
 *   - target_id: filter (exact)
 *   - status: filter (e.g. '200' / '4xx' / '5xx')
 *   - since: ISO date string (created_at >= since)
 *   - until: ISO date string (created_at <= until)
 *   - limit: default 50, max 200
 *   - offset: default 0
 * Returns: { code: 0, data: { rows: [...], total: N, limit, offset } }
 */
router.get('/audit', userAuth, adminAuth, async (req, res, next) => {
  try {
    const {
      openid, action, target_type, target_id, status, since, until,
    } = req.query;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const where = [];
    const params = [];
    if (openid) { where.push('openid = ?'); params.push(String(openid)); }
    if (action) { where.push('action LIKE ?'); params.push(`${String(action)}%`); }
    if (target_type) { where.push('target_type = ?'); params.push(String(target_type)); }
    if (target_id) { where.push('target_id = ?'); params.push(String(target_id)); }
    if (status) {
      if (status === '2xx') where.push('status >= 200 AND status < 300');
      else if (status === '4xx') where.push('status >= 400 AND status < 500');
      else if (status === '5xx') where.push('status >= 500 AND status < 600');
      else { where.push('status = ?'); params.push(Number(status)); }
    }
    if (since) { where.push('created_at >= ?'); params.push(new Date(since)); }
    if (until) { where.push('created_at <= ?'); params.push(new Date(until)); }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM admin_audit ${whereSql}`,
      params
    );
    const total = Number(countRows[0]?.total || 0);

    const [rows] = await pool.query(
      `SELECT id, openid, action, target_type, target_id, method, path, ip, status, request_id, created_at
       FROM admin_audit ${whereSql}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({
      code: 0,
      data: {
        rows,
        total,
        limit,
        offset,
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;