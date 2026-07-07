const express = require('express');
const router = express.Router();
const { userAuth } = require('../../middleware/auth');
const { adminAuth } = require('../../middleware/adminAuth');
const queryMetrics = require('../../services/queryMetrics');

// 解析 ?since=1h / 30m / 2d / 600s / 1000 (ms)
function parseSinceMs(raw) {
  if (!raw) return 60 * 60 * 1000; // default 1h
  const m = String(raw).match(/^(\d+)\s*([smhd])?$/i);
  if (!m) return 60 * 60 * 1000;
  const n = Number(m[1]);
  const unit = (m[2] || 'ms').toLowerCase();
  const mul = unit === 's' ? 1000
    : unit === 'm' ? 60 * 1000
      : unit === 'h' ? 60 * 60 * 1000
        : unit === 'd' ? 24 * 60 * 60 * 1000
          : 1;
  return n * mul;
}

/**
 * GET /api/admin/queries/slow?limit=20&since=1h
 * 返回 ring buffer 中最近 slow queries；按 timestamp desc。
 */
router.get('/slow', userAuth, adminAuth, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 500);
    const sinceMs = parseSinceMs(req.query.since);
    const items = queryMetrics.getRecentSlowQueries({ limit, sinceMs });
    res.json({ code: 0, data: { items, total: items.length, limit, sinceMs } });
  } catch (err) { next(err); }
});

/**
 * GET /api/admin/queries/stats
 * 聚合统计：阈值 / totalTracked / slowCount / byTable
 */
router.get('/stats', userAuth, adminAuth, async (req, res, next) => {
  try {
    res.json({ code: 0, data: queryMetrics.getStats() });
  } catch (err) { next(err); }
});

module.exports = router;