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

  // R40 + R42: multi-pod leader election for multiple roles.
  // Each role has independent leader leases; one pod can hold
  // multiple roles simultaneously without conflict.
  //
  // Roles:
  //   alert             — Slack alerting (R40)
  //   slow-query        — periodic slow-query rollup / cleanup
  //   admin-log-cleanup — periodic admin_operation_logs retention sweep
  //
  // Failure is non-fatal: each role's consumer falls back to fail-open
  // (every pod runs) when the lease can't be acquired, so worst case is
  // back to pre-multi-role duplicate behaviour — never silent.
  const leaderElect = require('./services/leaderElect');
  const metricsModule = require('./routes/metrics');

  const ROLES = ['alert', 'admin-log-cleanup'];

  // Per-role on-leader hooks. Each hook runs only on the leader pod.
  // Hooks are best-effort; failures log but don't kill the lease.
  //
  // R42: previously admin-log-cleanup fired from a fixed setInterval on
  // every pod. With leader election, the cron effect now happens on a
  // single pod and prevents redundant retention sweeps under N pods.
  const onLeader = {
    'alert': null, // alertRouter gates on its own (canDispatch)
    'admin-log-cleanup': async () => {
      try {
        const retentionDays = Number(process.env.ADMIN_LOG_RETENTION_DAYS) || 180;
        const { runAdminLogsCleanup } = require('./jobs/adminLogsCleanup');
        await runAdminLogsCleanup({ retentionDays, logger });
      } catch (err) {
        logger.warn({ err: err.message }, 'admin-log-cleanup leader hook failed');
      }
    },
  };

  // Heartbeat intervals per role (override via env). Heartbeat MUST be < TTL
  // to avoid expiry between renewals; defaults are TTL=30s, HB=5s for
  // alert; admin-log-cleanup gets an hourly heartbeat (its hook runs once
  // on acquire + periodically per onLeader's own setInterval).
  const intervalMs = {
    'alert': Number(process.env.ALERT_LEADER_HEARTBEAT_MS) || 5000,
    'admin-log-cleanup': Number(process.env.ADMINLOG_LEADER_HEARTBEAT_MS) || 3600000, // hourly
  };

  (async () => {
    for (const role of ROLES) {
      try {
        const res = await leaderElect.tryAcquire(role);
        if (res.acquired) {
          logger.info({ role, pod: res.leader, ttl: res.ttl }, 'became leader');
          leaderElect.startHeartbeat(role, { intervalMs: intervalMs[role] });
          // Kick off the on-leader hook in the background (fire-and-forget).
          if (onLeader[role]) {
            setTimeout(() => {
              onLeader[role]().catch((err) =>
                logger.warn({ role, err: err.message }, 'leader hook failed'));
            }, 1000).unref();
            // Re-run periodically on the leader pod.
            const hb = intervalMs[role];
            if (hb > 10000) {
              setInterval(() => {
                // Only run if we're still leader (i.e. heartbeat hasn't
                // stopped itself due to losing lease).
                if (leaderElect._activeHeartbeats().includes(role)) {
                  onLeader[role]().catch(() => {});
                }
              }, hb).unref();
            }
          }
        } else {
          logger.info({ role, currentLeader: res.leader },
            'another pod holds leader lease; staying follower');
        }
        // Gauge: alert_leader_status has labels {pod, role}
        metricsModule.alertLeaderStatus.set(
          { pod: leaderElect.podName(), role },
          res.acquired ? 1 : 0
        );
      } catch (err) {
        logger.warn({ role, err: err.message },
          'leader election failed at boot; continuing with fail-open');
        try {
          metricsModule.alertLeaderStatus.set(
            { pod: leaderElect.podName(), role }, 0
          );
        } catch (_e) { /* noop */ }
      }
    }
  })();

  // Refresh all role gauges every 10s so /metrics reflects current state
  // even when leadership changes without a boot event.
  setInterval(async () => {
    for (const role of ROLES) {
      try {
        const isL = await leaderElect.isLeader(role);
        metricsModule.alertLeaderStatus.set(
          { pod: leaderElect.podName(), role },
          isL ? 1 : 0
        );
      } catch (_e) { /* noop */ }
    }
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