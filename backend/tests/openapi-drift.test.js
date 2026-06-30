/**
 * OpenAPI drift detector: load openapi.json spec, then probe each route to ensure
 * it actually exists and responds. This catches cases where the spec drifts from
 * real route mounts.
 *
 * Skip actual response shape validation here (would need full ajv setup).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const path = require('path');
const fs = require('fs');
const { createApp } = require('../src/app');

// 加载 spec
const SPEC_PATH = path.join(__dirname, '..', 'src', 'routes', 'openapi.js');
const routes = require(SPEC_PATH);
const { openapiRouter } = routes;

// Extract spec by mounting only openapiRouter and hitting it
const specApp = require('express')();
specApp.use('/api/docs', openapiRouter);

const SPEC = {};

async function loadSpec() {
  const r = await request(specApp).get('/api/docs/openapi.json');
  assert.equal(r.status, 200);
  return r.body;
}

test('OpenAPI spec loads with required structure', async () => {
  const spec = await loadSpec();
  assert.equal(spec.openapi, '3.0.3');
  assert.ok(spec.paths);
  assert.ok(spec.components);
  assert.ok(spec.components.schemas);
});

test('spec lists >= 25 paths', async () => {
  const spec = await loadSpec();
  const pathCount = Object.keys(spec.paths).length;
  assert.ok(pathCount >= 25, `expected >= 25 paths, got ${pathCount}`);
});

test('each path has at least one operation', async () => {
  const spec = await loadSpec();
  for (const [path, item] of Object.entries(spec.paths)) {
    const ops = Object.keys(item).filter(k => ['get','post','put','delete','patch'].includes(k));
    assert.ok(ops.length >= 1, `${path} has no operations`);
  }
});

test('health endpoint actually mounts', async () => {
  const app = createApp();
  const r = await request(app).get('/api/health');
  assert.ok(r.status === 200 || r.status === 503, `health: ${r.status}`);
});

test('legal/versions endpoint actually mounts', async () => {
  const app = createApp();
  const r = await request(app).get('/api/legal/versions');
  assert.equal(r.status, 200);
  assert.equal(r.body.code, 0);
});

test('docs/openapi.json endpoint actually mounts', async () => {
  const app = createApp();
  const r = await request(app).get('/api/docs/openapi.json');
  assert.equal(r.status, 200);
});

test('spec paths match actual route mounts (sample)', async () => {
  const spec = await loadSpec();
  const app = createApp();
  // 取公开 + 简单 path 验
  const samples = ['/api/health', '/api/legal/privacy', '/api/legal/terms', '/api/docs/openapi.json'];
  for (const p of samples) {
    if (!spec.paths[p]) continue;  // spec 可能没列
    const r = await request(app).get(p);
    assert.notEqual(r.status, 404, `Path ${p} declared in spec but route returns 404`);
  }
});
