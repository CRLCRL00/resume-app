const logger = require('../utils/logger');

/**
 * Inspect Redis persistence configuration (AOF + RDB).
 * Pure read-only check — does NOT change Redis config.
 *
 * @param {import('ioredis').Redis} redis - ioredis client
 * @returns {Promise<{ok: boolean, warnings: string[], persistence: {aof: string, rdb: string}, info: {aof_enabled: string|undefined, rdb_last_bgsave_status: string|undefined}}>}
 */
async function checkRedisPersistence(redis) {
  const warnings = [];
  const persistence = { aof: 'unknown', rdb: 'unknown' };
  const info = { aof_enabled: undefined, rdb_last_bgsave_status: undefined };

  try {
    // 1. AOF
    const aofRes = await redis.call('CONFIG', 'GET', 'appendonly');
    // ioredis returns ['appendonly', value]
    const aofValue = Array.isArray(aofRes) ? aofRes[1] : undefined;
    persistence.aof = aofValue || 'unknown';
    if (aofValue !== 'yes') {
      warnings.push('[redis] aof_off: AOF disabled — risk of data loss on restart. hint:prod-recommendation');
    }

    // 2. RDB save schedule
    const saveRes = await redis.call('CONFIG', 'GET', 'save');
    const saveValue = Array.isArray(saveRes) ? saveRes[1] : '';
    persistence.rdb = saveValue || '';
    if (!saveValue || saveValue.trim() === '') {
      warnings.push('[redis] rdb_off: no RDB snapshots configured. hint:prod-recommendation');
    }

    // 3. INFO persistence — log aof_enabled + rdb_last_bgsave_status
    try {
      const infoRes = await redis.call('INFO', 'persistence');
      const text = String(infoRes || '');
      const aofMatch = text.match(/^aof_enabled:(\d+)/m);
      const bgsaveMatch = text.match(/^rdb_last_bgsave_status:(\S+)/m);
      if (aofMatch) info.aof_enabled = aofMatch[1];
      if (bgsaveMatch) info.rdb_last_bgsave_status = bgsaveMatch[1];
    } catch (e) {
      // INFO failure is non-fatal
    }

    logger.info({
      aof: persistence.aof,
      rdb: persistence.rdb,
      aof_enabled: info.aof_enabled,
      rdb_last_bgsave_status: info.rdb_last_bgsave_status,
    }, 'redis persistence check');
  } catch (err) {
    warnings.push(`[redis] redis_persistence_check_failed: ${err.message}`);
  }

  return { ok: warnings.length === 0, warnings, persistence, info };
}

module.exports = { checkRedisPersistence };