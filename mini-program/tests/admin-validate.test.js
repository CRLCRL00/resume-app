const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateJob, validatePrompt } = require('../utils/adminValidate');

test('validateJob requires title', () => {
  const errors = validateJob({ title: '', company: 'a', city: 'b', salary_min: 10, salary_max: 20, description_md: 'long enough desc' });
  assert.ok(errors.title);
});

test('validateJob catches salary_max < salary_min', () => {
  const errors = validateJob({ title: 't', company: 'c', city: 'x', salary_min: 20, salary_max: 10, description_md: 'long enough desc' });
  assert.ok(errors.salary);
});

test('validateJob requires description_md >= 10 chars', () => {
  const errors = validateJob({ title: 't', company: 'c', city: 'x', salary_min: 1, salary_max: 2, description_md: 'short' });
  assert.ok(errors.description_md);
});

test('validateJob accepts valid form', () => {
  const errors = validateJob({ title: 't', company: 'c', city: 'x', salary_min: 10, salary_max: 20, description_md: 'long enough desc' });
  assert.deepEqual(errors, {});
});

test('validatePrompt requires content', () => {
  assert.ok(validatePrompt({}).content);
  assert.ok(validatePrompt({ content: '   ' }).content);
  assert.equal(validatePrompt({ content: 'x' }).content || undefined, undefined);
});