const express = require('express');
const router = express.Router();
const { userAuth } = require('../../middleware/auth');
const { adminAuth } = require('../../middleware/adminAuth');
const pool = require('../../config/db');

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

module.exports = router;