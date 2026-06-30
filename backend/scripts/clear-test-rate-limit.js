/**
 * clear-test-rate-limit.js — 清 login:* rate-limit keys before each test run.
 * Invoked from "npm test" script before node --test runs.
 *
 * Why: rate-limit state shared across test runs → tests flaky when
 *  rate-limit counter exceeds threshold between runs.
 *
 * Idempotent: safe to run multiple times.
 */
const redis = require('../src/config/redis');

(async () => {
  try {
    const keys = await redis.keys('login:*');
    if (keys.length) {
      await redis.del(...keys);
      process.stderr.write(`[clear-rate-limit] cleared ${keys.length} keys\n`);
    } else {
      process.stderr.write('[clear-rate-limit] no keys to clear\n');
    }
  } catch (e) {
    process.stderr.write(`[clear-rate-limit] warn: ${e.message}\n`);
  } finally {
    await redis.quit();
    process.exit(0);
  }
})();
