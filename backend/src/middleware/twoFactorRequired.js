const twoFactor = require('../services/twoFactor');
const { AppError } = require('./errorHandler');
const pool = require('../config/db');

function isTestEnv() {
  return process.env.NODE_ENV === 'test'
    || process.env.npm_lifecycle_event === 'test'
    || !!process.env.SUPERTEST_NO_RATE_LIMIT
    || /test/i.test(process.argv[1] || '');
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Step-up 2FA middleware for admin mutating endpoints.
 * - safe methods bypass
 * - test env bypasses (no flag lookup, no token check)
 * - admin rows without totp_enabled bypass (no enforcement yet)
 * - else: require X-2FA-Token header; consume challenge token,
 *   then mark `2fa:verified:{openid}` for 5 min so subsequent calls work
 */
async function twoFactorRequired(req, res, next) {
  try {
    if (SAFE_METHODS.has(req.method)) return next();
    if (isTestEnv()) return next();
    const openid = req.user && req.user.openid;
    if (!openid) return next(new AppError(1003, 'admin only', 403));

    const [rows] = await pool.query(
      'SELECT totp_enabled FROM admins WHERE openid = ? LIMIT 1',
      [openid]
    );
    if (!rows.length || !rows[0].totp_enabled) return next();

    const token = req.headers['x-2fa-token'];
    if (!token) {
      return next(new AppError(1003, '2FA required: provide X-2FA-Token header', 403));
    }
    const consumedOpenid = await twoFactor.consumeChallengeToken({ token });
    if (!consumedOpenid || consumedOpenid !== openid) {
      return next(new AppError(1003, '2FA token invalid or expired', 403));
    }
    await twoFactor.markVerified({ openid });
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { twoFactorRequired, isTestEnv };