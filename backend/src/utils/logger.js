const pino = require('pino');
const { getRequestId } = require('../middleware/requestContext');

const isTest = process.env.NODE_ENV === 'test' || process.env.npm_lifecycle_event === 'test';
const isProd = process.env.NODE_ENV === 'production';

// 开发/staging 用 pretty（如果装有 pino-pretty），否则 JSON line
const usePretty = !isProd && !isTest && process.env.LOG_PRETTY !== 'false';

const transport = usePretty
  ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' } }
  : undefined;

const logger = pino({
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  base: { service: 'resume-app' },
  formatters: { level(label) { return { level: label }; } },
  mixin() {
    const rid = getRequestId();
    return rid ? { requestId: rid } : {};
  },
  serializers: {
    req(req) {
      return {
        method: req.method,
        url: req.url,
        remoteAddress: req.remoteAddress || req.ip,
        headers: req.headers?.['user-agent'] ? { 'user-agent': req.headers['user-agent'] } : undefined,
      };
    },
    res(res) {
      return { statusCode: res.statusCode };
    },
    err(err) {
      return { type: err.type || err.name, message: err.message, stack: err.stack };
    },
  },
  ...(transport ? { transport } : {}),
  ...(isTest ? { level: 'silent' } : {}),
});

module.exports = logger;