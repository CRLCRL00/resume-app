const express = require('express');
const router = express.Router();
const legal = require('../services/legal');
const pool = require('../config/db');

const ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || '*')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

/**
 * 公共缓存：法务文档按月改动，5 min 边缘缓存
 */
function setPublicCache(res) {
  res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
}

router.use((req, res, next) => {
  const origin = req.headers.origin;
  // 允许的 origin；'*' = 全放行（兼容开发）
  if (ALLOWED_ORIGINS.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else if (origin) {
    // 未知 origin：不返 CORS 头 → 浏览器 block
  }
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
