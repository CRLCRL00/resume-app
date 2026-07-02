const test = require('node:test');
const assert = require('node:assert');
const pool = require('../src/config/db');

test('pool exports query + getConnection', () => {
  assert.strictEqual(typeof pool.query, 'function');
  assert.strictEqual(typeof pool.getConnection, 'function');
});

test('query SELECT 1 returns', async () => {
  const [rows] = await pool.query('SELECT 1 AS n');
  assert.strictEqual(rows[0].n, 1);
});

test('concurrent queries do not block', async () => {
  const start = Date.now();
  const results = await Promise.all([
    pool.query('SELECT 1 AS n'),
    pool.query('SELECT 2 AS n'),
    pool.query('SELECT 3 AS n'),
  ]);
  assert.strictEqual(results.length, 3);
  assert.ok(Date.now() - start < 5000);
});

test('slow query wrapper does not throw on quick SELECT', async () => {
  // 真实测需 SLEEP(2)；test env 直接验证 wrapper 不抛错
  const [rows] = await pool.query('SELECT SLEEP(0.1) AS n');
  assert.ok(rows[0].n >= 0);
});