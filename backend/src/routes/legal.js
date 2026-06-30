const express = require('express');
const router = express.Router();
const legal = require('../services/legal');
const pool = require('../config/db');

/**
 * GET /api/legal/versions — 客户端拉最新版本号（app 启动比对 storage.privacy_version）
 */
router.get('/versions', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT doc_type, version, updated_at, note FROM privacy_versions ORDER BY id DESC'
    );
    const byType = {};
    for (const r of rows) byType[r.doc_type] = r;
    res.json({ code: 0, data: byType });
  } catch (err) { next(err); }
});

router.get('/privacy', (req, res) => {
  res.json({ code: 0, data: legal.getPrivacy() });
});

router.get('/terms', (req, res) => {
  res.json({ code: 0, data: legal.getTerms() });
});

module.exports = router;
