const crypto = require('crypto');
const redis = require('../config/redis');
const logger = require('../utils/logger');

const TTL_SECONDS = 24 * 60 * 60; // 24h 缓存
const IN_FLIGHT_TTL = 60; // 60s in-flight 锁（防止请求挂死占着 key）
// 1-128 字符，alphanumeric + '-' '_'（uuid v4 / 自定义 token 都覆盖）
const KEY_REGEX = /^[A-Za-z0-9_-]{1,128}$/;

const isTest = () => process.env.NODE_ENV === 'test'
  || process.env.npm_lifecycle_event === 'test';

/**
 * 用 sha256 归一化 body，相同 payload → 相同 hash。
 * 同 key + 不同 body → 409（防 client 误用）。
 */
function hashBody(body) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(body || {}))
    .digest('hex');
}

/**
 * 中间件：读 `Idempotency-Key` 头。
 *
 * - 头缺失 → passthrough（next）
 * - 头非法 → 400
 * - 命中 completed cache + 同 body → 重放原响应
 * - 命中 completed cache + 不同 body → 409（key 复用，body 变了）
 * - 命中 in-flight（被并发请求持有） → 409（in-flight 冲突）
 * - 没命中 → 用 SET NX 抢 in-flight 锁；抢到则继续；抢不到则 409
 *
 * Redis 挂 → log warn + passthrough（不破可用性）
 */
function idempotency({ prefix = 'idem' } = {}) {
  return async (req, res, next) => {
    if (isTest()) return next();
    const key = req.headers['idempotency-key'];
    if (!key) return next();

    if (!KEY_REGEX.test(key)) {
      return res.status(400).json({
        code: 400,
        message: 'Idempotency-Key must be 1-128 chars of [A-Za-z0-9_-]',
        data: null,
      });
    }

    const owner = req.user?.userId || req.user?.openid || 'anon';
    const baseKey = `${prefix}:${owner}:${key}`;
    const resultKey = `${baseKey}:result`;
    const inflightKey = `${baseKey}:inflight`;
    const bodyHash = hashBody(req.body);

    let cached = null;
    let inflight = null;
    try {
      [cached, inflight] = await Promise.all([
        redis.get(resultKey),
        redis.get(inflightKey),
      ]);
    } catch (e) {
      logger.warn({ err: e.message, key }, '[idempotency] redis read failed, passthrough');
      return next();
    }

    // 已完成：检查 body 是否一致
    if (cached) {
      let data = null;
      try { data = JSON.parse(cached); } catch { /* ignore */ }
      if (data && data.bodyHash && data.bodyHash !== bodyHash) {
        return res.status(409).json({
          code: 409,
          message: 'idempotency key reused with different payload',
          data: null,
        });
      }
      if (data) {
        res.setHeader('Idempotency-Replay', 'true');
        return res.status(data.statusCode || 200).json(data.body);
      }
    }

    // 进行中：另一个并发请求正在处理同一 key
    if (inflight && inflight !== bodyHash) {
      return res.status(409).json({
        code: 409,
        message: 'idempotency key in-flight with different payload',
        data: null,
      });
    }

    // 抢 in-flight 锁（SET NX EX 60s）
    try {
      const claimed = await redis.set(inflightKey, bodyHash, 'EX', IN_FLIGHT_TTL, 'NX');
      if (claimed !== 'OK') {
        // 抢失败：另一请求持锁；简化策略直接 409（in-flight 模式简单实现）
        return res.status(409).json({
          code: 409,
          message: 'idempotency key in-flight, retry after current request completes',
          data: null,
        });
      }
    } catch (e) {
      logger.warn({ err: e.message, key }, '[idempotency] redis claim failed, passthrough');
      return next();
    }

    res.locals.__idemKey = baseKey;
    res.locals.__idemBodyHash = bodyHash;
    next();
  };
}

/**
 * 把 handler 的响应 body 缓存到 Redis（24h）。
 * 仅缓存 2xx；4xx/5xx 不缓存（让 client 能修正后重试）。
 * 同时清掉 in-flight 锁。
 *
 * Mount AFTER handler：
 *   router.post('/jobs', idempotency(), handler, idempotencyCapture());
 */
function idempotencyCapture() {
  return (req, res, next) => {
    if (isTest()) return next();
    const baseKey = res.locals.__idemKey;
    if (!baseKey) return next();
    const resultKey = `${baseKey}:result`;
    const inflightKey = `${baseKey}:inflight`;
    const bodyHash = res.locals.__idemBodyHash;

    // 拦截 res.json 把响应 body 抓出来
    const original = res.json.bind(res);
    res.json = (body) => {
      res.locals.__idemBody = body;
      return original(body);
    };

    res.on('finish', () => {
      const status = res.statusCode;
      const body = res.locals.__idemBody;
      // 仅 2xx 缓存
      if (status >= 200 && status < 300 && body) {
        const data = { statusCode: status, body, bodyHash };
        redis.set(resultKey, JSON.stringify(data), 'EX', TTL_SECONDS)
          .catch((e) => logger.warn({ err: e.message }, '[idempotency] cache write failed'));
      }
      // 总是清 in-flight（不论 2xx/4xx/5xx）
      redis.del(inflightKey)
        .catch((e) => logger.warn({ err: e.message }, '[idempotency] inflight del failed'));
    });

    next();
  };
}

// Backwards-compat alias（老代码可能仍在用 captureBody()）
function captureBody() {
  return idempotencyCapture();
}

module.exports = { idempotency, idempotencyCapture, captureBody };