// Admin panel static serving (Round 40 B re-attempt)
// - /admin/login.html, /admin/dashboard.html, /admin/css/admin.css served at 200
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const request = require('supertest');
const { createApp } = require('../src/app');

const panelRoot = path.join(__dirname, '..', '..', 'admin-panel');

test('GET /admin/login.html → 200 + HTML', async () => {
  const res = await request(createApp()).get('/admin/login.html');
  assert.equal(res.status, 200, `body=${(res.text || '').slice(0, 200)}`);
  assert.match(res.headers['content-type'] || '', /html/i);
});

test('GET /admin/dashboard.html → 200 + HTML', async () => {
  const res = await request(createApp()).get('/admin/dashboard.html');
  assert.equal(res.status, 200, `body=${(res.text || '').slice(0, 200)}`);
  assert.match(res.headers['content-type'] || '', /html/i);
});

test('GET /admin/css/admin.css → 200 + CSS content-type', async () => {
  const res = await request(createApp()).get('/admin/css/admin.css');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'] || '', /css/i);
  const body = res.text || '';
  assert.ok(body.length > 50, 'admin.css 应非空');
});
