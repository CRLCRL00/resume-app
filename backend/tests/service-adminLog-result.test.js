const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getPool, cleanup } = require('./helpers/db');
const pool = getPool();
const { record } = require('../src/services/adminLog');

test('record accepts result=success and stores it', async () => {
  await pool.query("DELETE FROM admin_operation_logs WHERE admin_openid = 'test_result_success'");
  await record('test_result_success', 'job.create', 'job', 1, {}, '1.1.1.1', 'success');
  const [rows] = await pool.query(
    "SELECT result FROM admin_operation_logs WHERE admin_openid = 'test_result_success' ORDER BY id DESC LIMIT 1"
  );
  assert.equal(rows[0].result, 'success');
});

test('record accepts result=failure and stores it', async () => {
  await pool.query("DELETE FROM admin_operation_logs WHERE admin_openid = 'test_result_failure'");
  await record('test_result_failure', 'job.delete', 'job', 2, {}, null, 'failure');
  const [rows] = await pool.query(
    "SELECT result FROM admin_operation_logs WHERE admin_openid = 'test_result_failure' ORDER BY id DESC LIMIT 1"
  );
  assert.equal(rows[0].result, 'failure');
});

test('record defaults result=unknown when omitted (backward compat)', async () => {
  await pool.query("DELETE FROM admin_operation_logs WHERE admin_openid = 'test_result_unknown'");
  await record('test_result_unknown', 'admin.login', null, null, null, null);
  const [rows] = await pool.query(
    "SELECT result FROM admin_operation_logs WHERE admin_openid = 'test_result_unknown' ORDER BY id DESC LIMIT 1"
  );
  assert.equal(rows[0].result, 'unknown');
});

test.after(async () => {
  await pool.query(
    "DELETE FROM admin_operation_logs WHERE admin_openid IN ('test_result_success', 'test_result_failure', 'test_result_unknown')"
  );
  await cleanup();
});
