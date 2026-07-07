const mysql = require('mysql2/promise');
const config = require('./index');
const logger = require('../utils/logger');

const SLOW_QUERY_MS = Number(process.env.DB_SLOW_QUERY_MS) || 1000;

function createPool() {
  return mysql.createPool({
    host: config.DB.host,
    port: config.DB.port,
    user: config.DB.user,
    password: config.DB.password,
    database: config.DB.database,
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_POOL_SIZE) || 10,
    queueLimit: 0,
    charset: 'utf8mb4',
    dateStrings: false,
    // leak detection + idle cleanup
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    idleTimeout: 60000, // 60s idle 后关闭连接
    maxIdle: Number(process.env.DB_MAX_IDLE) || 5,
  });
}

const defaultPool = createPool();

// Idempotent wrap of pool.query / pool.execute to record metrics.
// Guarded by pool.__metricsWrapped so re-requiring this module in tests
// does not double-wrap (which would double-count and grow stack).
if (!defaultPool.__metricsWrapped) {
  defaultPool.__metricsWrapped = true;

  const wrap = (orig, _name) => function (...args) {
    const m = require('../routes/metrics');
    const t0 = Date.now();
    let op = 'other';
    try {
      const sql = (typeof args[0] === 'string' ? args[0] : args[0]?.sql) || '';
      const match = sql.match(/^\s*(select|insert|update|delete|replace)/i);
      op = (match?.[1] || 'other').toLowerCase();
    } catch (_e) { /* ignore */ }
    const record = (status) => {
      try {
        m.dbQueries.inc({ status });
        m.dbQueryDuration.observe({ op }, (Date.now() - t0) / 1000);
      } catch (_e) { /* metrics best-effort */ }
    };
    const p = orig.apply(this, args);
    if (p && typeof p.then === 'function') {
      return p.then(
        (r) => { record('ok'); return r; },
        (err) => { record('err'); throw err; },
      );
    }
    record('ok');
    return p;
  };

  defaultPool.query = wrap(defaultPool.query.bind(defaultPool), 'query');
  if (typeof defaultPool.execute === 'function') {
    defaultPool.execute = wrap(defaultPool.execute.bind(defaultPool), 'execute');
  }
}

// 慢查询 warn：> SLOW_QUERY_MS 自动记录
if (!defaultPool.__slowWrapped) {
  defaultPool.__slowWrapped = true;
  const wrapSlow = (orig) => async function (sql, params) {
    const start = Date.now();
    try {
      const result = await orig(sql, params);
      const dur = Date.now() - start;
      if (dur > SLOW_QUERY_MS) {
        logger.warn(
          { sql: String(sql).slice(0, 200), params, durationMs: dur },
          'db slow query'
        );
      }
      return result;
    } catch (err) {
      const dur = Date.now() - start;
      logger.error(
        { sql: String(sql).slice(0, 200), params, durationMs: dur, err: err.message },
        'db query failed'
      );
      throw err;
    }
  };
  defaultPool.query = wrapSlow(defaultPool.query.bind(defaultPool));
  if (typeof defaultPool.execute === 'function') {
    defaultPool.execute = wrapSlow(defaultPool.execute.bind(defaultPool));
  }
}

// 健康检查：每 30s 输出 pool state（idle 数量 + 总数 + acquire 队列长度）
const isTest =
  process.env.NODE_ENV === 'test' || process.env.npm_lifecycle_event === 'test';
if (!isTest) {
  setInterval(() => {
    try {
      const inner = defaultPool.pool || {};
      const all = inner._allConnections?.length ?? 0;
      const free = inner._freeConnections?.length ?? 0;
      const queue = inner._connectionQueue?.length ?? 0;
      const used = Math.max(all - free, 0);
      logger.debug(
        { dbPoolAll: all, dbPoolFree: free, dbPoolUsed: used, dbPoolQueue: queue },
        'db pool heartbeat'
      );
    } catch (_e) { /* heartbeat best-effort */ }
  }, 30000).unref();
}

module.exports = defaultPool;
module.exports.createPool = createPool;