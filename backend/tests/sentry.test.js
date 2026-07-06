const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const SENTRY_MODULE_PATH = path.resolve(__dirname, '..', 'src', 'sentry.js');

// Test 1: when SENTRY_DSN unset, initSentry returns false
test('sentry.initSentry returns false when SENTRY_DSN is unset', () => {
  // Force-reload module with SENTRY_DSN cleared
  delete process.env.SENTRY_DSN;
  delete require.cache[SENTRY_MODULE_PATH];
  const sentry = require('../src/sentry');
  const result = sentry.initSentry();
  assert.equal(result, false);
  assert.equal(sentry.isInitialized(), false);
});

// Test 2: when SENTRY_DSN set, initSentry returns true and isInitialized() true
test('sentry.initSentry returns true when SENTRY_DSN is set', () => {
  process.env.SENTRY_DSN = 'https://fake@fake.ingest.sentry.io/123456';
  delete require.cache[SENTRY_MODULE_PATH];
  const sentry = require('../src/sentry');
  const result = sentry.initSentry();
  assert.equal(result, true);
  assert.equal(sentry.isInitialized(), true);
  // cleanup so subsequent tests are deterministic
  delete process.env.SENTRY_DSN;
  // Reset module state (initSentry has internal `initialized` flag).
  // We can't easily reset the module without re-requiring, but the
  // testCapture hook in tests below is what matters for correctness.
});

// Test 3: /api/internal/sentry-debug 503 when Sentry not initialized
test('POST /api/internal/sentry-debug returns 503 when Sentry not initialized', async () => {
  // Re-require with no DSN and no test capture
  delete process.env.SENTRY_DSN;
  delete require.cache[SENTRY_MODULE_PATH];
  delete require.cache[path.resolve(__dirname, '..', 'src', 'config', 'index.js')];
  delete require.cache[path.resolve(__dirname, '..', 'src', 'app.js')];
  delete require.cache[path.resolve(__dirname, '..', 'src', 'routes', 'sentryDebug.js')];
  const request = require('supertest');
  const { createApp } = require('../src/app');
  const sentry = require('../src/sentry');
  // Make sure no test stub leaks from a previous test
  sentry.setTestCapture(null);
  // Verify not initialized (config re-evaluated with empty DSN)
  assert.equal(sentry.isInitialized(), false);

  const r = await request(createApp())
    .post('/api/internal/sentry-debug')
    .send({ message: 'hello', level: 'info' });
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 0);
  assert.equal(r.body.data.sentry, false);
  assert.match(r.body.data.hint, /SENTRY_DSN/);
});

// Test 4: /api/internal/sentry-debug 200 when initialized, test capture stub records the call
test('POST /api/internal/sentry-debug returns 200 + eventId when initialized', async () => {
  // Re-require with DSN set
  process.env.SENTRY_DSN = 'https://fake@fake.ingest.sentry.io/123456';
  delete require.cache[SENTRY_MODULE_PATH];
  delete require.cache[path.resolve(__dirname, '..', 'src', 'config', 'index.js')];
  delete require.cache[path.resolve(__dirname, '..', 'src', 'app.js')];
  delete require.cache[path.resolve(__dirname, '..', 'src', 'routes', 'sentryDebug.js')];
  const request = require('supertest');
  const { createApp } = require('../src/app');
  const sentry = require('../src/sentry');

  // Inject test capture BEFORE calling initSentry so the real Sentry is bypassed
  const calls = [];
  sentry.setTestCapture((message, level, extra) => {
    calls.push({ message, level, extra });
    return 'fake-event-id-abc123';
  });
  const ok = sentry.initSentry();
  assert.equal(ok, true);

  const r = await request(createApp())
    .post('/api/internal/sentry-debug')
    .send({ message: 'integration test ping', level: 'warning' });
  assert.equal(r.status, 200);
  assert.equal(r.body.code, 0);
  assert.equal(r.body.data.sentry, true);
  assert.equal(r.body.data.eventId, 'fake-event-id-abc123');
  assert.equal(r.body.data.level, 'warning');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].message, 'integration test ping');
  assert.equal(calls[0].level, 'warning');

  // Cleanup
  sentry.setTestCapture(null);
  delete process.env.SENTRY_DSN;
});