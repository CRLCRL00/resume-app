const pool = require('../config/db');

const ALLOWED_RESULTS = new Set(['success', 'failure', 'unknown']);

/**
 * 写一条 admin_operation_log。
 * @param {string} adminOpenid
 * @param {string} action
 * @param {string|null} targetType
 * @param {string|number|null} targetId
 * @param {object|null} detail
 * @param {string|null} ip
 * @param {('success'|'failure'|'unknown')} [result='unknown'] - 操作结果。默认 'unknown'（向后兼容旧调用）。
 */
async function record(adminOpenid, action, targetType, targetId, detail, ip, result = 'unknown') {
  const safeResult = ALLOWED_RESULTS.has(result) ? result : 'unknown';
  await pool.query(
    'INSERT INTO admin_operation_logs (admin_openid, action, target_type, target_id, detail, result, ip) VALUES (?,?,?,?,?,?,?)',
    [
      adminOpenid,
      action,
      targetType || null,
      targetId != null ? String(targetId) : null,
      JSON.stringify(detail || {}),
      safeResult,
      ip || null,
    ]
  );
}

module.exports = { record };
