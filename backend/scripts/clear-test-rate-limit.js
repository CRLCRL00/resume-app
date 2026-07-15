/**
 * clear-test-rate-limit.js — 清 login:* rate-limit keys before each test run.
 * Invoked from "npm test" script before node --test runs.
 *
 * Why: rate-limit state shared across test runs → tests flaky when
 *  rate-limit counter exceeds threshold between runs.
 *
 * Idempotent: safe to run multiple times.
 *
 * R55 fix: 用 timeout + ping health check + 严格 5s 限时 (Redis 未跑 / 连不上时
 * 立即 0 退出而不是挂死), 注意 process.exit(0) 保证 npm test 下一阶段可执行。
 */
const redis = require('../src/config/redis');

const OP_TIMEOUT_MS = 5000;

async function withTimeout(promise, ms, label) {
  let to;
  const timer = new Promise((_, rej) => {
    to = setTimeout(() => rej(new Error(`${label} timeout (${ms}ms)`)), ms);
  });
  try {
    return await Promise.race([promise, timer]);
  } finally {
    clearTimeout(to);
  }
}

(async () => {
  let code = 0;
  try {
    // First ping with 1s timeout — if Redis isn't up, skip cleanly.
    await withTimeout(redis.ping(), 1500, 'redis ping');
    const keys = await withTimeout(redis.keys('login:*'), OP_TIMEOUT_MS, 'redis keys');
    if (Array.isArray(keys) && keys.length) {
      await withTimeout(redis.del(...keys), OP_TIMEOUT_MS, 'redis del');
      process.stderr.write(`[clear-rate-limit] cleared ${keys.length} keys\n`);
    } else {
      process.stderr.write('[clear-rate-limit] no keys to clear\n');
    }
  } catch (e) {
    process.stderr.write(`[clear-rate-limit] skipped: ${e.message}\n`);
    code = 0; // not a hard failure — rate-limit cleanup is best-effort
  } finally {
    try {
      await withTimeout(redis.quit(), 1000, 'redis quit');
    } catch (_e) {
      // ignore close failure
    }
    process.exit(code);
  }
})();
