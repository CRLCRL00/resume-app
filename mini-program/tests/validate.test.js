const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validatePhone, validateYearMonth, validateResume } = require('../utils/validate');

test('validatePhone: empty is legal', () => {
  assert.equal(validatePhone(''), true);
});

test('validatePhone: invalid format fails', () => {
  assert.equal(validatePhone('123456'), false);
});

test('validatePhone: 13800138000 is legal', () => {
  assert.equal(validatePhone('13800138000'), true);
});

test('validateYearMonth: 2024-13 fails', () => {
  assert.equal(validateYearMonth('2024-13'), false);
});

test('validateResume: salary_max < salary_min fails', () => {
  const errors = validateResume({
    name: 'x', gender: 'male', degree: '本科', phone: '',
    educations: [{ school: 's', major: 'm', degree: 'd', start: '2020-01', end: '至今' }],
    experiences: [{ company: 'c', title: 't', start: '2021-01', end: '至今', desc: 'd' }],
    expected: { city: 'x', position: 'y', salary_min: 25, salary_max: 15 },
    skills: ['A'],
  });
  assert.ok(errors.expected);
  assert.match(errors.expected, /薪资/);
});