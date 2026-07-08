const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const config = require('../config');
const redis = require('../config/redis');
const { AppError } = require('../middleware/errorHandler');

/**
 * 仅允许 HS256 防止 alg=none 等攻击
 */
const ALLOWED_ALGS = ['HS256'];

// access token TTL 默认走 config（生产 JWT_EXPIRES_IN=15m 时生效）
// 老 30d token 也签兼容
const ACCESS_TTL = config.JWT_EXPIRES_IN || '15m';
const REFRESH_TTL = '30d';
const REFRESH_TTL_SEC = 60 * 60 * 24 * 30;
const ACCESS_TTL_SEC = 60 * 15;

function sign(payload, opts = {}) {
  return jwt.sign(payload, config.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: opts.expiresIn || ACCESS_TTL,
    jwtid: randomUUID(),
  });
}

function signRefresh(payload, family) {
  return jwt.sign(
    { ...payload, kind: 'refresh', family },
    config.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: REFRESH_TTL, jwtid: randomUUID() }
  );
}

function verify(token) {
  try {
    return jwt.verify(token, config.JWT_SECRET, { algorithms: ALLOWED_ALGS });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new AppError(1002, 'token expired', 401);
    }
    throw new AppError(1002, 'invalid jwt token', 401);
  }
}

function decode(token) {
  return jwt.decode(token);
}

// 黑名单 by jti
async function revoke(jti, ttlSec = REFRESH_TTL_SEC) {
  await redis.set(`jwt:bl:${jti}`, '1', 'EX', ttlSec);
}

async function isRevoked(jti) {
  return (await redis.get(`jwt:bl:${jti}`)) !== null;
}

// 维持 refresh 家族关系 —— 旧 jti → 新 jti，用于检测 reuse
async function rotateFamily(oldJti, newJti, familyId) {
  await redis.set(`jwt:fam:${familyId}:${oldJti}`, newJti, 'EX', REFRESH_TTL_SEC + 86400);
}

async function detectReuse(familyId, presentedJti) {
  // presented jti 已被旋转过 → 复用
  const rotated = await redis.get(`jwt:fam:${familyId}:${presentedJti}`);
  if (rotated) return true;
  const burned = await redis.get(`jwt:fam:burned:${familyId}`);
  return burned !== null;
}

async function burnFamily(familyId) {
  const keys = await redis.keys(`jwt:fam:${familyId}:*`);
  if (keys.length) await redis.del(...keys);
  await redis.set(`jwt:fam:burned:${familyId}`, '1', 'EX', REFRESH_TTL_SEC + 86400);
}

/**
 * Round 40: cookie theft detection helper.
 * 若请求里携带的 refresh jti 已在黑名单（rotation 后旧 jti 被 revoke），
 * 且 ≠ 当前 expected jti → 返回 true，调用方应烧 family + 清 cookie + 401。
 */
async function checkCookieTheft({ oldRefreshJti, currentRefreshJti }) {
  if (!oldRefreshJti || oldRefreshJti === currentRefreshJti) return false;
  return await isRevoked(oldRefreshJti);
}

// 语义化别名（spec 期望的命名）；与下方函数完全等价
const signAccess = (payload, opts) => sign(payload, opts);
const verifyAccess = (tokenStr) => verify(tokenStr);
const verifyRefresh = (tokenStr) => verify(tokenStr);
const revokeRefresh = (jti, ttlSec) => revoke(jti, ttlSec);
const isRefreshRevoked = (jti) => isRevoked(jti);

module.exports = {
  sign,
  signAccess,
  signRefresh,
  verify,
  verifyAccess,
  verifyRefresh,
  revoke,
  revokeRefresh,
  isRevoked,
  isRefreshRevoked,
  rotateFamily,
  detectReuse,
  burnFamily,
  checkCookieTheft,
  decode,
  REFRESH_TTL_SEC,
  ACCESS_TTL_SEC,
  ACCESS_TTL,
  REFRESH_TTL,
};
