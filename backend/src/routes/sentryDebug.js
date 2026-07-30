const express = require('express');
const router = express.Router();
const Joi = require('joi');
const logger = require('../utils/logger');
const { validateBody } = require('../middleware/validate');
const { isInitialized, captureMessage } = require('../sentry');

const sentryDebugSchema = Joi.object({
  message: Joi.string().max(4096).default('manual sentry debug event'),
  level: Joi.string().valid('error', 'warning', 'info', 'debug', 'fatal').default('info'),
});

/**
 * POST /api/internal/sentry-debug
 * 仅当 SENTRY_DSN 配置时启用；否则返回 503 + 明确提示。
 *
 * Body: { message?: string, level?: 'error'|'warning'|'info'|'debug'|'fatal' }
 * Response: { code: 0, data: { eventId } }
 */
router.post('/sentry-debug', validateBody(sentryDebugSchema, { stripUnknown: true }), (req, res) => {
  if (!isInitialized()) {
    return res.status(503).json({
      code: 0,
      data: {
        sentry: false,
        hint: 'SENTRY_DSN not configured',
      },
    });
  }
  const { message, level } = req.body;
  const eventId = captureMessage(message, level, {
    requestId: req.requestId,
    route: '/api/internal/sentry-debug',
  });
  logger.info({ eventId, level }, 'sentry-debug captureMessage dispatched');
  res.json({
    code: 0,
    data: { sentry: true, eventId, level, message },
  });
});

module.exports = router;