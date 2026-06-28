const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildPaginationParams, formatJobRow, formatLogRow, mapActionLabel } = require('../utils/adminFormat');

test('buildPaginationParams default', () => {
  assert.equal(buildPaginationParams(), '?page=1&pageSize=20');
  assert.equal(buildPaginationParams(2, 50), '?page=2&pageSize=50');
});

test('formatJobRow builds display string', () => {
  const row = formatJobRow({ id: 1, title: '前端', company: 'A', city: '深圳', salary_min: 10, salary_max: 20, is_online: 1, is_deleted: 0 });
  assert.equal(row.salary, '10-20K');
  assert.equal(row.status, 'online');
});

test('formatJobRow maps status correctly', () => {
  assert.equal(formatJobRow({ id:1, salary_min:1, salary_max:2, is_online:0, is_deleted:0 }).status, 'offline');
  assert.equal(formatJobRow({ id:1, salary_min:1, salary_max:2, is_online:1, is_deleted:1 }).status, 'deleted');
});

test('formatLogRow parses detail JSON', () => {
  const r = formatLogRow({ id: 1, action: 'job.create', detail: '{"title":"x"}' });
  assert.deepEqual(r.detail, { title: 'x' });
});

test('mapActionLabel translates known actions', () => {
  assert.equal(mapActionLabel('job.create'), '创建岗位');
  assert.equal(mapActionLabel('unknown.action'), 'unknown.action');
});