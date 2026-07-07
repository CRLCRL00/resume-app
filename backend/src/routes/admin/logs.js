const express = require('express');
const router = express.Router();
const { userAuth } = require('../../middleware/auth');
const { adminAuth } = require('../../middleware/adminAuth');
const { AppError } = require('../../middleware/errorHandler');
const pool = require('../../config/db');
const logger = require('../../utils/logger');
const { runAdminLogsCleanup } = require('../../jobs/adminLogsCleanup');

/**
 * 构建 WHERE 子句 + params 用于 admin_operation_logs 筛选。
 * 支持字段：
 *   action (前缀 LIKE), admin_openid, target_id, target_type, result, ip (精确)
 *   dateFrom / dateTo (ISO 8601 字符串)
 *
 * @returns {{sql: string, params: any[]}}
 */
function buildLogFilter({ action, admin_openid, target_id, target_type, result, ip, dateFrom, dateTo }) {
  const where = [];
  const params = [];
  if (action) {
    where.push('action LIKE ?');
    params.push(`${action}%`);
  }
  if (admin_openid) {
    where.push('admin_openid = ?');
    params.push(admin_openid);
  }
  if (target_id) {
    where.push('target_id = ?');
    params.push(target_id);
  }
  if (target_type) {
    where.push('target_type = ?');
    params.push(target_type);
  }
  if (result) {
    where.push('result = ?');
    params.push(result);
  }
  if (ip) {
    where.push('ip = ?');
    params.push(ip);
  }
  if (dateFrom) {
    where.push('created_at >= ?');
    params.push(new Date(dateFrom));
  }
  if (dateTo) {
    where.push('created_at <= ?');
    params.push(new Date(dateTo));
  }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

/**
 * GET /api/admin/logs — 全操作日志 + 高级筛选
 * Query: page, pageSize, action(前缀), admin_openid, target_id, target_type, result(success/failure/unknown), ip, dateFrom, dateTo (ISO)
 */
router.get('/logs', userAuth, adminAuth, async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(parseInt(req.query.pageSize, 10) || 20, 100);
    const offset = (page - 1) * pageSize;

    const filter = buildLogFilter({
      action: req.query.action,
      admin_openid: req.query.admin_openid,
      target_id: req.query.target_id,
      target_type: req.query.target_type,
      result: req.query.result,
      ip: req.query.ip,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
    });

    const [items] = await pool.query(
      `SELECT id, admin_openid, action, target_type, target_id, detail, result, ip, created_at
       FROM admin_operation_logs
       ${filter.sql}
       ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...filter.params, pageSize, offset],
    );
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM admin_operation_logs ${filter.sql}`,
      filter.params,
    );
    res.json({
      code: 0,
      data: { items, total, page, pageSize, filter: req.query },
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/admin/logs/actions — distinct action types + counts (给 ops dropdown)
 */
router.get('/logs/actions', userAuth, adminAuth, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 200);
    const [rows] = await pool.query(
      `SELECT action, COUNT(*) AS count, MAX(created_at) AS last_at
       FROM admin_operation_logs
       GROUP BY action
       ORDER BY count DESC LIMIT ?`,
      [limit],
    );
    res.json({ code: 0, data: { items: rows } });
  } catch (err) { next(err); }
});

/**
 * GET /api/admin/logs/actors — distinct admin openids with action counts
 */
router.get('/logs/actors', userAuth, adminAuth, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 200);
    const [rows] = await pool.query(
      `SELECT admin_openid, COUNT(*) AS count, MAX(created_at) AS last_at
       FROM admin_operation_logs
       GROUP BY admin_openid
       ORDER BY count DESC LIMIT ?`,
      [limit],
    );
    res.json({ code: 0, data: { items: rows } });
  } catch (err) { next(err); }
});

/**
 * GET /api/admin/logs/security — 只返 security.* 安全事件（高优先级审计）
 * Query: ?days=7 default
 */
router.get('/logs/security', userAuth, adminAuth, async (req, res, next) => {
  try {
    const days = Math.max(parseInt(req.query.days, 10) || 7, 1);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(parseInt(req.query.pageSize, 10) || 50, 200);
    const offset = (page - 1) * pageSize;
    const [items] = await pool.query(
      `SELECT id, admin_openid AS actor, action, target_id, detail, result, ip, created_at
       FROM admin_operation_logs
       WHERE action LIKE 'security.%' AND created_at > (NOW() - INTERVAL ? DAY)
       ORDER BY id DESC LIMIT ? OFFSET ?`,
      [days, pageSize, offset]
    );
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM admin_operation_logs
       WHERE action LIKE 'security.%' AND created_at > (NOW() - INTERVAL ? DAY)`,
      [days]
    );
    res.json({ code: 0, data: { items, total, page, pageSize, days } });
  } catch (err) { next(err); }
});

/**
 * DELETE /api/admin/logs/prune — admin trigger manual cleanup (>90 days)
 */
router.delete('/logs/prune', userAuth, adminAuth, async (req, res, next) => {
  try {
    const days = parseInt(req.query.days, 10) || 90;
    if (days < 7) throw new AppError(1000, 'days must be >= 7', 400);
    const [r] = await pool.query(
      'DELETE FROM admin_operation_logs WHERE created_at < (NOW() - INTERVAL ? DAY)',
      [days]
    );
    logger.info({ admin: req.user.openid, days, deleted: r.affectedRows }, 'admin log prune');
    res.json({ code: 0, data: { deleted: r.affectedRows, days } });
  } catch (err) { next(err); }
});

/**
 * POST /api/admin/logs/retention-trigger — 手动触发 retention cron
 * Body: { retentionDays?: 30..720, batchSize?: 1..10000 }
 * Default retentionDays = process.env.ADMIN_LOG_RETENTION_DAYS || 180
 */
router.post('/logs/retention-trigger', userAuth, adminAuth, async (req, res, next) => {
  try {
    const envDays = Number(process.env.ADMIN_LOG_RETENTION_DAYS) || 180;
    const bodyDays = Number(req.body && req.body.retentionDays);
    const retentionDays = Number.isFinite(bodyDays) ? bodyDays : envDays;
    if (retentionDays < 30 || retentionDays > 720) {
      throw new AppError(1000, 'retentionDays must be in [30, 720]', 400);
    }
    const batchSize = Number.isFinite(Number(req.body && req.body.batchSize))
      ? Number(req.body.batchSize)
      : 1000;
    if (batchSize < 1 || batchSize > 10000) {
      throw new AppError(1000, 'batchSize must be in [1, 10000]', 400);
    }
    const result = await runAdminLogsCleanup({ retentionDays, batchSize, logger });
    logger.info(
      { admin: req.user.openid, retentionDays, batchSize, result },
      'admin log retention triggered',
    );
    res.json({ code: 0, data: result });
  } catch (err) { next(err); }
});

/**
 * POST /api/admin/logs/archive — move old logs to archive table（保留不删）
 * Body: { days: 90 } default
 */
router.post('/logs/archive', userAuth, adminAuth, async (req, res, next) => {
  try {
    const days = parseInt((req.body && req.body.days) || 90, 10);
    if (days < 7) throw new AppError(1000, 'days must be >= 7', 400);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [insert] = await conn.query(
        `INSERT IGNORE INTO admin_operation_logs_archive
         (id, admin_openid, action, target_type, target_id, detail, ip, created_at)
         SELECT id, admin_openid, action, target_type, target_id, detail, ip, created_at
         FROM admin_operation_logs
         WHERE created_at < (NOW() - INTERVAL ? DAY)`,
        [days]
      );
      const [del] = await conn.query(
        'DELETE FROM admin_operation_logs WHERE created_at < (NOW() - INTERVAL ? DAY)',
        [days]
      );
      await conn.commit();
      logger.info({ admin: req.user.openid, days, archived: insert.affectedRows, deleted: del.affectedRows }, 'admin log archive');
      res.json({ code: 0, data: { archived: insert.affectedRows, deleted: del.affectedRows, days } });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) { next(err); }
});

/**
 * GET /api/admin/logs/archive — 拉归档
 */
router.get('/logs/archive', userAuth, adminAuth, async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(parseInt(req.query.pageSize, 10) || 50, 200);
    const offset = (page - 1) * pageSize;
    const [items] = await pool.query(
      'SELECT id, admin_openid, action, target_type, target_id, detail, ip, created_at, archived_at FROM admin_operation_logs_archive ORDER BY archived_at DESC LIMIT ? OFFSET ?',
      [pageSize, offset]
    );
    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM admin_operation_logs_archive');
    res.json({ code: 0, data: { items, total, page, pageSize } });
  } catch (err) { next(err); }
});

module.exports = router;
