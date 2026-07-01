/**
 * securityLog.js — 重要安全事件审计
 * 落到 admin_operation_logs 表（复用现有 schema，action 前缀 security.*）
 * 同时打 pino 日志（双写）
 *
 * 调用方：
 *   securityLog.record('login.fail', req, { reason: 'bad code' });
 *   securityLog.record('user.delete', req, { userId });
 *   securityLog.record('legal.bump', req, { doc_type, version });
 */
const pool = require('../config/db');
const logger = require('../utils/logger');

async function record(event, req, detail = {}) {
  const ip = (req?.headers?.['x-forwarded-for'] || req?.ip || '').toString().split(',')[0].trim();
  const openid = req?.user?.openid || (event === 'login.fail' ? '__anon__' : '__system__');
  const target = detail.userId || detail.openid || detail.version || ip || null;
  try {
    await pool.query(
      `INSERT INTO admin_operation_logs (admin_openid, action, target_type, target_id, detail, ip)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [openid, `security.${event}`, 'security', String(target).slice(0, 64), JSON.stringify(detail).slice(0, 4096), ip.slice(0, 64)]
    );
  } catch (err) {
    // 库失败不能阻拦主流程
    logger.error({ err: err.message, event, detail }, 'security log DB write failed');
  }
  // 同时打本地日志（保证 monitor / logrotate 留痕）
  const level = event.includes('fail') || event.includes('error') || event.includes('ban') ? 'warn' : 'info';
  logger[level]({ event, ip, openid, ...detail }, 'security event');
}

/**
 * 同步版本（不需要 await）
 */
function recordSync(event, req, detail = {}) {
  record(event, req, detail).catch(err =>
    logger.error({ err: err.message, event }, 'securityLog.recordSync err'));
}

module.exports = { record, recordSync };
