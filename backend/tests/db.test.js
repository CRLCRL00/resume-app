const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getPool, cleanup } = require('./helpers/db');
const pool = getPool();

test('db pool can query', async () => {
  const [rows] = await pool.query('SELECT 1 AS n');
  assert.equal(rows[0].n, 1);
});

test.after(async () => {
  await cleanup();
});