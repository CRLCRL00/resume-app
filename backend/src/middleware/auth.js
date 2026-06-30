const { verify } = require('../services/token');
const redis = require('../config/redis');
const { AppError } = require('./errorHandler');

async function userAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return next(new AppError(1002, 'missing token', 401));
  }
  const token = auth.slice(7);
  try {
    const payload = verify(token);
    req.user = payload;
    // 检查 JWT 黑名单（如 logout 后该 token 应被拒）
    const blacklisted = await safeCheckBlacklist(token);
    if (blacklisted) return next(new AppError(1002, 'token revoked', 401));
    req.token = token;
    next();
  } catch (err) {
    next(err);
  }
}

async function safeCheckBlacklist(token) {
  try {
    return !!(await redis.get(`jwt:blacklist:${token}`));
  } catch (_e) {
    return false; // redis 故障 fail-open
  }
}

module.exports = { userAuth };
