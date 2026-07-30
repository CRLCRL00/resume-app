/**
 * Round 31-D: client_errors ops endpoints
 *
 * POST /api/internal/client-errors/cleanup  — manual TTL cleanup trigger (auth: ALERT_TOKEN)
 * GET  /api/internal/client-errors/summary  — aggregation summary (auth: ALERT_TOKEN)
 *
 * Auth: 共享 ALERT_TOKEN（同 alerts 路由模式）。Ops 用 token header 直接调，不需要 JWT。
 */
const express = require('express');
const router = express.Router();
const { runClientErrorsCleanup } = require('../jobs/clientErrorsCleanup');
const { summarizeClientErrors } = require('../services/clientErrorsAgg');
const logger = require('../utils/logger');

const ALERT_TOKEN = process.env.ALERT_TOKEN || 'dev-alert-token-change-me';

function checkAlertToken(req, res, next) {
  const token = req.headers['x-alert-token'];
  if (token !== ALERT_TOKEN) {
    return res.status(401).json({ code: 1002, message: 'invalid alert token' });
  }
  next();
}

// POST /api/internal/client-errors/cleanup  — manual TTL trigger
router.post('/client-errors/cleanup', checkAlertToken, async (req, res, next) => {
  try {
    const retentionDays = Number.isFinite(req.body?.retentionDays) ? Number(req.body.retentionDays) : 7;
    const batchSize = Number.isFinite(req.body?.batchSize) ? Number(req.body.batchSize) : 1000;
    const result = await runClientErrorsCleanup({ retentionDays, batchSize, logger });
    res.json({ code: 0, data: result });
  } catch (err) {
    logger.error({ err: err.message }, 'client-errors cleanup route failed');
    next(err);
  }
});

// GET /api/internal/client-errors/summary?hours=24
router.get('/client-errors/summary', checkAlertToken, async (req, res, next) => {
  try {
    const hours = Number.isFinite(Number(req.query.hours)) ? Number(req.query.hours) : 24;
    const summary = await summarizeClientErrors({ windowHours: hours });
    res.json({ code: 0, data: summary });
  } catch (err) {
    logger.error({ err: err.message }, 'client-errors summary route failed');
    next(err);
  }
});

module.exports = router;