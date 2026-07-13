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

/**
 * R42: leader-transition audit. system event (无 req)。
 * 复用 admin_operation_logs 表 (action 前缀 security.leader.*)。
 * 失败不阻拦主流程（leaderElect 也不应因 audit 失败而 retry）。
 */
async function recordLeader(role, from, to, reason = 'election') {
  try {
    await pool.query(
      `INSERT INTO admin_operation_logs (admin_openid, action, target_type, target_id, detail, ip)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        '__system__',
        `security.leader.${reason}`,
        'leader',
        role.slice(0, 64),
        JSON.stringify({ role, from, to, reason }).slice(0, 4096),
        '127.0.0.1',
      ]
    );
  } catch (err) {
    logger.error({ err: err.message, role, from, to }, 'leader audit DB write failed');
  }
  logger.info({ role, from, to, reason }, 'leader transition');
}

function recordLeaderSync(...args) {
  recordLeader(...args).catch(err =>
    logger.error({ err: err.message }, 'securityLog.recordLeaderSync err'));
}

module.exports = { record, recordSync, recordLeader, recordLeaderSync };
