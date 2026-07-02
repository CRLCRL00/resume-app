const pool = require('../config/db');
const { AppError } = require('./errorHandler');
const { requireCsrf } = require('./csrf');

async function adminAuthFn(req, res, next) {
  try {
    const [rows] = await pool.query(
      'SELECT id FROM admins WHERE openid = ? LIMIT 1',
      [req.user.openid]
    );
    if (!rows.length) {
      return next(new AppError(1003, 'admin only', 403));
    }
    next();
  } catch (err) {
    next(err);
  }
}

// adminAuth 作为中间件数组：先校验 admin 身份，再校验 CSRF（mutating 方法）
module.exports = { adminAuth: [adminAuthFn, requireCsrf], adminAuthFn };
