/**
 * Round 31-D: client_errors 聚合查询（用于 ops dashboard）
 *
 * summarizeClientErrors(pool, windowHours) 返回最近 windowHours 小时内
 * client_errors 表的聚合：总数、按 error_type 分组、按 platform 分组、最后一次错误时间。
 *
 * 单次 GROUP BY + COUNT(*)，廉价（schema 已有 idx_type_created / idx_openid_created 索引）。
 */
'use strict';

const defaultPool = require('../config/db');

const DEFAULT_WINDOW_HOURS = 24;

/**
 * @param {object} [poolOrOpts]
 * @param {number} [poolOrOpts.windowHours=24]
 * @returns {Promise<{total:number, byType:object, byPlatform:object, lastErrorAt:Date|null}>}
 */
async function summarizeClientErrors(poolOrOpts, windowHoursArg) {
  // 支持两种签名：
  //   summarizeClientErrors(pool, 24)
  //   summarizeClientErrors({ windowHours: 24 })            // 用默认 pool
  //   summarizeClientErrors({ pool, windowHours: 24 })
  let pool = defaultPool;
  let windowHours = DEFAULT_WINDOW_HOURS;
  if (typeof poolOrOpts === 'object' && poolOrOpts !== null && !(poolOrOpts && typeof poolOrOpts.query === 'function')) {
    if (Number.isFinite(poolOrOpts.windowHours)) windowHours = poolOrOpts.windowHours;
    if (poolOrOpts.pool) pool = poolOrOpts.pool;
  } else {
    pool = poolOrOpts || defaultPool;
    if (Number.isFinite(windowHoursArg)) windowHours = windowHoursArg;
  }

  // by error_type
  const [byTypeRows] = await pool.query(
    `SELECT error_type, COUNT(*) AS cnt, MAX(created_at) AS last_at
       FROM client_errors
      WHERE created_at > (NOW() - INTERVAL ? HOUR)
      GROUP BY error_type`,
    [windowHours],
  );

  // by platform
  const [byPlatformRows] = await pool.query(
    `SELECT platform, COUNT(*) AS cnt
       FROM client_errors
      WHERE created_at > (NOW() - INTERVAL ? HOUR)
      GROUP BY platform`,
    [windowHours],
  );

  // total + last
  const [totalRows] = await pool.query(
    `SELECT COUNT(*) AS total, MAX(created_at) AS last_at
       FROM client_errors
      WHERE created_at > (NOW() - INTERVAL ? HOUR)`,
    [windowHours],
  );

  const total = (totalRows && totalRows[0] && Number(totalRows[0].total)) || 0;
  const lastErrorAt = (totalRows && totalRows[0] && totalRows[0].last_at) || null;

  const byType = {};
  for (const row of byTypeRows) {
    byType[row.error_type || 'unknown'] = Number(row.cnt);
  }
  const byPlatform = {};
  for (const row of byPlatformRows) {
    byPlatform[row.platform || 'unknown'] = Number(row.cnt);
  }

  return { total, byType, byPlatform, lastErrorAt, windowHours };
}

module.exports = { summarizeClientErrors };
module.exports.summarizeClientErrors = summarizeClientErrors;