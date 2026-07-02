const redis = require('../config/redis');

const TTL_SECONDS = 300; // 5 min
const isTest = () => process.env.NODE_ENV === 'test' || process.env.npm_lifecycle_event === 'test';

/**
 * Middleware: read Idempotency-Key header.
 * If header absent → noop (request proceeds).
 * If header present + first time → proceed + cache response after.
 * If header present + cached → return cached response immediately.
 *
 * Mount BEFORE route handler. Use `attachCache` flag in response locals to capture.
 */
function idempotency({ prefix = 'idem' } = {}) {
  return async (req, res, next) => {
    if (isTest()) return next();
    const key = req.headers['idempotency-key'];
    if (!key || typeof key !== 'string' || key.length > 128) return next();

    const redisKey = `${prefix}:${req.user?.userId || req.user?.openid || 'anon'}:${key}`;
    try {
      const cached = await redis.get(redisKey);
      if (cached) {
        const data = JSON.parse(cached);
        res.setHeader('Idempotency-Replay', 'true');
        return res.status(data.statusCode || 200).json(data.body);
      }
      // Stash for response capture
      res.locals.__idemKey = redisKey;
    } catch (_e) { /* fallthrough */ }
    next();
  };
}

/**
 * Capture response JSON + status, persist to Redis.
 * Call in res.on('finish') by attaching middleware:
 * Usage: app.use('/route', idempotency(), handler, idempotencyCapture());
 */
function idempotencyCapture() {
  return (req, res, next) => {
    if (isTest()) return next();
    const redisKey = res.locals.__idemKey;
    if (!redisKey) return next();
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300 && res.locals.__idemBody) {
        const data = { statusCode: res.statusCode, body: res.locals.__idemBody };
        redis.set(redisKey, JSON.stringify(data), 'EX', TTL_SECONDS).catch(() => {});
      }
    });
    next();
  };
}

/**
 * Intercept res.json to stash body before sending.
 * Usage: app.use('/route', idempotency(), captureBody(), handler, idempotencyCapture());
 */
function captureBody() {
  return (req, res, next) => {
    if (isTest()) return next();
    if (!res.locals.__idemKey) return next();
    const original = res.json.bind(res);
    res.json = (body) => {
      res.locals.__idemBody = body;
      return original(body);
    };
    next();
  };
}

module.exports = { idempotency, idempotencyCapture, captureBody };