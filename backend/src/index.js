const { createApp } = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const pool = require('./config/db');
const redis = require('./config/redis');
const { diagnose } = require('./db/diagnose');

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

/**
 * 优雅关闭：
 * - 拒新连接
 * - 等 in-flight 至 timeout
 * - 关闭 DB pool + Redis
 * - 强制 exit after hard timeout
 */
function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, 'shutting down');

  const SOFT_TIMEOUT_MS = 25000; // wait up to 25s for in-flight
  const HARD_TIMEOUT_MS = 30000; // force exit after

  // 关闭 HTTP server（不再接受新连接）
  server.close(async () => {
    logger.info('http server closed');

    // 关闭后端资源
    const closers = [
      () => pool.end().catch(e => logger.error({ err: e.message }, 'pool close err')),
      () => redis.quit().catch(e => logger.error({ err: e.message }, 'redis close err')),
    ];
    await Promise.allSettled(closers.map(fn => fn()));
    logger.info('resources closed');
    process.exit(0);
  });

  // 软超时：force close idle / keep-alive
  setTimeout(() => {
    logger.warn('soft timeout — forcing keep-alive close');
    server.closeIdleConnections?.();
  }, SOFT_TIMEOUT_MS);

  // 硬超时
  setTimeout(() => {
    logger.error('hard timeout — forcing exit');
    process.exit(1);
  }, HARD_TIMEOUT_MS);
}

// 自定义 middleware：拒新请求（在 shutdown 时）
app.use((req, res, next) => {
  if (isShuttingDown) {
    res.set('Connection', 'close');
    return res.status(503).json({ code: 1501, message: 'server shutting down' });
  }
  next();
});

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  logger.error({ err: err.message }, 'uncaughtException');
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  logger.error({ reason: String(reason) }, 'unhandledRejection');
  shutdown('unhandledRejection');
});
