const { test } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/config/db');

test('db pool can query', async () => {
  const [rows] = await pool.query('SELECT 1 AS n');
  assert.equal(rows[0].n, 1);
});

test.after(async () => {
  await pool.end();
});
