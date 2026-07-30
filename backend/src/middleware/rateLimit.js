const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis').default;
const redis = require('../config/redis');

const WINDOW_MS = 10 * 60 * 1000; // 10 min
const MAX = 30;

function makeLimiter({ name }) {
  return rateLimit({
    windowMs: WINDOW_MS,
    max: MAX,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${name}:${req.ip}`,
    store: new RedisStore({
      sendCommand: (...args) => redis.call(...args),
      prefix: `rl:${name}:`,
    }),
    handler: (req, res) => {
      res.status(429).json({ code: 429, message: '请求过于频繁，请稍后再试' });
    },
    skip: () => isTestEnv,
  });
}

const isTestEnv = process.env.NODE_ENV === 'test'
  || process.env.npm_lifecycle_event === 'test';

let resumeLimiter;
let matchLimiter;

if (!isTestEnv) {
  resumeLimiter = makeLimiter({ name: 'resume' });
  matchLimiter = makeLimiter({ name: 'match' });
} else {
  const noop = (req, res, next) => next();
  resumeLimiter = noop;
  matchLimiter = noop;
}

module.exports = { resumeLimiter, matchLimiter };