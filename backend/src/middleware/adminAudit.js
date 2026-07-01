const pool = require('../config/db');
const { getRequestId } = require('./requestContext');

/**
 * Mount on /api/admin/*. Logs each request's outcome to admin_audit.
 * Should run AFTER adminAuth so we have req.user.openid.
 */
async function adminAuditMiddleware(req, res, next) {
  res.on('finish', async () => {
    try {
      const openid = req.user?.openid || req.openid;
      if (!openid) return;
      const action = `${req.method} ${req.baseUrl || ''}${req.route?.path || req.path}`;
      await pool.query(
        `INSERT INTO admin_audit (openid, action, target_type, target_id, method, path, ip, status, request_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          openid,
          action.slice(0, 64),
          req.params?.type || 'unknown',
          req.params?.id ? String(req.params.id).slice(0, 64) : null,
          req.method,
          (req.originalUrl || req.url || '').slice(0, 255),
          (req.ip || '').slice(0, 45),
          res.statusCode,
          getRequestId(),
        ]
      );
    } catch (_e) { /* do not break response flow */ }
  });
  next();
}

module.exports = { adminAuditMiddleware };