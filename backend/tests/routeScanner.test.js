/**
 * routeScanner: walk Express app._router.stack, emit {method,path,middlewares}
 * and convert to OpenAPI paths object. Tests below.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { scanRoutes, routesToOpenApi } = require('../src/services/routeScanner');
const { createApp } = require('../src/app');

test('scanRoutes returns array with correct count (>= 25 routes)', () => {
  const app = createApp();
  const routes = scanRoutes(app);
  assert.ok(Array.isArray(routes));
  assert.ok(routes.length >= 25, `expected >= 25 routes, got ${routes.length}`);
});

test('each route entry has method (lowercase) + path + middlewares array', () => {
  const app = createApp();
  const routes = scanRoutes(app);
  for (const r of routes) {
    assert.ok(['get', 'post', 'put', 'delete', 'patch'].includes(r.method), `bad method ${r.method} on ${r.path}`);
    assert.equal(typeof r.path, 'string');
    assert.ok(r.path.startsWith('/api/'), `bad path ${r.path}`);
    assert.ok(Array.isArray(r.middlewares), `middlewares not array on ${r.path}`);
  }
});

test('routesToOpenApi: Express :id → OpenAPI {id} + path param', () => {
  const routes = [
    { method: 'get', path: '/api/users/:id', middlewares: [] },
    { method: 'get', path: '/api/items/:itemId/comments/:cid', middlewares: [] },
  ];
  const out = routesToOpenApi(routes);
  assert.ok(out['/api/users/{id}']);
  assert.ok(out['/api/users/{id}'].get);
  const params = out['/api/users/{id}'].get.parameters;
  assert.ok(Array.isArray(params));
  const idParam = params.find(p => p.name === 'id' && p.in === 'path');
  assert.ok(idParam, 'missing id path param');
  assert.equal(idParam.required, true);
  assert.deepEqual(idParam.schema, { type: 'string' });
  // multi-param
  const cm = out['/api/items/{itemId}/comments/{cid}'].get.parameters;
  const names = cm.map(p => p.name).sort();
  assert.deepEqual(names, ['cid', 'itemId']);
});

test('routesToOpenApi: each method stub has summary + 200 + x-auto-generated', () => {
  const out = routesToOpenApi([
    { method: 'post', path: '/api/foo', middlewares: [] },
    { method: 'delete', path: '/api/foo/:id', middlewares: [] },
  ]);
  const post = out['/api/foo'].post;
  assert.equal(post.summary, 'POST /api/foo');
  assert.ok(post.responses[200]);
  assert.equal(post['x-auto-generated'], true);
  const del = out['/api/foo/{id}'].delete;
  assert.equal(del.summary, 'DELETE /api/foo/{id}');
});

test('scanRoutes: skips /api/internal/* by default', () => {
  const app = createApp();
  const routes = scanRoutes(app);
  const internal = routes.filter(r => r.path.startsWith('/api/internal/'));
  assert.equal(internal.length, 0, `internal routes leaked: ${internal.map(r => r.path).join(',')}`);
});

test('scanRoutes: includeInternal:true reveals /api/internal/* routes', () => {
  const app = createApp();
  const routes = scanRoutes(app, { includeInternal: true });
  const internal = routes.filter(r => r.path.startsWith('/api/internal/'));
  assert.ok(internal.length > 0, 'no internal routes found');
  // all should carry x-internal marker (we add it via filter downstream or here)
  for (const r of internal) {
    assert.equal(r.xInternal, true, `${r.path} missing xInternal flag`);
  }
});

test('routesToOpenApi produces valid OpenAPI 3.0 paths object', () => {
  const out = routesToOpenApi([
    { method: 'get', path: '/api/a', middlewares: [] },
  ]);
  // only method keys + x-* are valid operation keys
  for (const [p, item] of Object.entries(out)) {
    assert.ok(p.startsWith('/'), `bad path key ${p}`);
    for (const k of Object.keys(item)) {
      const isMethod = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'].includes(k);
      const isExt = k.startsWith('x-');
      assert.ok(isMethod || isExt, `bad key ${k} in path ${p}`);
    }
  }
});

test('merge strategy: hand-written OpenAPI path wins over auto-generated', async () => {
  const app = createApp();
  const res = await request(app).get('/api/docs/openapi.json');
  assert.equal(res.status, 200);
  const spec = res.body;
  // /api/jobs/{id} has rich hand-written doc with summary:"岗位详情" + 404
  const j = spec.paths['/api/jobs/{id}'];
  assert.ok(j, 'jobs/{id} missing in spec');
  assert.ok(j.get, 'jobs/{id} GET missing');
  assert.equal(j.get.summary, '岗位详情', 'hand-written summary lost');
  assert.ok(j.get.responses[404], 'hand-written 404 lost');
  // auto-gen marker must NOT clobber hand-written
  assert.equal(j.get['x-auto-generated'], undefined, 'hand-written entry should not carry x-auto-generated');
  // x-path-count must report both
  assert.ok(spec.info['x-path-count'], 'x-path-count missing');
  assert.equal(typeof spec.info['x-path-count'].auto, 'number');
  assert.equal(typeof spec.info['x-path-count'].manual, 'number');
  assert.ok(spec.info['x-path-count'].auto + spec.info['x-path-count'].manual > 0);
  // x-auto-paths flag
  assert.equal(spec.info['x-auto-paths'], true);
});
