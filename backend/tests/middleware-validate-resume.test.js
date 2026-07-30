const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resumeSchema, jobSchema, promptUpdateSchema } = require('../src/middleware/validate');

test('resumeSchema accepts valid form', () => {
  const form = {
    name: '张三', gender: 'male', degree: '本科', phone: '13800138000',
    educations: [{ school: '清华', major: 'CS', degree: '本科', start: '2018-09', end: '2022-06' }],
    experiences: [{ company: '字节', title: '前端', start: '2022-07', end: '至今', desc: '...' }],
    expected: { city: '深圳', position: '前端', salary_min: 15, salary_max: 25 },
    skills: ['React'],
  };
  const { error, value } = resumeSchema.validate(form);
  assert.equal(error, undefined);
  assert.equal(value.name, '张三');
});

test('resumeSchema rejects salary_max < salary_min', () => {
  const form = {
    name: '张三', gender: 'male', degree: '本科', phone: '',
    educations: [{ school: 's', major: 'm', degree: 'd', start: '2020-01', end: '至今' }],
    experiences: [{ company: 'c', title: 't', start: '2021-01', end: '至今', desc: 'd' }],
    expected: { city: 'x', position: 'y', salary_min: 25, salary_max: 15 },
    skills: ['A'],
  };
  const { error } = resumeSchema.validate(form);
  assert.ok(error, 'should reject');
  assert.match(error.message, /salary_max/);
});

test('resumeSchema rejects empty skills', () => {
  const form = {
    name: '张三', gender: 'male', degree: '本科', phone: '',
    educations: [{ school: 's', major: 'm', degree: 'd', start: '2020-01', end: '至今' }],
    experiences: [{ company: 'c', title: 't', start: '2021-01', end: '至今', desc: 'd' }],
    expected: { city: 'x', position: 'y', salary_min: 10, salary_max: 20 },
    skills: [],
  };
  const { error } = resumeSchema.validate(form);
  assert.ok(error);
});

test('jobSchema accepts valid job', () => {
  const j = {
    title: '前端工程师', company: '字节', city: '深圳',
    salary_min: 15, salary_max: 25,
    description_md: '负责小程序',
  };
  const { error } = jobSchema.validate(j);
  assert.equal(error, undefined);
});

test('jobSchema rejects salary_max < salary_min', () => {
  const j = {
    title: 't', company: 'c', city: 'x',
    salary_min: 25, salary_max: 15, description_md: 'd',
  };
  const { error } = jobSchema.validate(j);
  assert.ok(error);
  assert.match(error.message, /salary_max/);
});

test('promptUpdateSchema requires content', () => {
  const { error: e1 } = promptUpdateSchema.validate({});
  assert.ok(e1);
  const { error: e2 } = promptUpdateSchema.validate({ content: 'x' });
  assert.equal(e2, undefined);
});
