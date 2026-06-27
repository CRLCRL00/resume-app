const logger = require('../utils/logger');

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

  res.status(500).json({ code: 1500, message: 'Internal server error' });
}

module.exports = { AppError, notFoundHandler, errorHandler };