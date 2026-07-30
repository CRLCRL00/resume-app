const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const logger = require('../utils/logger');
const { deliver } = require('../services/webhook');

/**
 * POST /api/internal/alert — receive monitor webhooks
 * Auth: X-Alert-Token + X-Alert-Timestamp + X-Alert-Signature (HMAC-SHA256)
 *
 * Headers:
 *   X-Alert-Token: shared secret
 *   X-Alert-Timestamp: epoch ms（5 分钟窗口防重放）
 *   X-Alert-Signature: 'sha256=<hex>'   # SHA256(secret, raw_request_body + timestamp)
 *
 * Body: { timestamp, url, http, body? }
 *
 * IMPORTANT: route mounted with express.raw({type:'application/json'}); we keep
 *   req.body as Buffer/string and parse manually for content+sig verification.
 */
const ALERT_TOKEN = process.env.ALERT_TOKEN || 'dev-alert-token-change-me';
const MAX_SKEW_MS = 5 * 60 * 1000;

function verifySig(rawBody, tsMs, sigHeader) {
  if (!sigHeader || !sigHeader.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', ALERT_TOKEN)
    .update(rawBody + tsMs)
    .digest('hex');
  const provided = sigHeader.slice(7);
  if (expected.length !== provided.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  } catch (_e) { return false; }
}

router.post('/alert', (req, res) => {
  const token = req.headers['x-alert-token'];
  const tsMs = req.headers['x-alert-timestamp'];
  const sig = req.headers['x-alert-signature'];

  if (token !== ALERT_TOKEN) {
    return res.status(401).json({ code: 1002, message: 'invalid alert token' });
  }
  // 5 min replay window
  const nowMs = Date.now();
  if (!tsMs || Math.abs(nowMs - Number(tsMs)) > MAX_SKEW_MS) {
    return res.status(401).json({ code: 1002, message: 'timestamp skewed' });
  }
  const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : (req.body || '');
  if (!verifySig(rawBody, tsMs, sig)) {
    return res.status(401).json({ code: 1002, message: 'bad signature' });
  }

  let parsed = {};
  try { parsed = rawBody ? JSON.parse(rawBody) : {}; } catch (_e) {}
  const line = JSON.stringify({ received_at: new Date().toISOString(), ...parsed });
  logger.warn({ alert: parsed }, 'alert received');
  try {
    require('fs').appendFileSync('/var/log/resume-app-alerts.log', line + '\n');
  } catch (e) {}
  res.json({ code: 0, data: { received: true } });
});

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

/**
 * Express middleware: keep req.body as raw Buffer for this router (so HMAC sees unchanged body).
 * Mount BEFORE express.json() in app.js.
 */
router.rawBodyMiddleware = express.raw({ type: '*/*', limit: '64kb' });

/**
 * 转发告警到下游 target URL（带 HMAC 签名 + 重试 + 死信）
 * 用法：forwardAlert('https://target.example/webhook', alertPayload)
 *   - 自动从 process.env.ALERT_TARGET_SECRET 取密钥
 *   - 失败时落库 alerts_dead_letter，由后台任务回收
 */
async function forwardAlert(url, payload) {
  return deliver({
    url,
    payload,
    secret: process.env.ALERT_TARGET_SECRET,
  });
}

module.exports = router;
module.exports.forwardAlert = forwardAlert;
