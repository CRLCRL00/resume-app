const redis = require('../config/redis');
const logger = require('../utils/logger');

/**
 * Sliding window rate limiter via Redis ZSET.
 *
 * 算法：
 *   每个 identity+route 共享一个 ZSET key，member 是唯一请求 ID (`<now>-<rand>`)，
 *   score 是请求时间戳 ms。每次请求：
 *     1. ZREMRANGEBYSCORE key 0 (now - windowMs)   移除窗口外旧条目
 *     2. ZCARD key                                 当前窗口内请求数
 *     3. count >= limit → 拒绝（计算 retry-after = oldest.score + windowMs - now）
 *     4. ZADD key now <unique-id>                  记录本次请求
 *     5. PEXPIRE key windowMs                      自动清理
 *
 * 优点（vs 固定窗口）：
 *   - 边界 burst 防护：固定窗口在窗口切换瞬间可放过 2×limit；滑动窗口严格 limit/单位时间
 *   - 计数平滑，retry-after 精确（基于最旧条目出窗口的时刻）
 *
 * 容错：Redis 出错时 fail-open（放行 + log warn）。绝不能用 Redis 故障拖累登录/业务。
 *
 * @param {object} opts
 * @param {string} opts.key      Redis key（通常已含 prefix + name + identity）
 * @param {number} opts.limit    窗口内允许最大请求数
 * @param {number} opts.windowMs 窗口大小（毫秒）
 * @returns {Promise<{allowed:boolean, count:number, limit:number, retryAfterMs?:number, error?:string}>}
 */
async function slidingRateLimit({ key, limit, windowMs }) {
  const now = Date.now();
  const cutoff = now - windowMs;
  try {
    // 先清理 + 读当前计数
    const pipeline = redis.multi();
    pipeline.zremrangebyscore(key, 0, cutoff);
    pipeline.zcard(key);
    const results = await pipeline.exec();
    // results = [[null, removedCount], [null, currentCount]]
    const count = (results && results[1] && results[1][1]) || 0;

    if (count >= limit) {
      // 计算 retry-after：取最旧条目，出窗口时间 - now
      const oldest = await redis.zrange(key, 0, 0, 'WITHSCORES');
      const oldestTs = oldest.length === 2 ? parseInt(oldest[1], 10) : now;
      const retryAfterMs = Math.max(0, oldestTs + windowMs - now);
      return { allowed: false, count, limit, retryAfterMs };
    }

    // 放行 + 写入本次请求
    const member = `${now}-${Math.random().toString(36).slice(2, 10)}`;
    await redis.multi().zadd(key, now, member).pexpire(key, windowMs).exec();
    return { allowed: true, count: count + 1, limit };
  } catch (err) {
    logger.warn({ err: err.message, key }, 'sliding rate limit: redis error, fail-open');
    return { allowed: true, count: 0, limit, error: err.message };
  }
}

/**
 * Express middleware factory。
 *
 * @param {object} opts
 * @param {string} opts.name      路由名（用于 Redis key namespace + 日志）
 * @param {number} opts.limit     窗口内最大请求数
 * @param {number} opts.windowMs  窗口大小（毫秒）
 * @param {(req:any)=>string} opts.keyFn  从 req 提取 identity（IP / openid 等）
 */
function slidingRateLimitMiddleware({ name, limit, windowMs, keyFn }) {
  return async (req, res, next) => {
    try {
      const identity = keyFn(req);
      const key = `rl:sliding:${name}:${identity}`;
      const result = await slidingRateLimit({ key, limit, windowMs });

      res.set('X-RateLimit-Limit', String(limit));
      res.set('X-RateLimit-Remaining', String(Math.max(0, limit - result.count)));

      if (!result.allowed) {
        const retryAfterSec = Math.ceil(result.retryAfterMs / 1000);
        res.set('Retry-After', String(retryAfterSec));
        return res.status(429).json({
          code: 1429,
          message: 'too many requests',
          retryAfterMs: result.retryAfterMs,
        });
      }
      next();
    } catch (err) {
      // middleware 自身异常 → fail-open
      logger.warn({ err: err.message, name }, 'sliding rate limit middleware error, fail-open');
      next();
    }
  };
}

module.exports = { slidingRateLimitMiddleware, slidingRateLimit };