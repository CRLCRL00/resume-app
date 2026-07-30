/**
 * alertWebhook.js — Round 32-F incoming Slack endpoint.
 *
 * Two endpoints (mounted under /api/internal/alerts):
 *   POST /webhook/slack     — incoming Slack webhook (HMAC-verified)
 *   POST /webhook/slack/command — Slack slash command ("/alerts status")
 *
 * Slack incoming-webhook signature convention (matches the one we use
 * on outbound): `X-Alert-Signature: sha256=<hex>` where the hex is
 * HMAC-SHA256(secret, raw_body + timestamp). The same pattern as
 * routes/alerts.js so ops can reuse the signing helper.
 *
 * Env:
 *   SLACK_HMAC_SECRET   (if empty, verification is SKIPPED — dev only)
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const logger = require('../utils/logger');

const SLACK_HMAC_SECRET = process.env.SLACK_HMAC_SECRET || '';
const MAX_SKEW_MS = 5 * 60 * 1000;

function verifySig(rawBody, tsMs, sigHeader, secret) {
  if (!secret) {
    // No secret configured → verification skipped. Log so ops sees it.
    return true;
  }
  if (!sigHeader || !sigHeader.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', secret)
    .update(rawBody + tsMs)
    .digest('hex');
  const provided = sigHeader.slice(7);
  if (expected.length !== provided.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  } catch (_e) { return false; }
}

/**
 * POST /api/internal/alerts/webhook/slack
 *
 * Headers:
 *   X-Alert-Timestamp: epoch ms
 *   X-Alert-Signature: 'sha256=<hex>'  (HMAC over rawBody + timestamp)
 *
 * Body: anything JSON-y. We log it and acknowledge.
 */
router.post('/webhook/slack', (req, res) => {
  const tsMs = req.headers['x-alert-timestamp'];
  const sig = req.headers['x-alert-signature'];

  const nowMs = Date.now();
  if (!tsMs || Math.abs(nowMs - Number(tsMs)) > MAX_SKEW_MS) {
    return res.status(401).json({ code: 1002, message: 'timestamp skewed' });
  }
  const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : (req.body || '');
  if (!verifySig(rawBody, tsMs, sig, SLACK_HMAC_SECRET)) {
    return res.status(401).json({ code: 1002, message: 'bad signature' });
  }

  let parsed = {};
  try { parsed = rawBody ? JSON.parse(rawBody) : {}; } catch (_e) {}
  logger.info({ source: 'slack-incoming', payload: parsed }, 'slack webhook received');
  res.json({ code: 0, data: { received: true } });
});

/**
 * POST /api/internal/alerts/webhook/slack/command
 * Slack slash-command payload (`application/x-www-form-urlencoded`):
 *   text=<command-args>   e.g. "status"
 *   user_id=...
 *   team_id=...
 *
 * Auth: same HMAC headers as the webhook endpoint.
 *
 * Response shape (Slack expects 200 + plain text or JSON with
 * `response_type: 'in_channel' | 'ephemeral'` + `text`).
 */
router.post('/webhook/slack/command', (req, res) => {
  const tsMs = req.headers['x-alert-timestamp'];
  const sig = req.headers['x-alert-signature'];

  const nowMs = Date.now();
  if (!tsMs || Math.abs(nowMs - Number(tsMs)) > MAX_SKEW_MS) {
    return res.status(401).json({ code: 1002, message: 'timestamp skewed' });
  }
  // Slack sends url-encoded bodies. express.urlencoded is registered
  // globally for the slash-command path (see app.js).
  const rawBody = req.body instanceof Buffer
    ? req.body.toString('utf8')
    : (typeof req.rawBody === 'string' ? req.rawBody : '');
  if (!verifySig(rawBody, tsMs, sig, SLACK_HMAC_SECRET)) {
    return res.status(401).json({ code: 1002, message: 'bad signature' });
  }

  const text = String(req.body?.text || '').trim().toLowerCase();
  // We can't import metricsAlerts here without circularity; just return
  // a stable message. The route handler in metricsAlerts.js is the
  // canonical read endpoint.
  let responseText;
  if (text === 'status' || text === '') {
    responseText = ':white_check_mark: Alerts endpoint reachable. Hit GET /api/internal/metrics/alerts for the live firing list.';
  } else if (text === 'help') {
    responseText = 'Commands: `/alerts status`, `/alerts help`';
  } else {
    responseText = `:warning: unknown command: ${text}`;
  }
  res.json({ response_type: 'ephemeral', text: responseText });
});

// Mount helper: app.js does `app.use('/api/internal/alerts', alertWebhook.rawBodyMiddleware, router)`
// when url-encoded payload (slash command) is needed.
router.rawBodyMiddleware = express.raw({ type: '*/*', limit: '64kb' });
router.urlEncodedMiddleware = express.urlencoded({ extended: false, limit: '64kb' });

module.exports = router;