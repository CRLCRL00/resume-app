const logger = require('../utils/logger');
const { isInitialized: sentryReady } = require('../sentry');

class AppError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function notFoundHandler(req, res, next) {
  res.status(404).json({ code: 1404, message: `Not found: ${req.method} ${req.path}` });
}

function errorHandler(err, req, res, next) {
  logger.error({ err, path: req.path, method: req.method }, 'request error');

  if (err instanceof AppError) {
    return res.status(err.status).json({ code: err.code, message: err.message });
  }

  // 500: 转发到 Sentry（带 user id / request id / route context）
  if (sentryReady()) {
    try {
      const Sentry = require('@sentry/node');
      Sentry.withScope((scope) => {
        scope.setTag('route', req.route ? (req.baseUrl + req.route.path) : (req.baseUrl || req.path) || 'unknown');
        scope.setTag('method', req.method);
        if (req.requestId) scope.setTag('requestId', req.requestId);
        if (req.user && req.user.userId != null) scope.setUser({ id: String(req.user.userId) });
        Sentry.captureException(err);
      });
    } catch (_e) { /* never throw from error handler */ }
  }

  res.status(500).json({ code: 1500, message: 'Internal server error' });
}

module.exports = { AppError, notFoundHandler, errorHandler };