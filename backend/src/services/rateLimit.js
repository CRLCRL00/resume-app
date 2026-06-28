const redis = require('../config/redis');
const logger = require('../utils/logger');

async function check(key, limit, windowSec) {
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