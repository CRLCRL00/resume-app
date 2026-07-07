const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { createApp } = require('../src/app');

// Ensure no ALERT_TOKEN is set so routes are reachable for tests.
delete process.env.ALERT_TOKEN;

test('GET /api/internal/metrics/alerts/rules returns rule list (8 rules) + names', async () => {
  const app = createApp();
  const res = await request(app).get('/api/internal/metrics/alerts/rules');
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.code, 0);
  assert.ok(res.body.data);
  assert.strictEqual(res.body.data.count, 8);
  assert.ok(Array.isArray(res.body.data.names));
  assert.strictEqual(res.body.data.names.length, 8);
  // Spot-check that the rules we promised are present.
  const expectedNames = [
    'HighErrorRate',
    'ElevatedErrorRate',
    'RateLimitSpike',
    'RedisDown',
    'LLMFailureSpike',
    'DBPoolExhausted',
    'SlowRequestRate',
    'SlowQuerySpike',
  ];
  for (const n of expectedNames) {
    assert.ok(res.body.data.names.includes(n), `expected ${n} in ${JSON.stringify(res.body.data.names)}`);
  }
  assert.ok(res.body.data.rules.length === 8);
  assert.ok(res.body.data.thresholds);
});

test('GET /api/internal/metrics/alerts returns fired:[] + checked:8 initially', async () => {
  const app = createApp();
  const res = await request(app).get('/api/internal/metrics/alerts');
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.code, 0);
  assert.ok(res.body.data);
  assert.strictEqual(res.body.data.checked, 8);
  assert.ok(Array.isArray(res.body.data.fired));
  // On a fresh process no counters should trip thresholds; assert fired is empty.
  assert.deepStrictEqual(res.body.data.fired, []);
  assert.ok(res.body.data.generatedAt);
  assert.ok(res.body.data.thresholds);
});

test('RateLimitSpike fires after bumping blocked counter via require.cache', async (t) => {
  // Save original counter values for cleanup so we don't pollute other tests.
  // NOTE: we don't require('../src/middleware/slidingRateLimit') at top of
  // the file because that imports ../config/redis which connects at import
  // time and hangs in tests without Redis. Instead, create the counter
  // directly via globalThis guard — the metricsAlerts router falls back to
  // the same Counter instance.
  let counter = globalThis.__slidingRateLimitCounter;
  if (!counter) {
    const client = require('prom-client');
    counter = new client.Counter({
      name: 'sliding_rate_limit_decisions_total',
      help: 'Sliding window rate limit decisions',
      labelNames: ['name', 'decision'],
    });
    globalThis.__slidingRateLimitCounter = counter;
  }
  assert.ok(counter, 'expected globalThis.__slidingRateLimitCounter to exist');

  // Snapshot existing blocked counters (per name label).
  const snapBefore = await counter.get();
  const beforeByName = {};
  for (const v of snapBefore.values) {
    if (v.labels && v.labels.decision === 'blocked') {
      beforeByName[JSON.stringify(v.labels)] = Number(v.value) || 0;
    }
  }

  try {
    // Bump well above default threshold (100) — drop 200 blocked decisions.
    counter.inc({ name: 'auth-login', decision: 'blocked' }, 200);

    const app = createApp();
    const res = await request(app).get('/api/internal/metrics/alerts');
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.code, 0);
    const firedNames = res.body.data.fired.map((r) => r.name);
    assert.ok(
      firedNames.includes('RateLimitSpike'),
      `expected RateLimitSpike in fired[], got ${JSON.stringify(firedNames)}`
    );
    const rl = res.body.data.fired.find((r) => r.name === 'RateLimitSpike');
    assert.strictEqual(rl.severity, 'warning');
    assert.ok(typeof rl.value === 'number' && rl.value >= 100);
    assert.strictEqual(rl.threshold, 100);
  } finally {
    // Clean up: prom-client counters cannot be decremented below 0. We can
    // only safely remove labels that were *purely* introduced by this test
    // (i.e. they didn't exist in beforeByName). For pre-existing label-sets,
    // we leave the increment in place — that's the same pattern other tests
    // (e.g. metricsSummary) use and matches prom-client semantics.
    const snapAfter = await counter.get();
    for (const v of snapAfter.values) {
      if (v.labels && v.labels.decision === 'blocked'
          && v.labels.name === 'auth-login') {
        const key = JSON.stringify(v.labels);
        if (!(key in beforeByName)) {
          // Pure-test series — prom-client supports .remove(...labels) on
          // the metric itself to drop it entirely.
          try { counter.remove(v.labels); } catch (_e) {}
        }
        // else: it pre-existed; we don't touch it (cleanup is best-effort).
      }
    }
  }
});

// ---------------- SlowQuerySpike (Round 36) ----------------

const metricsModule = require('../src/routes/metrics');

test('SlowQuerySpike does not fire when db_slow_queries_total = 0 (default threshold 50)', async () => {
  // Defensive reset: drop any slow-query label-sets that may have been
  // touched by earlier tests in this process.
  const counter = metricsModule.dbSlowQueries;
  const snapBefore = await counter.get();
  for (const v of snapBefore.values) {
    try { counter.remove(v.labels); } catch (_e) {}
  }

  const app = createApp();
  const res = await request(app).get('/api/internal/metrics/alerts');
  assert.strictEqual(res.statusCode, 200);
  const firedNames = res.body.data.fired.map((r) => r.name);
  assert.ok(
    !firedNames.includes('SlowQuerySpike'),
    `expected SlowQuerySpike NOT in fired, got ${JSON.stringify(firedNames)}`
  );
  // Also confirm rule appears in /rules with default threshold 50
  const rulesRes = await request(app).get('/api/internal/metrics/alerts/rules');
  const sq = rulesRes.body.data.rules.find((r) => r.name === 'SlowQuerySpike');
  assert.ok(sq, 'expected SlowQuerySpike in /rules');
  assert.strictEqual(sq.severity, 'warning');
  assert.strictEqual(sq.thresholdDefault, 50);
});

test('SlowQuerySpike fires when db_slow_queries_total >= 51 (default threshold 50)', async () => {
  const counter = metricsModule.dbSlowQueries;
  // Snapshot for cleanup
  const snapBefore = await counter.get();
  const beforeLabels = new Set(snapBefore.values.map((v) => JSON.stringify(v.labels)));
  // Use one label set and bump it past threshold.
  try {
    counter.inc({ operation: 'select', table: 'jobs' }, 51);
    const app = createApp();
    const res = await request(app).get('/api/internal/metrics/alerts');
    const firedNames = res.body.data.fired.map((r) => r.name);
    assert.ok(
      firedNames.includes('SlowQuerySpike'),
      `expected SlowQuerySpike in fired, got ${JSON.stringify(firedNames)}`
    );
    const sq = res.body.data.fired.find((r) => r.name === 'SlowQuerySpike');
    assert.strictEqual(sq.severity, 'warning');
    assert.ok(sq.value >= 51, `expected value >= 51, got ${sq.value}`);
    assert.strictEqual(sq.threshold, 50);
  } finally {
    // Best-effort cleanup of label-sets we introduced.
    const snapAfter = await counter.get();
    for (const v of snapAfter.values) {
      if (!beforeLabels.has(JSON.stringify(v.labels))) {
        try { counter.remove(v.labels); } catch (_e) {}
      }
    }
  }
});

test('SlowQuerySpike honors custom ALERT_SLOW_QUERY_THRESHOLD=10', async () => {
  // Toggle env, drop require cache, re-require to force THRESHOLDS rebuild.
  process.env.ALERT_SLOW_QUERY_THRESHOLD = '10';
  delete require.cache[require.resolve('../src/routes/metricsAlerts')];
  const freshAlerts = require('../src/routes/metricsAlerts');
  // Smoke check: THRESHOLDS now has slowQueries = 10.
  assert.strictEqual(freshAlerts.THRESHOLDS.slowQueries, 10);
  // And the rule exists + reports thresholdDefault via RULES metadata.
  const sqRule = freshAlerts.RULES.find((r) => r.name === 'SlowQuerySpike');
  assert.ok(sqRule, 'expected SlowQuerySpike in RULES');
  assert.strictEqual(sqRule.thresholdKey, 'slowQueries');

  // Reset env + cache so later tests get default threshold again.
  delete process.env.ALERT_SLOW_QUERY_THRESHOLD;
  delete require.cache[require.resolve('../src/routes/metricsAlerts')];
});