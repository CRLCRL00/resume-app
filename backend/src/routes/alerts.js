const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

/**
 * POST /api/internal/alert — receive monitor webhooks (server-level: monitor.sh, external)
 * Body: { timestamp, url, http, body? } — any shape
 * Auth: shared token (X-Alert-Token header)
 *
 * 本地使用：日志 + 写入 /var/log/resume-app-alerts.log
 */
const ALERT_TOKEN = process.env.ALERT_TOKEN || 'dev-alert-token-change-me';

router.post('/alert', (req, res) => {
  const token = req.headers['x-alert-token'];
  if (token !== ALERT_TOKEN) {
    return res.status(401).json({ code: 1002, message: 'invalid alert token' });
  }
  const payload = req.body || {};
  const line = JSON.stringify({
    received_at: new Date().toISOString(),
    ...payload,
  });
  logger.warn({ alert: payload }, 'alert received');
  // 落本地文件（monitor 失败时可查）
  try {
    require('fs').appendFileSync('/var/log/resume-app-alerts.log', line + '\n');
  } catch (e) { /* /var/log may not be writable as app user, ignore */ }
  res.json({ code: 0, data: { received: true } });
});

/**
 * GET /api/internal/alerts/recent — 简单拉近 50 条
 */
router.get('/alerts/recent', (req, res) => {
  const token = req.headers['x-alert-token'];
  if (token !== ALERT_TOKEN) {
    return res.status(401).json({ code: 1002, message: 'invalid alert token' });
  }
  try {
    const fs = require('fs');
    if (!fs.existsSync('/var/log/resume-app-alerts.log')) {
      return res.json({ code: 0, data: { items: [] } });
    }
    const lines = fs.readFileSync('/var/log/resume-app-alerts.log', 'utf8').split('\n').filter(Boolean);
    const items = lines.slice(-50).reverse().map(l => {
      try { return JSON.parse(l); } catch { return { raw: l }; }
    });
    res.json({ code: 0, data: { items } });
  } catch (err) {
    res.status(500).json({ code: 1500, message: err.message });
  }
});

module.exports = router;
