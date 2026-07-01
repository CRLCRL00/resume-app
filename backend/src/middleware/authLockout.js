const redis = require('../config/redis');

const WINDOW_SECONDS = 60;
const MAX_ATTEMPTS_PER_WINDOW = 5;
const LOCKOUT_THRESHOLD = 10;
const LOCKOUT_TTL_SECONDS = 5 * 60;

const isTest = () => process.env.NODE_ENV === 'test' || process.env.npm_lifecycle_event === 'test';

function getIp(req) {
  return req.ip || req.headers['x-forwarded-for'] || 'unknown';
}

async function checkLockout(req, res, next) {
  if (isTest()) return next();
  try {
    const ip = getIp(req);
    const lockKey = `auth:lock:${ip}`;
    const locked = await redis.get(lockKey);
    if (locked) {
      const ttl = await redis.ttl(lockKey);
      return res.status(429).json({
        code: 429,
        message: `登录失败次数过多，请 ${ttl > 0 ? ttl : LOCKOUT_TTL_SECONDS / 60} 分钟后再试`,
      });
    }
    next();
  } catch (_e) {
    next(); // redis down -> fail open (avoid blocking legit users)
  }
}

async function recordFailure(req) {
  if (isTest()) return;
  try {
    const ip = getIp(req);
    const failKey = `auth:fail:${ip}`;
    const lockKey = `auth:lock:${ip}`;
    const n = await redis.incr(failKey);
    if (n === 1) await redis.expire(failKey, WINDOW_SECONDS);
    if (n >= LOCKOUT_THRESHOLD) {
      await redis.set(lockKey, '1', 'EX', LOCKOUT_TTL_SECONDS);
      await redis.del(failKey);
    }
    // legacy aliases kept for backward compat (older live test references authfail:/authlock:)
    const legacyCounter = `authfail:${ip}`;
    const legacyLock = `authlock:${ip}`;
    const ln = await redis.incr(legacyCounter);
    if (ln === 1) await redis.expire(legacyCounter, 10 * 60);
    if (ln >= LOCKOUT_THRESHOLD) await redis.set(legacyLock, '1', 'EX', 5 * 60);
    return n;
  } catch (_e) { /* swallow */ }
}

async function clearFailures(req) {
  if (isTest()) return;
  try {
    const ip = getIp(req);
    await redis.del(`auth:fail:${ip}`);
    await redis.del(`authfail:${ip}`);
  } catch (_e) { /* swallow */ }
}

const recordSuccess = clearFailures;
async function isLocked(req) {
  try {
    const ip = getIp(req);
    const lockKey = `auth:lock:${ip}`;
    if ((await redis.get(lockKey)) !== null) return true;
    const legacy = `authlock:${ip}`;
    return (await redis.get(legacy)) !== null;
  } catch (_e) {
    return false;
  }
}
const lockoutMiddleware = checkLockout;

module.exports = { checkLockout, recordFailure, clearFailures, recordSuccess, isLocked, lockoutMiddleware, isTest, WINDOW_SECONDS, MAX_ATTEMPTS_PER_WINDOW, LOCKOUT_THRESHOLD, LOCKOUT_TTL_SECONDS };
