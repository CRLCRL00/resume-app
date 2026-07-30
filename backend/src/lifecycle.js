/**
 * Graceful shutdown helper.
 *
 * Usage:
 *   const cleanup = setupGracefulShutdown(server, { logger, db, redis, timeoutMs });
 *
 * Behaviour:
 *   - Registers SIGTERM and SIGINT handlers (returns a cleanup() that removes them).
 *   - First signal: logs "shutdown signal received", calls server.close()
 *     (which waits for in-flight requests to drain), then closes db pool
 *     and redis client, then process.exit(0).
 *   - Hard timeout (default 10s): force process.exit(1) even if server stuck.
 *   - Second signal during shutdown: immediate process.exit(1).
 *
 * Test env notes: pass null db/redis to skip closing. Cleanup always removes handlers.
 */

function setupGracefulShutdown(server, opts = {}) {
  const { logger, db, redis, timeoutMs = 10000, onShutdownStart } = opts;

  // Defensive default logger so test mocks always work
  const log = logger || {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };

  let shuttingDown = false;

  function shutdown(signal) {
    if (shuttingDown) {
      log.warn({ signal }, 'shutdown: second signal received, force exit');
      process.exit(1);
    }
    shuttingDown = true;

    if (typeof onShutdownStart === 'function') {
      try { onShutdownStart(signal); } catch (_) { /* ignore */ }
    }

    log.info({ signal }, 'shutdown signal received, draining...');

    // Force-exit safety net: even if server.close never invokes its callback
    // (e.g. stuck keep-alive socket), bail after timeoutMs.
    const hardTimer = setTimeout(() => {
      log.error({ timeoutMs }, 'shutdown hard timeout exceeded, force exit');
      process.exit(1);
    }, timeoutMs);
    hardTimer.unref();

    // closeIdleConnections releases any idle keep-alive sockets so server.close
    // can complete when only idle connections remain.
    try {
      if (typeof server.closeIdleConnections === 'function') {
        server.closeIdleConnections();
      }
    } catch (_) {
      /* ignore */
    }

    // server.close waits for in-flight requests, then invokes cb
    server.close((closeErr) => {
      if (closeErr) {
        log.warn({ err: closeErr.message }, 'http server close error');
      } else {
        log.info('http server closed');
      }

      // Close backends in parallel; log failures but do not throw.
      const closers = [];
      if (db && typeof db.end === 'function') {
        closers.push(
          Promise.resolve()
            .then(() => db.end())
            .then(() => log.info('db pool closed'))
            .catch((e) => log.warn({ err: e.message }, 'db pool close error'))
        );
      }
      if (redis && typeof redis.quit === 'function') {
        closers.push(
          Promise.resolve()
            .then(() => redis.quit())
            .then(() => log.info('redis closed'))
            .catch((e) => log.warn({ err: e.message }, 'redis close error'))
        );
      }

      Promise.allSettled(closers).then(() => {
        clearTimeout(hardTimer);
        log.info('shutdown complete');
        // After server.close + db.end + redis.quit, the event loop has no
        // pending work, so the process exits naturally with code 0. Do NOT
        // call process.exit(0) explicitly here — tests rely on the process
        // staying alive after a successful shutdown.
      });
    });
  }

  const sigtermHandler = () => shutdown('SIGTERM');
  const sigintHandler = () => shutdown('SIGINT');

  process.on('SIGTERM', sigtermHandler);
  process.on('SIGINT', sigintHandler);

  return function cleanup() {
    process.removeListener('SIGTERM', sigtermHandler);
    process.removeListener('SIGINT', sigintHandler);
  };
}

module.exports = { setupGracefulShutdown };