/**
 * Round audit-filter: admin_operation_logs TTL cleanup job
 *
 * 删除 admin_operation_logs 里超过 retentionDays 天的旧行（默认 180 天）。
 * - 幂等：第二次跑不会再删
 * - 参数化查询
 * - 最小 retentionDays 30（不允许太激进的清理）
 *
 * 用法：
 *   const { runAdminLogsCleanup } = require('./jobs/adminLogsCleanup');
 *   await runAdminLogsCleanup({ retentionDays: 180 });
 */
'use strict';

const defaultPool = require('../config/db');
const defaultLogger = require('../utils/logger');

const DEFAULT_RETENTION_DAYS = 180;
const MIN_RETENTION_DAYS = 30;
const DEFAULT_BATCH_SIZE = 1000;

async function runAdminLogsCleanup(opts = {}) {
  const rawDays = Number.isFinite(opts.retentionDays) ? opts.retentionDays : DEFAULT_RETENTION_DAYS;
  const batchSize = Number.isFinite(opts.batchSize) ? opts.batchSize : DEFAULT_BATCH_SIZE;
  const retentionDays = Math.max(MIN_RETENTION_DAYS, rawDays);
  const pool = opts.pool || defaultPool;
  const logger = opts.logger || defaultLogger;

  if (retentionDays <= 0) throw new Error('retentionDays must be > 0');
  if (batchSize <= 0) throw new Error('batchSize must be > 0');

  const t0 = Date.now();
  let totalDeleted = 0;
  let batches = 0;
  const MAX_BATCHES = 100000;

  while (batches < MAX_BATCHES) {
    // MySQL 8 supports DELETE ... LIMIT
    const [r] = await pool.query(
      'DELETE FROM admin_operation_logs WHERE created_at < (NOW() - INTERVAL ? DAY) LIMIT ?',
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
    logger.info(result, 'admin_logs cleanup done');
  } catch (_e) { /* logger best-effort */ }
  return result;
}

module.exports = { runAdminLogsCleanup, MIN_RETENTION_DAYS };
