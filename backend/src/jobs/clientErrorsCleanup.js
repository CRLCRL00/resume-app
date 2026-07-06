/**
 * Round 31-D: client_errors TTL cleanup job
 *
 * 删除 client_errors 表里超过 retentionDays 天的旧行，batched DELETE LIMIT 循环直到 affectedRows < batchSize。
 * - 幂等：连续运行第二次不会有新删除（已经被前一轮清掉）
 * - 参数化查询（避免 SQL 注入）
 * - 错误向上抛，调用方处理
 *
 * 用法：
 *   const { runClientErrorsCleanup } = require('./jobs/clientErrorsCleanup');
 *   await runClientErrorsCleanup(pool, { retentionDays: 7 });
 *
 * 默认从 src/config/db 拿 pool（与现有 jobs/services 模式一致）
 */
'use strict';

const defaultPool = require('../config/db');
const defaultLogger = require('../utils/logger');

const DEFAULT_RETENTION_DAYS = 7;
const DEFAULT_BATCH_SIZE = 1000;

/**
 * @param {object} [opts]
 * @param {number} [opts.retentionDays=7] - 保留多少天
 * @param {number} [opts.batchSize=1000] - 每批 DELETE LIMIT
 * @param {object} [opts.pool] - mysql2 pool（默认 require('../config/db')）
 * @param {object} [opts.logger] - pino-style logger（默认 utils/logger）
 * @returns {Promise<{deleted:number, batches:number, durationMs:number, retentionDays:number}>}
 */
async function runClientErrorsCleanup(opts = {}) {
  const retentionDays = Number.isFinite(opts.retentionDays) ? opts.retentionDays : DEFAULT_RETENTION_DAYS;
  const batchSize = Number.isFinite(opts.batchSize) ? opts.batchSize : DEFAULT_BATCH_SIZE;
  const pool = opts.pool || defaultPool;
  const logger = opts.logger || defaultLogger;

  if (retentionDays <= 0) throw new Error('retentionDays must be > 0');
  if (batchSize <= 0) throw new Error('batchSize must be > 0');

  const t0 = Date.now();
  let totalDeleted = 0;
  let batches = 0;
  // 防御：单次运行最多 batchCount 上限，避免理论死循环（不可达但安全护栏）
  const MAX_BATCHES = 100000;

  while (batches < MAX_BATCHES) {
    // MySQL 8 supports DELETE ... LIMIT
    const [r] = await pool.query(
      'DELETE FROM client_errors WHERE created_at < (NOW() - INTERVAL ? DAY) LIMIT ?',
      [retentionDays, batchSize],
    );
    const affected = (r && typeof r.affectedRows === 'number') ? r.affectedRows : 0;
    batches += 1;
    totalDeleted += affected;
    if (affected < batchSize) break;
  }

  const durationMs = Date.now() - t0;
  const result = { deleted: totalDeleted, batches, durationMs, retentionDays };
  try {
    logger.info(result, 'client_errors cleanup done');
  } catch (_e) { /* logger best-effort */ }
  return result;
}

module.exports = { runClientErrorsCleanup };