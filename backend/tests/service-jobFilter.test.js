const { test } = require('node:test');
const assert = require('node:assert/strict');
const { coarseFilter } = require('../src/services/jobFilter');

const userForm = {
  expected: { city: '深圳', salary_min: 10, salary_max: 25 },
};

test('coarseFilter returns jobs matching city exactly', () => {
  const jobs = [
    { id: 1, city: '深圳', salary_min: 5, salary_max: 15 },
    { id: 2, city: '北京', salary_min: 5, salary_max: 15 },
    { id: 3, city: '深圳', salary_min: 40, salary_max: 50 },
  ];
  const out = coarseFilter(jobs, userForm);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 1);
});

test('coarseFilter uses wide salary range', () => {
  const jobs = [
    { id: 1, city: '深圳', salary_min: 8, salary_max: 15 },    // uMax(25)*1.5=37.5, ok; uMin(10)*0.8=8, ok
    { id: 2, city: '深圳', salary_min: 40, salary_max: 50 },   // uMax*1.5=37.5 < 40, fail
    { id: 3, city: '深圳', salary_min: 5, salary_max: 7 },     // uMin*0.8=8 > 7, fail
  ];
  const out = coarseFilter(jobs, userForm);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 1);
});

test('coarseFilter handles missing expected gracefully', () => {
  const jobs = [{ id: 1, city: '北京', salary_min: 10, salary_max: 20 }];
  const out = coarseFilter(jobs, {});
  assert.equal(out.length, 1);  // 不过滤（city 缺失 + salary 缺失）
});

test('coarseFilter returns empty when no matches', () => {
  const out = coarseFilter([{ id: 1, city: '上海', salary_min: 1, salary_max: 5 }], userForm);
  assert.equal(out.length, 0);
});

test('coarseFilter returns jobs slice up to limit', () => {
  const jobs = Array.from({ length: 10 }, (_, i) => ({
    id: i + 1, city: '深圳', salary_min: 5, salary_max: 15,
  }));
  const out = coarseFilter(jobs, userForm, 3);
  assert.equal(out.length, 3);
});
