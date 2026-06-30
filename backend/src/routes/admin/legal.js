const express = require('express');
const router = express.Router();
const { userAuth } = require('../../middleware/auth');
const { adminAuth } = require('../../middleware/adminAuth');
const { AppError } = require('../../middleware/errorHandler');
const pool = require('../../config/db');
const logger = require('../../utils/logger');

/**
 * POST /api/admin/legal-version — bump policy version (admin only)
 * Body: { doc_type: 'privacy'|'terms', version: 'YYYY-MM-DD', note?: string }
 */
router.post('/legal-version', userAuth, adminAuth, async (req, res, next) => {
  try {
    const { doc_type, version, note } = req.body || {};
    if (!['privacy', 'terms'].includes(doc_type)) {
      throw new AppError(1000, 'doc_type must be privacy|terms', 400);
    }
    if (!version || !/^\d{4}-\d{2}-\d{2}$/.test(version)) {
      throw new AppError(1000, 'version must be YYYY-MM-DD', 400);
    }
    const openid = req.user.openid;
    await pool.query(
      'INSERT INTO privacy_versions (doc_type, version, note) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE note = VALUES(note)',
      [doc_type, version, note || `bumped by ${openid}`]
    );
    logger.info({ doc_type, version, openid }, 'legal version bumped');
    res.json({ code: 0, data: { doc_type, version } });
  } catch (err) { next(err); }
});

module.exports = router;
