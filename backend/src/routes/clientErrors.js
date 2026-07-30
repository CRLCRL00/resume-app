const express = require('express');
const router = express.Router();
const Joi = require('joi');
const pool = require('../config/db');
const logger = require('../utils/logger');
const { validateBody } = require('../middleware/validate');

const ALLOWED_ERROR_TYPES = new Set([
  'app_onerror',
  'wx_onerror',
  'request_fail',
  'unhandled_rejection',
]);

// 4KB message / 32KB stack 上限（防误报巨型 payload）
const clientErrorSchema = Joi.object({
  openid: Joi.string().max(64).allow(null, ''),
  version: Joi.string().max(32).allow(null, ''),
  platform: Joi.string().max(32).allow(null, ''),
  errorType: Joi.string().valid(...ALLOWED_ERROR_TYPES).required(),
  message: Joi.string().max(4096).required(),
  stack: Joi.string().max(32 * 1024).allow(null, ''),
  url: Joi.string().max(512).allow(null, ''),
  metadata: Joi.object().unknown(true).allow(null),
});

/**
 * POST /api/internal/client-errors
 * 小程序前端运行时错误上报（App.onError / wx.onError / request_fail / unhandled_rejection）
 * Body: { openid?, version?, platform?, errorType, message, stack?, url?, metadata? }
 * Response: { code: 0, data: { id } }
 */
router.post('/client-errors', validateBody(clientErrorSchema, { stripUnknown: true }), async (req, res, next) => {
  try {
    const b = req.body;
    const metadataJson = b.metadata != null ? JSON.stringify(b.metadata) : null;
    const [r] = await pool.query(
      `INSERT INTO client_errors
         (openid, version, platform, error_type, message, stack, url, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        b.openid || null,
        b.version || null,
        b.platform || null,
        b.errorType,
        b.message,
        b.stack || null,
        b.url || null,
        metadataJson,
      ]
    );
    res.json({ code: 0, data: { id: r.insertId } });
  } catch (err) {
    logger.error({ err: err.message }, 'client-errors insert failed');
    next(err);
  }
});

module.exports = router;