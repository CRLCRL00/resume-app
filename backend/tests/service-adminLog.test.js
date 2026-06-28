const { test } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/config/db');
const { record } = require('../src/services/adminLog');

test('record inserts log with all fields', async () => {
  await pool.query("DELETE FROM admin_operation_logs WHERE admin_openid = 'test_admin_log'");
  await record('test_admin_log', 'job.create', 'job', 99, { title: 'test' }, '127.0.0.1');
  const [rows] = await pool.query(
    "SELECT * FROM admin_operation_logs WHERE admin_openid = 'test_admin_log' ORDER BY id DESC LIMIT 1"
  );
  assert.equal(rows[0].action, 'job.create');
  assert.equal(rows[0].target_type, 'job');
  assert.equal(rows[0].target_id, '99');
  assert.equal(rows[0].detail.title, 'test');
  assert.equal(rows[0].ip, '127.0.0.1');
});

test('record handles null optional fields', async () => {
  await pool.query("DELETE FROM admin_operation_logs WHERE admin_openid = 'test_null'");
  await record('test_null', 'admin.login', null, null, null, null);
  const [rows] = await pool.query(
    "SELECT * FROM admin_operation_logs WHERE admin_openid = 'test_null' ORDER BY id DESC LIMIT 1"
  );
  assert.equal(rows[0].target_type, null);
  assert.equal(rows[0].target_id, null);
  assert.equal(rows[0].ip, null);
  assert.deepEqual(rows[0].detail, {});
});

test('record handles numeric target_id by stringifying', async () => {
  await pool.query("DELETE FROM admin_operation_logs WHERE admin_openid = 'test_num'");
  await record('test_num', 'job.delete', 'job', 12345, null, null);
  const [rows] = await pool.query(
    "SELECT target_id FROM admin_operation_logs WHERE admin_openid = 'test_num' ORDER BY id DESC LIMIT 1"
  );
  assert.equal(rows[0].target_id, '12345');
});

test.after(async () => {
  await pool.query("DELETE FROM admin_operation_logs WHERE admin_openid IN ('test_admin_log', 'test_null', 'test_num')");
  await pool.end();
});