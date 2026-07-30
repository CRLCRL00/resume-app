const { test } = require('node:test');
const assert = require('node:assert/strict');
const Joi = require('joi');
const request = require('supertest');
const { convertJoi, convertJoiAll } = require('../src/services/joiToOpenApi');
const { resumeSchema, jobSchema, promptUpdateSchema } = require('../src/middleware/validate');
const { createApp } = require('../src/app');

test('convertJoi string -> {type:string}', () => {
  assert.deepEqual(convertJoi(Joi.string()).schema, { type: 'string' });
});

test('convertJoi string max(N) -> maxLength', () => {
  assert.deepEqual(convertJoi(Joi.string().max(64)).schema, { type: 'string', maxLength: 64 });
});

test('convertJoi string valid(a,b) -> enum', () => {
  assert.deepEqual(
    convertJoi(Joi.string().valid('a', 'b')).schema,
    { type: 'string', enum: ['a', 'b'] }
  );
});

test('convertJoi number integer min(0) -> integer minimum', () => {
  assert.deepEqual(
    convertJoi(Joi.number().integer().min(0)).schema,
    { type: 'integer', minimum: 0 }
  );
});

test('convertJoi array items string min(1) -> array minItems', () => {
  assert.deepEqual(
    convertJoi(Joi.array().items(Joi.string()).min(1)).schema,
    { type: 'array', items: { type: 'string' }, minItems: 1 }
  );
});

test('convertJoi object with required -> object required', () => {
  const out = convertJoi(Joi.object({ a: Joi.string().required() })).schema;
  assert.equal(out.type, 'object');
  assert.deepEqual(out.required, ['a']);
  assert.deepEqual(out.properties, { a: { type: 'string' } });
});

test('convertJoi string pattern(regex) -> pattern + flags', () => {
  const out = convertJoi(Joi.string().pattern(/^abc$/)).schema;
  assert.equal(out.type, 'string');
  assert.equal(out.pattern, '^abc$');
});

test('convertJoi string default(x) -> default:x', () => {
  assert.deepEqual(
    convertJoi(Joi.string().default('x')).schema,
    { type: 'string', default: 'x' }
  );
});

test('convertJoiAll returns all 3 schemas with correct sourceJoiName', () => {
  const all = convertJoiAll({ resumeSchema, jobSchema, promptUpdateSchema });
  assert.equal(all.resumeSchema.sourceJoiName, 'resumeSchema');
  assert.equal(all.jobSchema.sourceJoiName, 'jobSchema');
  assert.equal(all.promptUpdateSchema.sourceJoiName, 'promptUpdateSchema');
  assert.ok(all.resumeSchema.generatedAt);
  assert.equal(all.resumeSchema.schema.type, 'object');
  assert.equal(all.jobSchema.schema.type, 'object');
  assert.equal(all.promptUpdateSchema.schema.type, 'object');
});

test('GET /api/docs/openapi.json includes x-source: joi on 3 generated schemas', async () => {
  const app = createApp();
  const res = await request(app).get('/api/docs/openapi.json');
  assert.equal(res.status, 200);
  const spec = res.body;
  const generated = spec.components.schemas;
  const expected = ['ResumeSaveRequest', 'JobCreateRequest'];
  for (const name of expected) {
    assert.ok(generated[name], `missing schema: ${name}`);
    assert.equal(generated[name]['x-source'], 'joi', `schema ${name} missing x-source:joi`);
  }
  assert.ok(Array.isArray(spec.info['x-generated-schemas']));
  const names = spec.info['x-generated-schemas'].map(e => e.schemaName || e);
  assert.ok(names.includes('ResumeSaveRequest'));
  assert.ok(names.includes('JobCreateRequest'));
  assert.ok(names.includes('PromptUpdateRequest'));
});
