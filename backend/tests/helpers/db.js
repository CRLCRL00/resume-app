const { createPool } = require('../../src/config/db');
const { createRedis } = require('../../src/config/redis');

let pool = null;
let redis = null;

function getPool() {
  if (!pool) pool = createPool();
  return pool;
}

function getRedis() {
  if (!redis) redis = createRedis();
  return redis;
}

async function cleanup() {
  if (pool) {
    try { await pool.end(); } catch {}
    pool = null;
  }
  if (redis) {
    try { await redis.quit(); } catch {}
    redis = null;
  }
}

module.exports = { getPool, getRedis, cleanup };