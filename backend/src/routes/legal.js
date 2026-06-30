const express = require('express');
const router = express.Router();
const legal = require('../services/legal');
const pool = require('../config/db');

/**
 * 公共缓存策略：法务文档改动频率低（按月），5 min 边缘缓存 + last-modified
 * docs/legal/terms.md / privacy.md 改 + 5 min 自动过
 */
function setPublicCache(res) {
  res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
}

router.use((req, res, next) => {
  // 公共端点 CORS（mini-program 不需要，但浏览器调试 + 文档 + 第三方有用）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

router.options('*', (req, res) => res.sendStatus(200));

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
