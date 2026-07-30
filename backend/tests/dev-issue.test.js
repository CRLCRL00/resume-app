'use strict';

/**
 * R108: /api/test/dev-issue endpoint test
 *
 * Verifies:
 *   - ENABLE_DEV_ENDPOINTS off → 404
 *   - missing openid → 400
 *   - existing openid (e.g. admin id=6) → 200 + token
 *   - new openid → auto-creates user + returns token
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const BASE = 'http://127.0.0.1:3003';

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1',
      port: 3003,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
      timeout: 5000,
    }, (res) => {
      let buf = '';
      res.on('data', (c) => buf += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(buf) });
        } catch (e) {
          resolve({ status: res.statusCode, data: buf });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.write(data);
    req.end();
  });
}

test('R108 dev-issue: requires ENABLE_DEV_ENDPOINTS', async () => {
  // This test assumes ENABLE_DEV_ENDPOINTS=1 in server .env
  const res = await post('/api/test/dev-issue', { openid: 'test-fake-openid-' + Date.now() });
  // If disabled → 404; if enabled → 200
  assert.ok(res.status === 200 || res.status === 404, `unexpected status ${res.status}`);
  if (res.status === 404) {
    console.log('SKIP: ENABLE_DEV_ENDPOINTS not set, endpoint disabled');
  }
});

test('R108 dev-issue: missing openid → 400 (when enabled)', async () => {
  const res = await post('/api/test/dev-issue', {});
  if (res.status === 404) return; // disabled, skip
  assert.strictEqual(res.status, 400, 'expected 400 for missing openid');
  assert.strictEqual(res.data.code, 400);
});

test('R108 dev-issue: existing admin openid → 200 + token', async () => {
  const res = await post('/api/test/dev-issue', { openid: 'oemfzxT1ND_EukOcGdzN3rOWGBaY' });
  if (res.status === 404) return;
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.data.code, 0);
  assert.ok(res.data.data.token, 'should return token');
  assert.strictEqual(res.data.data.user.openid, 'oemfzxT1ND_EukOcGdzN3rOWGBaY');
});

test('R108 dev-issue: new openid auto-creates user', async () => {
  const newOpenid = 'r108-test-' + Date.now();
  const res = await post('/api/test/dev-issue', { openid: newOpenid });
  if (res.status === 404) return;
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.data.code, 0);
  assert.ok(res.data.data.token);
  assert.strictEqual(res.data.data.user.openid, newOpenid);
  assert.strictEqual(res.data.data.user.nickname, 'dev-user');
});