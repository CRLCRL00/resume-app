/**
 * Round 40 — alert dedupe (multi-pod leader gate) tests.
 *
 * Verifies that alertRouter.evaluateAndNotify / forceNotify gate dispatch
 * on the canDispatch() verdict:
 *   - leader=true  → send happens, sent counter increments
 *   - leader=false → send skipped, skipped_not_leader counter increments
 *   - override switch mid-call → next call respects new verdict
 *   - dispatch failure → next call still works (no crash, no permanent block)
 *
 * Uses __setCanDispatchForTests so we don't need real Redis leader state.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.npm_lifecycle_event = 'test';

const TEST_WEBHOOK = 'https://hooks.slack.test/services/TXXX/BXXX/xxx';
process.env.SLACK_WEBHOOK_URL = TEST_WEBHOOK;
process.env.SLACK_DEFAULT_CHANNEL = '#test-alerts';

const alertRouter = require('../src/services/alertRouter');
const metricsModule = require('../src/routes/metrics');

function installFetchStub(responseFactory) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return responseFactory(url, init);
  };
  return {
    calls,
    restore() {
      delete globalThis.fetch;
    },
  };
}

async function counterValue(name, labels) {
  const counter = metricsModule.alertDispatchTotal;
  const snap = await counter.get();
  for (const v of snap.values) {
    const ok = Object.entries(labels).every(([k, val]) => v.labels?.[k] === val);
    if (ok && v.labels?.result === name) return Number(v.value) || 0;
  }
  return 0;
}

test.afterEach(() => {
  alertRouter.__resetCanDispatchForTests();
  // Clean dedupe keys so order doesn't matter.
  // Use raw redis; tolerate failure.
  try {
    const redis = require('../src/config/redis');
    redis.del('alert:notify:DedupeTestA').catch(() => {});
    redis.del('alert:notify:DedupeTestB').catch(() => {});
  } catch (_e) { /* noop */ }
});

// ---- 1: leader=true → sendAlert is invoked + sent counter increments ----
test('leader=true → Slack webhook called + sent counter incremented', async () => {
  alertRouter.__setCanDispatchForTests(async () => true);
  const before = await counterValue('sent', { role: 'alert' });
  const stub = installFetchStub(async () => ({ ok: true, status: 200 }));
  try {
    const r = await alertRouter.evaluateAndNotify({
      fired: [{
        name: 'DedupeTestA',
        severity: 'warning',
        value: 1,
        threshold: 1,
        summary: 'dedupe test A',
      }],
    });
    assert.equal(stub.calls.length, 1, 'fetch should be called once');
    assert.equal(r.notified.length, 1);
    assert.equal(r.skipped.length, 0);
    const after = await counterValue('sent', { role: 'alert' });
    assert.ok(after >= before + 1, `sent counter should increment (was ${before}, now ${after})`);
  } finally {
    stub.restore();
  }
});

// ---- 2: leader=false → send NOT called + skipped_not_leader counter increments ----
test('leader=false → Slack NOT called + skipped_not_leader counter incremented', async () => {
  alertRouter.__setCanDispatchForTests(async () => false);
  const before = await counterValue('skipped_not_leader', { role: 'alert' });
  const stub = installFetchStub(async () => ({ ok: true, status: 200 }));
  try {
    const r = await alertRouter.evaluateAndNotify({
      fired: [{
        name: 'DedupeTestB',
        severity: 'critical',
        value: 99,
        threshold: 10,
        summary: 'dedupe test B',
      }, {
        name: 'DedupeTestA',
        severity: 'warning',
        value: 1,
        threshold: 1,
        summary: 'dedupe test A',
      }],
    });
    assert.equal(stub.calls.length, 0, 'fetch must NOT be called when not leader');
    assert.equal(r.notified.length, 0);
    assert.equal(r.skipped.length, 2);
    for (const s of r.skipped) {
      assert.equal(s.reason, 'not_leader');
    }
    const after = await counterValue('skipped_not_leader', { role: 'alert' });
    assert.ok(after >= before + 1, `skipped counter should increment (was ${before}, now ${after})`);
  } finally {
    stub.restore();
  }
});

// ---- 3: leader switch mid-stream → next call honors new verdict ----
test('leader switch: false → true → second call dispatches', async () => {
  let verdict = false;
  alertRouter.__setCanDispatchForTests(async () => verdict);

  const stub = installFetchStub(async () => ({ ok: true, status: 200 }));
  try {
    // First call: not leader, no dispatch.
    const r1 = await alertRouter.evaluateAndNotify({
      fired: [{ name: 'DedupeTestA', severity: 'warning', value: 1, threshold: 1, summary: 'a' }],
    });
    assert.equal(stub.calls.length, 0);
    assert.equal(r1.skipped[0].reason, 'not_leader');

    // Switch leader to this pod.
    verdict = true;

    // Second call: dispatches. Different alert name to avoid dedupe.
    const r2 = await alertRouter.evaluateAndNotify({
      fired: [{ name: 'DedupeTestB', severity: 'warning', value: 1, threshold: 1, summary: 'b' }],
    });
    assert.equal(stub.calls.length, 1, 'second call should dispatch');
    assert.equal(r2.notified.length, 1);
    assert.equal(r2.notified[0].name, 'DedupeTestB');
  } finally {
    stub.restore();
  }
});

// ---- 4: dispatch failure does not break subsequent calls ----
test('Slack failure → failed counter + next call still works', async () => {
  alertRouter.__setCanDispatchForTests(async () => true);
  const before = await counterValue('failed', { role: 'alert' });

  // First call: Slack returns 500 → should count as failed, NOT crash.
  const failingStub = installFetchStub(async () => ({
    ok: false, status: 500, statusText: 'Internal Server Error',
  }));
  try {
    const r1 = await alertRouter.evaluateAndNotify({
      fired: [{ name: 'DedupeTestA', severity: 'warning', value: 1, threshold: 1, summary: 'a' }],
    });
    assert.equal(r1.notified.length, 0);
    assert.equal(r1.errors.length, 1);
    failingStub.restore();

    // Second call: Slack succeeds — must still work (no permanent block).
    const okStub = installFetchStub(async () => ({ ok: true, status: 200 }));
    try {
      const r2 = await alertRouter.evaluateAndNotify({
        fired: [{ name: 'DedupeTestB', severity: 'warning', value: 1, threshold: 1, summary: 'b' }],
      });
      assert.equal(r2.notified.length, 1, 'next call must still dispatch');
    } finally {
      okStub.restore();
    }

    const after = await counterValue('failed', { role: 'alert' });
    assert.ok(after >= before + 1, `failed counter should increment (was ${before}, now ${after})`);
  } finally {
    // failingStub already restored; double-restore is safe (idempotent).
    failingStub.restore();
  }
});