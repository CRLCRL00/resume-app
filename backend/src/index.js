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

  // Round 40: multi-pod alert leader election. Try to acquire the
  // 'alert' role lease; on success start the heartbeat so the lease is
  // renewed every 5s. If we lose the lease (another pod took over after
  // our TTL expired), the heartbeat stops itself.
  //
  // Failure here is non-fatal: alertRouter falls back to fail-open (each
  // pod sends) when leaderElect.isLeader throws, so worst case is back
  // to the pre-R40 duplicate behavior — never silent.
  const leaderElect = require('./services/leaderElect');
  const metricsModule = require('./routes/metrics');
  leaderElect.tryAcquire('alert')
    .then((res) => {
      if (res.acquired) {
        logger.info({ role: 'alert', pod: res.leader, ttl: res.ttl },
          'became alert leader');
        leaderElect.startHeartbeat('alert');
      } else {
        logger.info({ role: 'alert', currentLeader: res.leader },
          'another pod holds the alert leader lease; staying follower');
      }
      metricsModule.alertLeaderStatus.set(
        { pod: leaderElect.podName(), role: 'alert' },
        res.acquired ? 1 : 0
      );
    })
    .catch((err) => {
      logger.warn({ err: err.message },
        'alert leader election failed at boot; continuing with fail-open');
      // Surface the failure in the gauge (0 = not leader) so ops can see it.
      try {
        metricsModule.alertLeaderStatus.set(
          { pod: leaderElect.podName(), role: 'alert' }, 0
        );
      } catch (_e) { /* noop */ }
    });

  // Refresh the gauge every 10s so /metrics reflects current state even
  // if leadership changed without a boot event (e.g. another pod died).
  setInterval(async () => {
    try {
      const isL = await leaderElect.isLeader('alert');
      metricsModule.alertLeaderStatus.set(
        { pod: leaderElect.podName(), role: 'alert' },
        isL ? 1 : 0
      );
    } catch (_e) { /* noop */ }
  }, 10_000).unref();
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
  onShutdownStart: () => {
    isShuttingDown = true;
    // Round 40: release alert leader lease so the next pod can take over
    // immediately instead of waiting for TTL. Fire-and-forget — the
    // shutdown timeout (30s) gives us plenty of headroom if Redis is slow.
    if (process.env.NODE_ENV !== 'test') {
      try {
        const leaderElect = require('./services/leaderElect');
        leaderElect.stopHeartbeat('alert').catch(() => { /* noop */ });
      } catch (_e) { /* noop */ }
    }
  },
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