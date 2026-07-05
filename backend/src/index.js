const { createApp } = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const pool = require('./config/db');
const redis = require('./config/redis');
const { diagnose } = require('./db/diagnose');
const { setupGracefulShutdown } = require('./lifecycle');

const app = createApp();

let isShuttingDown = false;

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'server started');
});

// Boot 诊断：表/列/admin seed/schema_migrations 校验
diagnose().then(({ ok, warnings }) => {
  if (!ok) logger.warn({ warningsCount: warnings.length }, 'startup diagnostics: warnings present');
  else logger.info('startup diagnostics: all checks passed');
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

// 自定义 middleware：拒新请求（在 shutdown 时）
app.use((req, res, next) => {
  if (isShuttingDown) {
    res.set('Connection', 'close');
    return res.status(503).json({ code: 1501, message: 'server shutting down' });
  }
  next();
});

// 优雅关闭：SIGTERM/SIGINT → drain → 关 pool + redis
const SHUTDOWN_TIMEOUT_MS = 30000;
setupGracefulShutdown(server, {
  logger,
  db: pool,
  redis,
  timeoutMs: SHUTDOWN_TIMEOUT_MS,
  onShutdownStart: () => { isShuttingDown = true; },
});

process.on('uncaughtException', (err) => {
  logger.error({ err: err.message }, 'uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  logger.error({ reason: String(reason) }, 'unhandledRejection');
});