const winston = require('winston');
const config = require('../config');

/**
 * 敏感字段脱敏。匹配常见键名 → 替换 value。
 */
const REDACT_KEYS = ['password', 'token', 'jwt', 'authorization', 'apikey', 'api_key', 'deepseek_api_key', 'wx_secret', 'code', 'openid'];
const REDACT_PATTERNS = [
  /Bearer\s+[A-Za-z0-9_.\-]+/gi,
  /sk-[A-Za-z0-9]{20,}/g,
  /\b1[3-9]\d{9}\b/g,  // 中国大陆手机号
];

function redact(value) {
  if (value == null) return value;
  if (typeof value === 'string') {
    let v = value;
    for (const p of REDACT_PATTERNS) v = v.replace(p, '[REDACTED]');
    return v;
  }
  if (typeof value === 'object') {
    if (Array.isArray(value)) return value.map(redact);
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = REDACT_KEYS.includes(k.toLowerCase()) ? '[REDACTED]' : redact(v);
    }
    return out;
  }
  return value;
}

const redactFormat = winston.format((info) => {
  // winston info has symbol + message + level + ... + meta spread
  const cloned = { ...info };
  // redact level/meta but keep message readable
  if (typeof cloned.message === 'string') cloned.message = redact(cloned.message);
  for (const [k, v] of Object.entries(cloned)) {
    if (k === 'level' || k === 'message' || k === 'symbol') continue;
    cloned[k] = redact(v);
  }
  return cloned;
});

const logger = winston.createLogger({
  level: config.LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp(),
    redactFormat(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
});

module.exports = logger;
