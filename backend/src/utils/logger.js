const pino = require('pino');
const { getRequestId } = require('../middleware/requestContext');

const isTest = process.env.NODE_ENV === 'test' || process.env.npm_lifecycle_event === 'test';

const REDACT_PATHS = [
  'password',
  'token',
  'jwt',
  'authorization',
  'apikey',
  'api_key',
  'deepseek_api_key',
  'wx_secret',
  'code',
  'openid',
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
];

const REDACT_STRING_PATTERNS = [
  /Bearer\s+[A-Za-z0-9_.\-]+/gi,
  /sk-[A-Za-z0-9]{20,}/g,
  /\b1[3-9]\d{9}\b/g,
];

function redactString(v) {
  if (typeof v !== 'string') return v;
  let out = v;
  for (const p of REDACT_STRING_PATTERNS) out = out.replace(p, '[REDACTED]');
  return out;
}

function redactValue(v) {
  if (v == null) return v;
  if (typeof v === 'string') return redactString(v);
  if (Array.isArray(v)) return v.map(redactValue);
  if (typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = REDACT_PATHS.includes(k.toLowerCase()) ? '[REDACTED]' : redactValue(val);
    }
    return out;
  }
  return v;
}

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: 'resume-app' },
  formatters: {
    level(label) { return { level: label }; },
    log(obj) {
      return redactValue(obj);
    },
  },
  mixin() {
    const rid = getRequestId();
    return rid ? { requestId: rid } : {};
  },
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
  ...(isTest ? { level: 'silent' } : {}),
});

module.exports = logger;