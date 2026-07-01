const mysql = require('mysql2/promise');
const config = require('./index');

function createPool() {
  return mysql.createPool({
    host: config.DB.host,
    port: config.DB.port,
    user: config.DB.user,
    password: config.DB.password,
    database: config.DB.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4',
    dateStrings: false,
  });
}

const defaultPool = createPool();

// Idempotent wrap of pool.query / pool.execute to record metrics.
// Guarded by pool.__metricsWrapped so re-requiring this module in tests
// does not double-wrap (which would double-count and grow stack).
if (!defaultPool.__metricsWrapped) {
  defaultPool.__metricsWrapped = true;

  const wrap = (orig, name) => function (...args) {
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

module.exports = defaultPool;
module.exports.createPool = createPool;
