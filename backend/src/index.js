const { createApp } = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const pool = require('./config/db');
const redis = require('./config/redis');
const { diagnose } = require('./db/diagnose');
const { setupGracefulShutdown } = require('./lifecycle');
const { initSentry, Sentry } = require('./sentry');
const { runAdminLogsCleanup } = require('./jobs/adminLogsCleanup');

// Sentry 必须在 createApp() 之前 init（让 Express error handler 能注册）
const sentryEnabled = initSentry();

const app = createApp();

// Sentry v8+: Express error handler（覆盖所有 5xx，统一上报到 Sentry）
if (sentryEnabled && typeof Sentry.setupExpressErrorHandler === 'function') {
  Sentry.setupExpressErrorHandler(app);
}

let isShuttingDown = false;

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'server started');
});

// Boot 诊断：表/列/admin seed/schema_migrations 校验
diagnose().then(({ ok, warnings }) => {
  if (!ok) logger.warn({ warningsCount: warnings.length }, 'startup diagnostics: warnings present');
  else logger.info('startup diagnostics: all checks passed');
});

// Round audit-filter: admin_operation_logs TTL cron
// 启动后 5 分钟首次跑一次，之后每 24h 一次
if (process.env.NODE_ENV !== 'test') {
  const retentionDays = Number(process.env.ADMIN_LOG_RETENTION_DAYS) || 180;
  setTimeout(() => {
    runAdminLogsCleanup({ retentionDays, logger })
      .catch((err) => logger.error({ err: err.message }, 'admin_logs cleanup boot failed'));
  }, 5 * 60_000).unref();
  setInterval(() => {
    runAdminLogsCleanup({ retentionDays, logger })
      .catch((err) => logger.error({ err: err.message }, 'admin_logs cleanup cron failed'));
  }, 24 * 60 * 60_000).unref();
}

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
  if (sentryEnabled) {
    try { Sentry.captureException(err); } catch (_e) { /* never throw in handler */ }
  }
});
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.error({ reason: err.message }, 'unhandledRejection');
  if (sentryEnabled) {
    try { Sentry.captureException(err); } catch (_e) { /* never throw in handler */ }
  }
});