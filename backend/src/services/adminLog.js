const pool = require('../config/db');

async function record(adminOpenid, action, targetType, targetId, detail, ip) {
  await pool.query(
    'INSERT INTO admin_operation_logs (admin_openid, action, target_type, target_id, detail, ip) VALUES (?,?,?,?,?,?)',
    [adminOpenid, action, targetType || null,
     targetId != null ? String(targetId) : null,
     JSON.stringify(detail || {}),
     ip || null]
  );
}

module.exports = { record };