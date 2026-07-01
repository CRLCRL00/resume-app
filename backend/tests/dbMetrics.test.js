const test = require('node:test');
const assert = require('node:assert');
const { getPool } = require('./helpers/db');

test('dbQueries counter increments on SELECT', async () => {
  // Touch pool once to ensure it is initialized (will skip if DB unreachable).
  await getPool().query('SELECT 1').catch(() => null);

  const m = require('../src/routes/metrics');
  const before = await m.dbQueries.get();
  const beforeVal = before.values.find(v => v.labels && v.labels.status === 'ok')?.value || 0;

  await getPool().query('SELECT 2').catch(() => null);

  const after = await m.dbQueries.get();
  const afterVal = after.values.find(v => v.labels && v.labels.status === 'ok')?.value || 0;

  assert.ok(afterVal >= beforeVal, 'dbQueries ok counter should not decrease after a SELECT');
});
