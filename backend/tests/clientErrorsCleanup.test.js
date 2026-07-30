const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getPool, cleanup } = require('./helpers/db');
const { runClientErrorsCleanup } = require('../src/jobs/clientErrorsCleanup');
const { summarizeClientErrors } = require('../src/services/clientErrorsAgg');

const pool = getPool();

// 用唯一 openid 让并发跑/重跑不会污染
const TAG = `cleanup_test_${Date.now()}_${process.pid}`;

async function seed(opts) {
  // opts: { daysAgo, errorType, platform }
  const openid = `${TAG}_${Math.random().toString(36).slice(2, 10)}`;
  const daysAgo = opts.daysAgo;
  const errorType = opts.errorType || 'app_onerror';
  const platform = opts.platform || 'devtools';
  await pool.query(
    `INSERT INTO client_errors (openid, error_type, platform, message, created_at)
     VALUES (?, ?, ?, 'seed-msg', NOW() - INTERVAL ? DAY)`,
    [openid, errorType, platform, daysAgo],
  );
  return openid;
}

async function countForOpenid(openid) {
  const [rows] = await pool.query(
    'SELECT COUNT(*) AS cnt FROM client_errors WHERE openid = ?',
    [openid],
  );
  return Number(rows[0].cnt);
}

async function cleanupTag() {
  await pool.query('DELETE FROM client_errors WHERE openid LIKE ?', [`${TAG}%`]);
}

test.after(async () => {
  await cleanupTag();
  await cleanup();
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 1: default retention=7 → 8d/10d 旧行被删，0d/3d 新行保留
// ──────────────────────────────────────────────────────────────────────────────
test('cleanup: retentionDays=7 deletes old rows, keeps recent', async () => {
  await cleanupTag();
  const old1 = await seed({ daysAgo: 8 });
  const old2 = await seed({ daysAgo: 10 });
  const keep1 = await seed({ daysAgo: 3 });
  const keep2 = await seed({ daysAgo: 0 });

  assert.equal(await countForOpenid(old1), 1);
  assert.equal(await countForOpenid(old2), 1);
  assert.equal(await countForOpenid(keep1), 1);
  assert.equal(await countForOpenid(keep2), 1);

  const result = await runClientErrorsCleanup({ retentionDays: 7 });
  assert.ok(result.deleted >= 2, `expected >=2 deletions, got ${result.deleted}`);
  assert.ok(result.batches >= 1, 'expected >=1 batch');
  assert.equal(result.retentionDays, 7);
  assert.ok(typeof result.durationMs === 'number');

  assert.equal(await countForOpenid(old1), 0, '8d-old row should be deleted');
  assert.equal(await countForOpenid(old2), 0, '10d-old row should be deleted');
  assert.equal(await countForOpenid(keep1), 1, '3d row should be kept');
  assert.equal(await countForOpenid(keep2), 1, 'today row should be kept');
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 2: 幂等 — 第二次跑删除 0 行（相对前一轮被影响的行）
// ──────────────────────────────────────────────────────────────────────────────
test('cleanup: idempotent — second invocation deletes 0', async () => {
  await cleanupTag();
  await seed({ daysAgo: 30 });
  await seed({ daysAgo: 30 });
  await seed({ daysAgo: 30 });

  const first = await runClientErrorsCleanup({ retentionDays: 7 });
  assert.ok(first.deleted >= 3, `expected >=3 first-run deletes, got ${first.deleted}`);

  const second = await runClientErrorsCleanup({ retentionDays: 7 });
  assert.equal(second.deleted, 0, `second run must delete 0, got ${second.deleted}`);
  assert.equal(second.batches, 1);
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 3: custom retentionDays=2 → 8d/3d 都被删（<2d 保留）
// ──────────────────────────────────────────────────────────────────────────────
test('cleanup: retentionDays=2 deletes all rows older than 2 days', async () => {
  await cleanupTag();
  const old1 = await seed({ daysAgo: 8 });
  const old2 = await seed({ daysAgo: 3 });
  const keep = await seed({ daysAgo: 1 });

  const result = await runClientErrorsCleanup({ retentionDays: 2 });
  assert.ok(result.deleted >= 2, `expected >=2 deletes, got ${result.deleted}`);

  assert.equal(await countForOpenid(old1), 0, '8d row deleted');
  assert.equal(await countForOpenid(old2), 0, '3d row deleted (< 2 day threshold)');
  assert.equal(await countForOpenid(keep), 1, '1d row kept');
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 4: batchSize=1 → 多个 batch 报告
// ──────────────────────────────────────────────────────────────────────────────
test('cleanup: batchSize=1 produces multiple batches', async () => {
  await cleanupTag();
  // Seed 5 old rows, batchSize=1 → expect at least 5 batches
  for (let i = 0; i < 5; i++) {
    await seed({ daysAgo: 30 });
  }

  const result = await runClientErrorsCleanup({ retentionDays: 7, batchSize: 1 });
  assert.ok(result.deleted >= 5, `expected >=5 deletes, got ${result.deleted}`);
  assert.ok(result.batches >= 5, `expected >=5 batches, got ${result.batches}`);
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 5: summarizeClientErrors — 按 error_type 聚合
// ──────────────────────────────────────────────────────────────────────────────
test('summarizeClientErrors: aggregates by error_type within window', async () => {
  await cleanupTag();
  // 3 app_onerror + 2 wx_onerror → 在 24h 窗口里
  await seed({ daysAgo: 0, errorType: 'app_onerror', platform: 'devtools' });
  await seed({ daysAgo: 0, errorType: 'app_onerror', platform: 'wechat' });
  await seed({ daysAgo: 0, errorType: 'app_onerror', platform: 'devtools' });
  await seed({ daysAgo: 0, errorType: 'wx_onerror', platform: 'wechat' });
  await seed({ daysAgo: 0, errorType: 'wx_onerror', platform: 'wechat' });

  const summary = await summarizeClientErrors({ windowHours: 24 });
  assert.ok(summary.total >= 5, `expected total >= 5, got ${summary.total}`);
  assert.ok((summary.byType.app_onerror || 0) >= 3, `byType.app_onerror expected >=3, got ${summary.byType.app_onerror}`);
  assert.ok((summary.byType.wx_onerror || 0) >= 2, `byType.wx_onerror expected >=2, got ${summary.byType.wx_onerror}`);
  assert.ok((summary.byPlatform.wechat || 0) >= 3, `byPlatform.wechat expected >=3, got ${summary.byPlatform.wechat}`);
  assert.ok((summary.byPlatform.devtools || 0) >= 2, `byPlatform.devtools expected >=2, got ${summary.byPlatform.devtools}`);
  assert.ok(summary.lastErrorAt, 'lastErrorAt should be a date');
  assert.equal(summary.windowHours, 24);
});