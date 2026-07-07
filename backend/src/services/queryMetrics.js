// 慢查询仪表：环形缓冲 + Prometheus 直方图/计数器
// 入口：recordQuery({sql, durationMs, operation, table})
// 查询：getRecentSlowQueries / getStats
//
// 设计要点：
//   - buffer: Array FIFO, max 500 entries
//   - 跳过 SET/SHOW/USE/START TRANSACTION/COMMIT (admin/protocol queries)
//   - SQL 截断到 200 字避免大 INSERT 把内存撑爆
//   - operation: SELECT/INSERT/UPDATE/DELETE/REPLACE/CALL
//   - table: FROM/INTO/UPDATE 后第一个 identifier, fallback "unknown"
//   - test env 短路 recordQuery (避免污染测试)
//
// test 入口：
//   - _resetForTests() 清空 buffer + byTable
//   - _bufferForTests() 拿内部 buffer 引用
'use strict';

const MAX_BUFFER = 500;
const MAX_SQL_LEN = 200;

function getThreshold() {
  return Number(process.env.SLOW_QUERY_MS) || 200;
}

// 跳过不计入 user query metrics 的语句
const SKIP_RE = /^\s*(SET\b|SHOW\b|USE\b|START\s+TRANSACTION\b|COMMIT\b)/i;

const buffer = [];
const byTable = Object.create(null);
let totalTracked = 0;
let slowCount = 0;

function truncateSql(sql) {
  if (typeof sql !== 'string') return '';
  return sql.length > MAX_SQL_LEN ? sql.slice(0, MAX_SQL_LEN) : sql;
}

function shouldSkip(sql) {
  if (!sql) return true;
  return SKIP_RE.test(sql);
}

function extractOperation(sql) {
  if (!sql) return 'other';
  const m = sql.match(/^\s*(select|insert|update|delete|replace|call)\b/i);
  return m ? m[1].toLowerCase() : 'other';
}

function extractTable(sql) {
  if (!sql) return 'unknown';
  // INTO/UPDATE 优先 (因为 INSERT/UPDATE 通常是 INTO/UPDATE 紧接 table)
  let m = sql.match(/^\s*(?:insert|replace)\s+(?:ignore\s+)?into\s+`?([A-Za-z_][A-Za-z0-9_]*)`?/i);
  if (m) return m[1];
  m = sql.match(/^\s*update\s+(?:ignore\s+)?`?([A-Za-z_][A-Za-z0-9_]*)`?/i);
  if (m) return m[1];
  m = sql.match(/^\s*delete\s+from\s+`?([A-Za-z_][A-Za-z0-9_]*)`?/i);
  if (m) return m[1];
  m = sql.match(/^\s*select\s+.+?\bfrom\s+`?([A-Za-z_][A-Za-z0-9_]*)`?/i);
  if (m) return m[1];
  return 'unknown';
}

function recordQuery({ sql, durationMs, operation, table }) {
  // test env 短路 — 不污染 test 指标
  if (process.env.NODE_ENV === 'test') return;

  if (shouldSkip(sql)) return;

  const sqlStr = truncateSql(typeof sql === 'string' ? sql : '');
  const op = operation || extractOperation(sqlStr || sql);
  const tbl = table || extractTable(sqlStr || sql);
  const dur = Number.isFinite(durationMs) ? durationMs : 0;
  const threshold = getThreshold();
  const now = Date.now();

  // 更新 Prometheus（fail-soft：metrics 加载顺序无关）
  try {
    const m = require('../routes/metrics');
    // 用 _v2 直方图（按 operation+table 切分），避免和旧的 {op} 标签冲突
    if (m && m.dbQueryDurationV2 && typeof m.dbQueryDurationV2.observe === 'function') {
      m.dbQueryDurationV2.observe({ operation: op, table: tbl }, dur / 1000);
    }
    if (dur > threshold && m && m.dbSlowQueries && typeof m.dbSlowQueries.inc === 'function') {
      m.dbSlowQueries.inc({ operation: op, table: tbl });
    }
  } catch (_e) { /* metrics 模块未就绪：best-effort */ }

  // totalTracked = 所有非 admin query 计数（用于观察采集覆盖率）
  totalTracked += 1;

  // buffer / byTable / slowCount 仅记录慢查询
  if (dur <= threshold) return;

  const entry = { sql: sqlStr, durationMs: dur, operation: op, table: tbl, timestamp: now };
  buffer.push(entry);
  if (buffer.length > MAX_BUFFER) buffer.shift();
  byTable[tbl] = (byTable[tbl] || 0) + 1;
  slowCount += 1;
}

function getRecentSlowQueries({ limit = 20, sinceMs = 0 } = {}) {
  const cutoff = sinceMs > 0 ? Date.now() - sinceMs : 0;
  const filtered = buffer.filter((e) => e.timestamp >= cutoff);
  // 最新在前
  filtered.sort((a, b) => b.timestamp - a.timestamp);
  const lim = Math.max(1, Math.min(Number(limit) || 20, MAX_BUFFER));
  return filtered.slice(0, lim);
}

function getStats() {
  return {
    slowQueryThresholdMs: getThreshold(),
    totalTracked,
    slowCount,
    byTable: { ...byTable },
  };
}

function _resetForTests() {
  buffer.length = 0;
  for (const k of Object.keys(byTable)) delete byTable[k];
  totalTracked = 0;
  slowCount = 0;
}

function _bufferForTests() {
  return buffer;
}

module.exports = {
  recordQuery,
  getRecentSlowQueries,
  getStats,
  extractOperation,
  extractTable,
  _resetForTests,
  _bufferForTests,
  MAX_BUFFER,
  MAX_SQL_LEN,
};