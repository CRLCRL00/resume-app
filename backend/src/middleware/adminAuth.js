const pool = require('../config/db');
const { AppError } = require('./errorHandler');

async function adminAuth(req, res, next) {
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

module.exports = { adminAuth };
