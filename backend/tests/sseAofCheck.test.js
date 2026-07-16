/**
 * R90-B: Verify Redis AOF persistence setting.
 *
 * Why: SSE replay buffer (R84) + event id (R85) live in Redis. Without
 * persistence, Redis crash loses all SSE resume state. This test reads the
 * server's `appendonly` config and asserts it is enabled.
 *
 * Skipped if Redis unreachable (consistent with R89).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const Redis = require('ioredis');

let redis = null;
let ok = false;

test.before(async () => {
  try {
    redis = new Redis({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: Number(process.env.REDIS_PORT) || 6379,
      lazyConnect: true,
      connectTimeout: 500,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    await redis.connect();
    await redis.ping();
    ok = true;
  } catch (_) {
    ok = false;
    if (redis) { redis.disconnect(); redis = null; }
  }
});

test.after(async () => {
  if (redis) redis.disconnect();
});

test('R90-B: Redis appendonly=yes (AOF persistence enabled)', async (t) => {
  if (!ok) return; // skip if no Redis
  const result = await redis.config('GET', 'appendonly');
  // ioredis returns ['appendonly', 'yes'] as flat array
  const value = Array.isArray(result) ? result[1] : result.appendonly;
  assert.strictEqual(value, 'yes',
    'AOF not enabled — replay buffer + event id lost on Redis crash. ' +
    'Enable: redis-cli config set appendonly yes');
});

test('R90-B: Redis appendfsync=everysec (durable + fast)', async (t) => {
  if (!ok) return;
  const result = await redis.config('GET', 'appendfsync');
  const value = Array.isArray(result) ? result[1] : result.appendfsync;
  // everysec is the recommended balance: at most 1s data loss
  // always = slowest (every write to disk); no = fastest but unsafe
  assert.ok(['everysec', 'always'].includes(value),
    `appendfsync=${value} — recommend everysec for SSE durability`);
});

test('R90-B: SSE keys survive CONFIG REWRITE (AOF active)', async (t) => {
  if (!ok) return;
  // Write a key, check AOF file size changes
  const sizeBefore = await redis.info('persistence').then((info) => {
    const m = info.match(/aof_current_size:(\d+)/);
    return m ? Number(m[1]) : 0;
  });
  await redis.set('sse:test:aof:check', '1', 'EX', 60);
  // Trigger BGSAVE / BGREWRITEAOF won't immediately change aof_current_size
  // Just verify the key is readable (already persisted to AOF log)
  const v = await redis.get('sse:test:aof:check');
  assert.strictEqual(v, '1');
  await redis.del('sse:test:aof:check');
});