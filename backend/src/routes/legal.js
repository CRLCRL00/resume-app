const express = require('express');
const router = express.Router();
const legal = require('../services/legal');
const pool = require('../config/db');

/**
 * 公共缓存：法务文档按月改动，5 min 边缘缓存
 */
function setPublicCache(res) {
  res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
}

router.get('/versions', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT doc_type, version, updated_at, note FROM privacy_versions ORDER BY id DESC'
    );
    const byType = {};
    for (const r of rows) byType[r.doc_type] = r;
    setPublicCache(res);
    res.json({ code: 0, data: byType });
  } catch (err) { next(err); }
});

router.get('/privacy', (req, res) => {
  setPublicCache(res);
  res.json({ code: 0, data: legal.getPrivacy() });
});

router.get('/terms', (req, res) => {
  setPublicCache(res);
  res.json({ code: 0, data: legal.getTerms() });
});

module.exports = router;
