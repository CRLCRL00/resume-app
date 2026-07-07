const test = require('node:test');
const assert = require('node:assert/strict');

// Fresh module per test-file run
const queryMetrics = require('../src/services/queryMetrics');

function reset() {
  queryMetrics._resetForTests();
}

test('recordQuery increments slow counter when duration > threshold', () => {
  reset();
  const before = queryMetrics.getStats();
  queryMetrics.recordQuery({ sql: 'SELECT * FROM users WHERE id = 1', durationMs: 250, operation: 'select', table: 'users' });
  const after = queryMetrics.getStats();
  assert.equal(after.slowCount, before.slowCount + 1);
  assert.ok(after.byTable.users >= 1, 'byTable.users should bump');
});

test('recordQuery does NOT increment slow counter when fast', () => {
  reset();
  const before = queryMetrics.getStats();
  queryMetrics.recordQuery({ sql: 'SELECT 1', durationMs: 5, operation: 'select', table: 'users' });
  const after = queryMetrics.getStats();
  assert.equal(after.slowCount, before.slowCount);
});

test('operation extraction: SELECT/INSERT/UPDATE/DELETE', () => {
  assert.equal(queryMetrics.extractOperation('SELECT * FROM x'), 'select');
  assert.equal(queryMetrics.extractOperation('INSERT INTO x VALUES (1)'), 'insert');
  assert.equal(queryMetrics.extractOperation('UPDATE x SET y=1'), 'update');
  assert.equal(queryMetrics.extractOperation('DELETE FROM x'), 'delete');
  assert.equal(queryMetrics.extractOperation('REPLACE INTO x VALUES (1)'), 'replace');
  assert.equal(queryMetrics.extractOperation('CALL my_proc()'), 'call');
  assert.equal(queryMetrics.extractOperation('  insert into x'), 'insert');
});

test('table extraction: SELECT FROM users', () => {
  assert.equal(queryMetrics.extractTable('SELECT * FROM users WHERE id = 1'), 'users');
});

test('table extraction: INSERT INTO jobs', () => {
  assert.equal(queryMetrics.extractTable('INSERT INTO jobs (title) VALUES (?)'), 'jobs');
});

test('table extraction: UPDATE users', () => {
  assert.equal(queryMetrics.extractTable('UPDATE users SET nickname = ?'), 'users');
});

test('table extraction: DELETE FROM jobs', () => {
  assert.equal(queryMetrics.extractTable('DELETE FROM jobs WHERE id = ?'), 'jobs');
});

test('table fallback: complex query → unknown', () => {
  assert.equal(queryMetrics.extractTable('WITH cte AS (SELECT 1) SELECT * FROM cte'), 'unknown');
  assert.equal(queryMetrics.extractTable(''), 'unknown');
  assert.equal(queryMetrics.extractTable('SELECT 1'), 'unknown');
});

test('ring buffer eviction at 500 entries', () => {
  reset();
  for (let i = 0; i < 510; i += 1) {
    queryMetrics.recordQuery({ sql: `SELECT ${i}`, durationMs: 300, operation: 'select', table: 't' });
  }
  const all = queryMetrics._bufferForTests();
  assert.equal(all.length, 500, 'ring should cap at 500');
  assert.ok(all[0].sql.includes('10'), 'oldest should be 10 (after evicting 0..9)');
});

test('getRecentSlowQueries filters by sinceMs', () => {
  reset();
  queryMetrics.recordQuery({ sql: 'SELECT 1', durationMs: 250, operation: 'select', table: 'a' });
  queryMetrics.recordQuery({ sql: 'SELECT 2', durationMs: 260, operation: 'select', table: 'b' });
  const recent = queryMetrics.getRecentSlowQueries({ limit: 50, sinceMs: 24 * 60 * 60 * 1000 });
  assert.equal(recent.length, 2);
  // sinceMs 0 still returns all (everything is "since now")
  const zeroWindow = queryMetrics.getRecentSlowQueries({ limit: 50, sinceMs: 0 });
  assert.equal(zeroWindow.length, 2);
});

test('getStats aggregates by table', () => {
  reset();
  queryMetrics.recordQuery({ sql: 'SELECT 1', durationMs: 250, operation: 'select', table: 'users' });
  queryMetrics.recordQuery({ sql: 'SELECT 2', durationMs: 300, operation: 'select', table: 'users' });
  queryMetrics.recordQuery({ sql: 'SELECT 3', durationMs: 400, operation: 'select', table: 'jobs' });
  queryMetrics.recordQuery({ sql: 'SELECT 4', durationMs: 5, operation: 'select', table: 'orders' });
  const s = queryMetrics.getStats();
  assert.equal(s.byTable.users, 2);
  assert.equal(s.byTable.jobs, 1);
  assert.equal(s.byTable.orders, undefined, 'fast queries not counted');
  assert.equal(s.slowCount, 3);
  assert.equal(s.totalTracked, 4);
});

test('skips admin queries (SET/SHOW/USE/START TRANSACTION/COMMIT)', () => {
  reset();
  queryMetrics.recordQuery({ sql: 'SET autocommit=0', durationMs: 500, operation: 'set', table: 'unknown' });
  queryMetrics.recordQuery({ sql: 'SHOW TABLES', durationMs: 500, operation: 'show', table: 'unknown' });
  queryMetrics.recordQuery({ sql: 'USE mydb', durationMs: 500, operation: 'use', table: 'unknown' });
  queryMetrics.recordQuery({ sql: 'START TRANSACTION', durationMs: 500, operation: 'start', table: 'unknown' });
  queryMetrics.recordQuery({ sql: 'COMMIT', durationMs: 500, operation: 'commit', table: 'unknown' });
  const s = queryMetrics.getStats();
  assert.equal(s.totalTracked, 0, 'admin queries must not enter buffer');
});

test('sql is truncated to 200 chars in buffer', () => {
  reset();
  const huge = 'SELECT * FROM users WHERE x = "' + 'a'.repeat(500) + '"';
  queryMetrics.recordQuery({ sql: huge, durationMs: 300, operation: 'select', table: 'users' });
  const buf = queryMetrics._bufferForTests();
  assert.ok(buf[0].sql.length <= 200, `sql should be truncated, got ${buf[0].sql.length}`);
});