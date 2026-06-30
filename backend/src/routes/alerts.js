const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * POST /api/internal/alert — receive monitor webhooks
 * Auth: X-Alert-Token + X-Alert-Timestamp + X-Alert-Signature (HMAC-SHA256)
 *
 * Headers:
 *   X-Alert-Token: shared secret
 *   X-Alert-Timestamp: epoch ms（5 分钟窗口防重放）
 *   X-Alert-Signature: 'sha256=<hex>'   # SHA256(secret, payload_body + timestamp)
 *
 * Body: { timestamp, url, http, body? }
 */
const ALERT_TOKEN = process.env.ALERT_TOKEN || 'dev-alert-token-change-me';
const MAX_SKEW_MS = 5 * 60 * 1000;

function verifySig(payloadBody, tsMs, sigHeader) {
  if (!sigHeader || !sigHeader.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', ALERT_TOKEN)
    .update(payloadBody + tsMs)
    .digest('hex');
  const provided = sigHeader.slice(7);
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

function readBodyForSig(req) {
  // express.json() 已解析；如果调用方在 body parser 后要拿到 raw body 难。
  // 我们用 rebuilt JSON 字符串作为 canonical（与服务端 JSON 序列化结果一致）:
  //   实际我们只是重新序列化 req.body — 对 server-side receiver 这 ok
  return JSON.stringify(req.body || {});
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
  const bodyStr = readBodyForSig(req);
  if (!verifySig(bodyStr, tsMs, sig)) {
    return res.status(401).json({ code: 1002, message: 'bad signature' });
  }

  const payload = req.body || {};
  const line = JSON.stringify({ received_at: new Date().toISOString(), ...payload });
  logger.warn({ alert: payload }, 'alert received');
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

module.exports = router;
