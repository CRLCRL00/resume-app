const jwt = require('jsonwebtoken');
const config = require('../config');
const { AppError } = require('../middleware/errorHandler');

/**
 * 仅允许 HS256 防止 alg=none 等攻击
 */
const ALLOWED_ALGS = ['HS256'];

function sign(payload) {
  return jwt.sign(payload, config.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: config.JWT_EXPIRES_IN,
  });
}

function verify(token) {
  try {
    return jwt.verify(token, config.JWT_SECRET, { algorithms: ALLOWED_ALGS });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new AppError(1002, 'token expired', 401);
    }
    throw new AppError(1002, 'invalid jwt token', 401);
  }
}

module.exports = { sign, verify };
