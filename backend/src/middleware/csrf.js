const redis = require('../config/redis');
const crypto = require('node:crypto');

const isTest = () => process.env.NODE_ENV === 'test' || process.env.npm_lifecycle_event === 'test';
const TTL_SECONDS = 60 * 60 * 8; // 8h matches JWT

/**
 * Issue a CSRF token, store in Redis keyed by openid + jti.
 * Call from login route after issuing access/refresh tokens.
 * @returns {Promise<string>} csrf token
 */
async function issueCsrf(openid, accessJti) {
  const token = crypto.randomBytes(24).toString('base64url');
  await redis.set(`csrf:${openid}:${accessJti}`, token, 'EX', TTL_SECONDS);
  return token;
}

/**
 * Express middleware: require X-CSRF-Token header on mutating methods.
 * Skip for safe methods (GET/HEAD/OPTIONS).
 * Skip in test env.
 * Requires req.user.openid + req.user.jti (set by auth middleware).
 */
function requireCsrf(req, res, next) {
  if (isTest()) return next();
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.user || !req.user.openid || !req.user.jti) {
    return res.status(401).json({ code: 401, message: 'unauthenticated' });
  }
  const expected = (req.headers['x-csrf-token'] || '').trim();
  if (!expected) {
    return res.status(403).json({ code: 403, message: 'CSRF token required' });
  }
  redis.get(`csrf:${req.user.openid}:${req.user.jti}`)
    .then(stored => {
      if (!stored || stored !== expected) {
        return res.status(403).json({ code: 403, message: 'CSRF token mismatch' });
      }
      next();
    })
    .catch(() => {
      // Redis down -> fail open (avoid blocking legit users)
      next();
    });
}

module.exports = { issueCsrf, requireCsrf };