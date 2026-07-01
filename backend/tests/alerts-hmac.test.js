const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const crypto = require('crypto');
const { createApp } = require('../src/app');

const ALERT_TOKEN = process.env.ALERT_TOKEN || 'dev-alert-token-change-me';

function signBody(body, ts) {
  return crypto.createHmac('sha256', ALERT_TOKEN)
    .update(body + ts)
    .digest('hex');
}

function mkAlert(extraHeaders = {}) {
  const ts = Date.now();
  const body = JSON.stringify({ timestamp: 'unit-test', http: 503 });
  const sig = signBody(body, ts);
  return {
    headers: {
      'Content-Type': 'application/json',
      'X-Alert-Token': ALERT_TOKEN,
      'X-Alert-Timestamp': String(ts),
      'X-Alert-Signature': 'sha256=' + sig,
      ...extraHeaders,
    },
    body,
  };
}

test('POST /api/internal/alert: missing token → 401', async () => {
  const r = await request(createApp()).post('/api/internal/alert').send({});
  assert.equal(r.status, 401);
});

test('POST /api/internal/alert: bad token → 401', async () => {
  const a = mkAlert({ 'X-Alert-Token': 'wrong-token' });
  const r = await request(createApp()).post('/api/internal/alert')
    .set(a.headers).set('Content-Length', Buffer.byteLength(a.body)).send(a.body);
  assert.equal(r.status, 401);
});

test('POST /api/internal/alert: skewed timestamp → 401', async () => {
  const a = mkAlert({ 'X-Alert-Timestamp': String(Date.now() - 10 * 60 * 1000) });
  const r = await request(createApp()).post('/api/internal/alert')
    .set(a.headers).send(a.body);
  assert.equal(r.status, 401);
});

test('POST /api/internal/alert: missing timestamp → 401', async () => {
  const a = mkAlert(); delete a.headers['X-Alert-Timestamp'];
  const r = await request(createApp()).post('/api/internal/alert')
    .set(a.headers).send(a.body);
  assert.equal(r.status, 401);
});

test('POST /api/internal/alert: bad signature → 401', async () => {
  const a = mkAlert({ 'X-Alert-Signature': 'sha256=0000000000000000000000000000000000000000000000000000000000000000' });
  const r = await request(createApp()).post('/api/internal/alert').set(a.headers).send(a.body);
  assert.equal(r.status, 401);
});

test('POST /api/internal/alert: tampered body → 401', async () => {
  const a = mkAlert();
  // 计算 signature for original body, then 改 body
  const r = await request(createApp()).post('/api/internal/alert')
    .set(a.headers).send('{"timestamp":"tampered","http":200}');
  assert.equal(r.status, 401);
});

test('POST /api/internal/alert: valid signature → 200 received', async () => {
  const a = mkAlert();
  const r = await request(createApp()).post('/api/internal/alert')
    .set(a.headers).send(a.body);
  assert.equal(r.status, 200);
  assert.equal(r.body.code, 0);
  assert.equal(r.body.data.received, true);
});

test('POST /api/internal/alert: signature without sha256= prefix → 401', async () => {
  const a = mkAlert();
  a.headers['X-Alert-Signature'] = a.headers['X-Alert-Signature'].replace('sha256=', '');
  const r = await request(createApp()).post('/api/internal/alert').set(a.headers).send(a.body);
  assert.equal(r.status, 401);
});
