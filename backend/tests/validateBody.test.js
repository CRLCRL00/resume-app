const test = require('node:test');
const assert = require('node:assert');
const Joi = require('joi');
const { validateBody } = require('../src/middleware/validate');

const schema = Joi.object({
  name: Joi.string().min(1).required(),
  age: Joi.number().integer().min(0),
  email: Joi.string().email(),
});

test('validateBody passes valid input', (t, done) => {
  const req = { body: { name: 'Alice', age: 30, email: 'alice@example.com' } };
  const res = {};
  validateBody(schema)(req, res, () => {
    assert.strictEqual(req.body.name, 'Alice');
    done();
  });
});

test('validateBody rejects missing required', (t, done) => {
  const req = { body: { age: 30 } };
  const res = { status(c) { this.statusCode = c; return this; }, json(payload) { this.body = payload; done(); } };
  validateBody(schema)(req, res, () => {
    done(new Error('should not reach next'));
  });
});

test('validateBody strips unknown if requested', (t, done) => {
  const req = { body: { name: 'Alice', extra: 'foo' } };
  const res = {};
  validateBody(schema, { stripUnknown: true })(req, res, () => {
    assert.strictEqual(req.body.extra, undefined);
    done();
  });
});