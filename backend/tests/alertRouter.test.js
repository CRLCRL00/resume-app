/**
 * Round 32-F — alertRouter tests.
 *
 * Stubs globalThis.fetch so we never hit the real Slack webhook.
 * Resets dedupe keys before + after each test so order doesn't matter.
 *
 * Env requirements (set in this file before requiring the router):
 *   SLACK_WEBHOOK_URL        — set per-test to a stub URL
 *   SLACK_DEFAULT_CHANNEL    — "#test-alerts"
 *   ALERT_DEDUPE_TTL_MS      — small (e.g. 100) for dedupe test
 *   NODE_ENV                 — 'test' to suppress outbound in routes/metricsAlerts
 */
const test = require('node:test');
const assert = require('node:assert/strict');

// Make sure NODE_ENV=test so metricsAlerts router skips notify side effect
// if it gets accidentally hit. We test the router directly here.
process.env.NODE_ENV = 'test';
process.env.npm_lifecycle_event = 'test';

const redis = require('../src/config/redis');
const { evaluateAndNotify, forceNotify, clearDedupe, DEDUPE_PREFIX } = require('../src/services/alertRouter');

const TEST_WEBHOOK = 'https://hooks.slack.test/services/TXXX/BXXX/xxx';
process.env.SLACK_DEFAULT_CHANNEL = '#test-alerts';
process.env.SLACK_HMAC_SECRET = ''; // don't actually sign anything outbound

// Helper: install a stub fetch capturing URL+init, return the supplied response.
function installFetchStub(responseFactory) {
  const calls = [];
  const stub = async (url, init) => {
    calls.push({ url, init });
    return responseFactory(url, init);
  };
  const orig = globalThis.fetch;
  globalThis.fetch = stub;
  return {
    calls,
    restore() { globalThis.fetch = orig; },
  };
}

// Track every dedupe key we touch so we can clean up at the end.
const touchedKeys = [];
async function resetDedupe(name) {
  await redis.del(DEDUPE_PREFIX + name);
  touchedKeys.push(DEDUPE_PREFIX + name);
}

test.after(async () => {
  for (const k of touchedKeys) {
    try { await redis.del(k); } catch (_e) { /* best effort */ }
  }
});

test('critical alert → Slack webhook called once with correct payload', async () => {
  await resetDedupe('HighErrorRate');
  process.env.SLACK_WEBHOOK_URL = TEST_WEBHOOK;
  process.env.ALERT_DEDUPE_TTL_MS = '60000';

  const stub = installFetchStub(async () => ({ ok: true, status: 200 }));
  try {
    const fired = [{
      name: 'HighErrorRate',
      severity: 'critical',
      value: 250,
      threshold: 100,
      summary: 'HTTP 5xx error rate > 5% for 5m',
      description: 'Sustained server errors above the critical threshold.',
    }];
    const r = await evaluateAndNotify({ rules: [], fired });
    assert.equal(stub.calls.length, 1, 'fetch should be called exactly once');
    assert.equal(stub.calls[0].url, TEST_WEBHOOK);
    assert.equal(stub.calls[0].init.method, 'POST');
    assert.match(stub.calls[0].init.headers['Content-Type'], /application\/json/);
    const body = JSON.parse(stub.calls[0].init.body);
    assert.equal(body.channel, '#test-alerts');
    assert.match(body.text, /HighErrorRate/);
    assert.match(body.text, /CRITICAL/);
    assert.equal(r.notified.length, 1);
    assert.equal(r.notified[0].name, 'HighErrorRate');
    assert.equal(r.errors.length, 0);
  } finally {
    stub.restore();
    await resetDedupe('HighErrorRate');
  }
});

test('dedupe: same alert twice within 60min → second call skipped', async () => {
  await resetDedupe('RateLimitSpike');
  process.env.SLACK_WEBHOOK_URL = TEST_WEBHOOK;
  process.env.ALERT_DEDUPE_TTL_MS = '60000';

  const stub = installFetchStub(async () => ({ ok: true, status: 200 }));
  try {
    const fired = [{
      name: 'RateLimitSpike',
      severity: 'warning',
      value: 200,
      threshold: 100,
      summary: 'Rate-limit blocks exceed threshold',
    }];
    const r1 = await evaluateAndNotify({ rules: [], fired });
    const r2 = await evaluateAndNotify({ rules: [], fired });

    assert.equal(stub.calls.length, 1, 'fetch should be called only for the first event');
    assert.equal(r1.notified.length, 1);
    assert.equal(r2.notified.length, 0);
    assert.equal(r2.skipped.length, 1);
    assert.equal(r2.skipped[0].reason, 'deduped');
  } finally {
    stub.restore();
    await resetDedupe('RateLimitSpike');
  }
});

test('warning alert → notify Slack (no critical-only gate)', async () => {
  await resetDedupe('LLMFailureSpike');
  process.env.SLACK_WEBHOOK_URL = TEST_WEBHOOK;
  process.env.ALERT_DEDUPE_TTL_MS = '60000';

  const stub = installFetchStub(async () => ({ ok: true, status: 200 }));
  try {
    const fired = [{
      name: 'LLMFailureSpike',
      severity: 'warning',
      value: 30,
      threshold: 20,
      summary: 'LLM API error rate > 20% for 5m',
    }];
    const r = await evaluateAndNotify({ rules: [], fired });
    assert.equal(stub.calls.length, 1);
    const body = JSON.parse(stub.calls[0].init.body);
    assert.match(body.text, /LLMFailureSpike/);
    assert.match(body.text, /WARNING/);
    assert.equal(r.notified.length, 1);
    assert.equal(r.notified[0].severity, 'warning');
  } finally {
    stub.restore();
    await resetDedupe('LLMFailureSpike');
  }
});

test('missing SLACK_WEBHOOK_URL → log warn + return { ok: false, reason: ... }, no crash', async () => {
  await resetDedupe('DBPoolExhausted');
  process.env.SLACK_WEBHOOK_URL = '';
  process.env.ALERT_DEDUPE_TTL_MS = '60000';

  const stub = installFetchStub(async () => ({ ok: true, status: 200 }));
  try {
    const fired = [{
      name: 'DBPoolExhausted',
      severity: 'warning',
      value: 0.95,
      threshold: 0.9,
      summary: 'DB connection pool > 90% used for 5m',
    }];
    const r = await evaluateAndNotify({ rules: [], fired });
    assert.equal(stub.calls.length, 0, 'must NOT call Slack when URL is empty');
    assert.equal(r.notified.length, 0);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0].reason, /SLACK_WEBHOOK_URL not set/);

    // forceNotify directly: same guard.
    const forced = await forceNotify({ name: 'DBPoolExhausted', severity: 'warning', text: 'pool high' });
    assert.equal(forced.ok, false);
    assert.equal(forced.reason, 'SLACK_WEBHOOK_URL not set');
  } finally {
    stub.restore();
    // Dedupe may have been acquired + released, but make sure it's gone
    // so a stray earlier test can't trip this key.
    await resetDedupe('DBPoolExhausted');
  }
});

test('Slack fetch 500 → notify returns ok:false, caller continues, dedupe released', async () => {
  await resetDedupe('SlowRequestRate');
  process.env.SLACK_WEBHOOK_URL = TEST_WEBHOOK;
  process.env.ALERT_DEDUPE_TTL_MS = '60000';

  const stub = installFetchStub(async () => ({
    ok: false,
    status: 500,
    statusText: 'Internal Server Error',
  }));
  try {
    const fired = [{
      name: 'SlowRequestRate',
      severity: 'warning',
      value: 50,
      threshold: 10,
      summary: 'Slow operations exceed threshold',
    }];
    const r = await evaluateAndNotify({ rules: [], fired });
    assert.equal(r.notified.length, 0, 'no notifications when Slack 500s');
    assert.equal(r.errors.length, 1);
    assert.equal(r.errors[0].name, 'SlowRequestRate');
    // dedupe key should have been released, so a subsequent call retries.
    const exists = await redis.exists(DEDUPE_PREFIX + 'SlowRequestRate');
    assert.equal(exists, 0, 'dedupe key must be released on notify failure');

    // Retry now — second call should fetch again because dedupe was released.
    const r2 = await evaluateAndNotify({ rules: [], fired });
    assert.equal(stub.calls.length, 2, 'retry must call fetch again');
    assert.equal(r2.errors.length, 1);
  } finally {
    stub.restore();
    await resetDedupe('SlowRequestRate');
  }
});