const { verify, isRevoked } = require('../services/token');
const redis = require('../config/redis');
const { AppError } = require('./errorHandler');
const logger = require('../utils/logger');

// 用户态校验：access token 路径。
// 注意：production 登录响应现在同时返回 refreshToken（见 routes/auth.js /login）。
// 本中间件继续接受历史签发的 30d JWT（依赖 services/token.verify），保证
// 老 token / 旧测试调用 services/token.sign() 仍能通过。refresh 链由
// services/token.{signRefresh,revoke,burnFamily} 单独维护。
async function userAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return next(new AppError(1002, 'missing token', 401));
  }
  const token = auth.slice(7);
  try {
    const payload = verify(token);
    // jti 黑名单优先；老 token 无 jti 回退到 key 级黑名单
    const jti = payload && payload.jti;
    if (jti) {
      const revoked = await safeCheckJti(jti);
      if (revoked) return next(new AppError(1002, 'token revoked', 401));
    } else {
      const blacklisted = await safeCheckBlacklist(token);
      if (blacklisted) return next(new AppError(1002, 'token revoked', 401));
    }
    req.user = payload;
    req.token = token;
    next();
  } catch (err) {
    next(err);
  }
}

async function safeCheckJti(jti) {
  try {
    return await isRevoked(jti);
  } catch (e) {
    // Round 33 chaos follow-up #2: observability — fail-open preserved,
    // but emit a warn so operators can correlate 401 with Redis outage.
    logger.warn({ jti, err: e.message }, 'token revocation check failed; failing open');
    return false; // redis 故障 fail-open
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
