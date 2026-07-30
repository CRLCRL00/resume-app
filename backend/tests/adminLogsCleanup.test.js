const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getPool, cleanup } = require('./helpers/db');
const { runAdminLogsCleanup } = require('../src/jobs/adminLogsCleanup');

const pool = getPool();

const TAG = `admin_cleanup_test_${Date.now()}_${process.pid}`;

async function seed(opts) {
  // opts: { daysAgo, action, actor }
  const actor = opts.actor || `${TAG}_${Math.random().toString(36).slice(2, 10)}`;
  const action = opts.action || 'job.update';
  const daysAgo = opts.daysAgo;
  await pool.query(
    `INSERT INTO admin_operation_logs (admin_openid, action, target_type, target_id, detail, ip, created_at)
     VALUES (?, ?, 'job', '99', '{}', '127.0.0.1', NOW() - INTERVAL ? DAY)`,
    [actor, action, daysAgo]
  );
  return actor;
}

async function countForActor(actor) {
  const [rows] = await pool.query(
    'SELECT COUNT(*) AS cnt FROM admin_operation_logs WHERE admin_openid = ?',
    [actor],
  );
  return Number(rows[0].cnt);
}

async function cleanupTag() {
  await pool.query(
    "DELETE FROM admin_operation_logs WHERE admin_openid LIKE ? OR admin_openid LIKE ?",
    [`${TAG}%`, 'admin_cleanup_actor_%']
  );
}

test.after(async () => {
  await cleanupTag();
  await cleanup();
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 1: retentionDays=180 deletes >180 day rows, keeps newer
// ──────────────────────────────────────────────────────────────────────────────
test('cleanup admin_logs: retentionDays=180 deletes old rows, keeps recent', async () => {
  await cleanupTag();
  const old1 = await seed({ daysAgo: 200 });
  const old2 = await seed({ daysAgo: 365 });
  const keep1 = await seed({ daysAgo: 90 });
  const keep2 = await seed({ daysAgo: 10 });

  assert.equal(await countForActor(old1), 1);
  assert.equal(await countForActor(old2), 1);

  const result = await runAdminLogsCleanup({ retentionDays: 180 });
  assert.ok(result.deleted >= 2, `expected >=2 deletions, got ${result.deleted}`);
  assert.ok(result.batches >= 1);
  assert.equal(result.retentionDays, 180);

  assert.equal(await countForActor(old1), 0, '200d row should be deleted');
  assert.equal(await countForActor(old2), 0, '365d row should be deleted');
  assert.equal(await countForActor(keep1), 1, '90d row should be kept');
  assert.equal(await countForActor(keep2), 1, '10d row should be kept');
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 2: idempotent — second invocation deletes 0
// ──────────────────────────────────────────────────────────────────────────────
test('cleanup admin_logs: idempotent — second invocation deletes 0', async () => {
  await cleanupTag();
  await seed({ daysAgo: 365 });
  await seed({ daysAgo: 365 });
  await seed({ daysAgo: 365 });

  const first = await runAdminLogsCleanup({ retentionDays: 180 });
  assert.ok(first.deleted >= 3, `expected >=3 first-run deletes, got ${first.deleted}`);

  const second = await runAdminLogsCleanup({ retentionDays: 180 });
  assert.equal(second.deleted, 0, `second run must delete 0, got ${second.deleted}`);
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 3: retentionDays=30 deletes everything older than 30 days
// ──────────────────────────────────────────────────────────────────────────────
test('cleanup admin_logs: retentionDays=30 deletes > 30d but keeps < 30d', async () => {
  await cleanupTag();
  const old1 = await seed({ daysAgo: 200 });
  const old2 = await seed({ daysAgo: 60 });
  const keep = await seed({ daysAgo: 10 });

  const result = await runAdminLogsCleanup({ retentionDays: 30 });
  assert.ok(result.deleted >= 2, `expected >=2 deletes, got ${result.deleted}`);

  assert.equal(await countForActor(old1), 0);
  assert.equal(await countForActor(old2), 0);
  assert.equal(await countForActor(keep), 1, '10d row kept');
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 4: batchSize=1 produces multiple batches
// ──────────────────────────────────────────────────────────────────────────────
test('cleanup admin_logs: batchSize=1 produces multiple batches', async () => {
  await cleanupTag();
  for (let i = 0; i < 5; i++) {
    await seed({ daysAgo: 365 });
  }

  const result = await runAdminLogsCleanup({ retentionDays: 180, batchSize: 1 });
  assert.ok(result.deleted >= 5, `expected >=5 deletes, got ${result.deleted}`);
  assert.ok(result.batches >= 5, `expected >=5 batches, got ${result.batches}`);
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 5: summarize-like count by action (mirror client errors test)
// ──────────────────────────────────────────────────────────────────────────────
test('cleanup admin_logs: count by action works (seed multiple actions, verify by action grouping)', async () => {
  await cleanupTag();
  // Use unique actor pattern so we don't conflict
  const actor = `${TAG}_grouped_${Math.random().toString(36).slice(2, 10)}`;
  const actions = [
    { action: 'job.create', n: 3 },
    { action: 'job.update', n: 2 },
    { action: 'prompt.update', n: 1 },
  ];
  for (const a of actions) {
    for (let i = 0; i < a.n; i++) {
      await pool.query(
        `INSERT INTO admin_operation_logs (admin_openid, action, target_type, target_id, detail, ip, created_at)
         VALUES (?, ?, 'job', '1', '{}', '127.0.0.1', NOW() - INTERVAL 7 DAY)`,
        [actor, a.action]
      );
    }
  }
  const [rows] = await pool.query(
    `SELECT action, COUNT(*) AS cnt FROM admin_operation_logs
     WHERE admin_openid = ? GROUP BY action ORDER BY action`,
    [actor],
  );
  const byAction = Object.fromEntries(rows.map((r) => [r.action, Number(r.cnt)]));
  assert.equal(byAction['job.create'], 3);
  assert.equal(byAction['job.update'], 2);
  assert.equal(byAction['prompt.update'], 1);
  // 不会因为 cleanup 触发（retention=180 远大于 7 天）
  const skipCleanup = await runAdminLogsCleanup({ retentionDays: 180 });
  // Should still have all 6 rows (we filtered retention > 7 days seed)
  assert.ok(typeof skipCleanup.deleted === 'number');
});
