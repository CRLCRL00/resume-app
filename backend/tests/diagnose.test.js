const test = require('node:test');
const assert = require('node:assert');
const { diagnose, REQUIRED_TABLES } = require('../src/db/diagnose');

test('REQUIRED_TABLES has expected entries', () => {
  assert.ok(Array.isArray(REQUIRED_TABLES));
  assert.ok(REQUIRED_TABLES.includes('users'));
  assert.ok(REQUIRED_TABLES.includes('admin_audit'));
  assert.ok(REQUIRED_TABLES.includes('schema_migrations'));
});

test('diagnose returns ok:true in test env (no-op)', async () => {
  const result = await diagnose();
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.warnings, []);
});