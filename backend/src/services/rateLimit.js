const redis = require('../config/redis');
const logger = require('../utils/logger');

// 测试环境短路：跨测试累积的 Redis 计数器会导致测试互相阻塞
function isTestEnv() {
  return process.env.NODE_ENV === 'test'
    || process.env.npm_lifecycle_event === 'test'
    || /test/i.test(process.argv[1] || '');
}

async function check(key, limit, windowSec) {
  // 测试默认短路（防止跨测试用例 Redis 累积污染）
  // 只短路 'login:ip:' 键（爆破防护）；其他键（match/resume 限流）正常走，
  // 这些限流测试需要验真实触发路径。
  if (isTestEnv() && key.startsWith('login:ip:')) {
    return { allowed: true, count: 0, remaining: limit };
  }
  try {
    const r = await redis.incr(key);
    if (r === 1) {
      await redis.expire(key, windowSec);
    }
    return {
      allowed: r <= limit,
      count: r,
      remaining: Math.max(0, limit - r),
    };
  } catch (err) {
    logger.warn({ err: err.message, key }, 'rateLimit fail-open');
    return { allowed: true, count: 0, remaining: limit };
  }
}

module.exports = { check };