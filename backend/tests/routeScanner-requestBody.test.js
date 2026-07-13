/**
 * routeScanner → OpenAPI: requestBody inference from validateBody middleware.
 *
 * validateBody attaches __joiSchema + __joiSchemaLabel to its returned
 * middleware; routeScanner reads those to emit `requestBody` $refs into
 * components.schemas.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { scanRoutes, routesToOpenApi } = require('../src/services/routeScanner');
const { validateBody, resumeSchema, jobSchema } = require('../src/middleware/validate');

test('route with validateBody(resumeSchema) → requestBody references #/components/schemas/ResumeSaveRequest', () => {
  const out = routesToOpenApi([
    {
      method: 'post',
      path: '/api/resume/save',
      middlewares: [
        { name: 'userAuth' },
        { name: 'mw', requestSchema: resumeSchema, requestSchemaName: 'ResumeSaveRequest' },
      ],
    },
  ]);
  const op = out['/api/resume/save'].post;
  assert.ok(op.requestBody, 'requestBody missing');
  assert.equal(op.requestBody.required, true);
  assert.equal(
    op.requestBody.content['application/json'].schema.$ref,
    '#/components/schemas/ResumeSaveRequest',
  );
});

test('route with no validateBody → no requestBody in OpenAPI', () => {
  const out = routesToOpenApi([
    { method: 'get', path: '/api/resume/current', middlewares: [{ name: 'userAuth' }] },
  ]);
  assert.equal(out['/api/resume/current'].get.requestBody, undefined);
});

test('validateBody(jobSchema) → requestBody references #/components/schemas/JobCreateRequest', () => {
  const out = routesToOpenApi([
    {
      method: 'post',
      path: '/api/admin/jobs',
      middlewares: [
        { name: 'mw', requestSchema: jobSchema, requestSchemaName: 'JobCreateRequest' },
      ],
    },
  ]);
  const op = out['/api/admin/jobs'].post;
  assert.ok(op.requestBody, 'requestBody missing');
  assert.equal(
    op.requestBody.content['application/json'].schema.$ref,
    '#/components/schemas/JobCreateRequest',
  );
});

test('route with validateBody(non-registered schema) → requestBody omitted (graceful)', () => {
  // validateBody middleware exists but no requestSchemaName → must NOT error,
  // must NOT emit a broken $ref.
  const out = routesToOpenApi([
    {
      method: 'post',
      path: '/api/x',
      middlewares: [{ name: 'mw', requestSchema: jobSchema }], // no requestSchemaName
    },
  ]);
  assert.equal(out['/api/x'].post.requestBody, undefined);
});

test('integration: GET /api/docs/openapi.json shows requestBody on POST /api/resume/save', async () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  const res = await request(app).get('/api/docs/openapi.json');
  assert.equal(res.status, 200);
  const spec = res.body;
  const op = spec.paths['/api/resume/save'].post;
  assert.ok(op.requestBody, 'POST /api/resume/save missing requestBody in live spec');
  assert.equal(
    op.requestBody.content['application/json'].schema.$ref,
    '#/components/schemas/ResumeSaveRequest',
  );
  assert.ok(spec.components.schemas.ResumeSaveRequest, 'ResumeSaveRequest missing in components.schemas');
});

test('integration: GET /api/docs/openapi.json shows requestBody on POST /api/admin/jobs', async () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  const res = await request(app).get('/api/docs/openapi.json');
  assert.equal(res.status, 200);
  const spec = res.body;
  const op = spec.paths['/api/admin/jobs'].post;
  assert.ok(op.requestBody, 'POST /api/admin/jobs missing requestBody in live spec');
  assert.equal(
    op.requestBody.content['application/json'].schema.$ref,
    '#/components/schemas/JobCreateRequest',
  );
  assert.ok(spec.components.schemas.JobCreateRequest, 'JobCreateRequest missing in components.schemas');
});
