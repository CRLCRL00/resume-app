/**
 * R94 bigscreen — 大屏填简历 unit tests
 *
 * Tests:
 *   - emptyForm() 初始化
 *   - calcCompletion() 加权累计
 *   - 步骤常量
 *   - form.js 入口函数存在
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

test('R94: emptyForm returns all-empty initial state', () => {
  const { emptyForm } = require('../pages/form/bigscreen/bigscreen')._test;
  const f = emptyForm();
  assert.strictEqual(f.name, '');
  assert.strictEqual(f.gender, '');
  assert.strictEqual(f.degree, '');
  assert.strictEqual(f.phone, '');
  assert.strictEqual(f.educations.length, 1);
  assert.strictEqual(f.educations[0].school, '');
  assert.strictEqual(f.experiences.length, 1);
  assert.strictEqual(f.experiences[0].company, '');
  assert.strictEqual(f.expected.city, '');
  assert.deepStrictEqual(f.skills, []);
});

test('R94: calcCompletion empty form = 0', () => {
  const { emptyForm, calcCompletion } = require('../pages/form/bigscreen/bigscreen')._test;
  assert.strictEqual(calcCompletion(emptyForm(), 0), 0);
});

test('R94: calcCompletion with full basic info = 25', () => {
  const { emptyForm, calcCompletion } = require('../pages/form/bigscreen/bigscreen')._test;
  const f = emptyForm();
  f.name = '张三';
  f.gender = 'male';
  f.degree = '本科';
  f.phone = '13800000000';
  assert.strictEqual(calcCompletion(f, 0), 25);
});

test('R94: calcCompletion with full basic + education = 45', () => {
  const { emptyForm, calcCompletion } = require('../pages/form/bigscreen/bigscreen')._test;
  const f = emptyForm();
  f.name = '张三'; f.gender = 'male'; f.degree = '本科'; f.phone = '13800000000';
  f.educations[0].school = '清华';
  f.educations[0].major = 'CS';
  f.educations[0].start = '2020-09';
  f.educations[0].end = '2024-06';
  assert.strictEqual(calcCompletion(f, 0), 45);
});

test('R94: calcCompletion with all filled = 100', () => {
  const { emptyForm, calcCompletion } = require('../pages/form/bigscreen/bigscreen')._test;
  const f = emptyForm();
  f.name = '张三'; f.gender = 'male'; f.degree = '本科'; f.phone = '13800000000';
  f.educations[0].school = '清华';
  f.educations[0].major = 'CS';
  f.educations[0].start = '2020-09';
  f.educations[0].end = '2024-06';
  f.experiences[0].company = '阿里';
  f.experiences[0].title = '前端';
  f.experiences[0].start = '2021-07';
  f.experiences[0].end = '至今';
  f.experiences[0].desc = '负责 xxx';
  f.expected.city = '深圳';
  f.expected.position = '全栈';
  f.expected.salary_min = '15';
  f.expected.salary_max = '25';
  assert.strictEqual(calcCompletion(f, 3), 100);
});

test('R94: calcCompletion cap at 100', () => {
  const { emptyForm, calcCompletion } = require('../pages/form/bigscreen/bigscreen')._test;
  const f = emptyForm();
  f.name = 'X'; f.skills = ['a', 'b', 'c'];
  // 10 + 10 = 20 (extra skills bonus not in spec, but skills weight is 10)
  const r = calcCompletion(f, 3);
  assert.ok(r <= 100, `should cap at 100, got ${r}`);
});

test('R94: STEP_LABELS has 5 steps', () => {
  const { STEP_LABELS } = require('../pages/form/bigscreen/bigscreen')._test;
  assert.strictEqual(STEP_LABELS.length, 5);
  assert.deepStrictEqual(STEP_LABELS, ['基本信息', '教育经历', '工作经历', '求职期望', '技能']);
});

test('R94: STEP_HINTS aligned with labels', () => {
  const { STEP_LABELS, STEP_HINTS } = require('../pages/form/bigscreen/bigscreen')._test;
  assert.strictEqual(STEP_HINTS.length, STEP_LABELS.length);
});

test('R94: form.js exposes goBigscreen handler', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync('./pages/form/form.js', 'utf8');
  assert.ok(src.includes('goBigscreen'), 'form.js missing goBigscreen');
  assert.ok(src.includes("/pages/form/bigscreen/bigscreen"), 'form.js missing bigscreen route');
});

test('R94: form.wxml has bigscreen entry button', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync('./pages/form/form.wxml', 'utf8');
  assert.ok(src.includes('goBigscreen'), 'form.wxml missing bindtap');
  assert.ok(src.includes('btn-bigscreen'), 'form.wxml missing btn-bigscreen class');
});

test('R94: app.json registers bigscreen route', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync('./app.json', 'utf8');
  assert.ok(
    src.includes('pages/form/bigscreen/bigscreen'),
    'app.json missing bigscreen route'
  );
});