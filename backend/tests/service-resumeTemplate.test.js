const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderResume } = require('../src/services/resumeTemplate');

const baseForm = {
  name: '张三', gender: 'male', degree: '本科', phone: '13800138000',
  educations: [
    { school: '清华', major: 'CS', degree: '本科', start: '2018-09', end: '2022-06' },
    { school: '北大', major: 'AI', degree: '硕士', start: '2022-09', end: '至今' },
  ],
  experiences: [
    { company: '字节', title: '前端', start: '2022-07', end: '2024-12', desc: '负责小程序' },
  ],
  expected: { city: '深圳', position: '前端', salary_min: 15, salary_max: 25 },
  skills: ['React', 'Vue'],
};

test('renderResume includes name as H1', () => {
  const md = renderResume(baseForm);
  assert.match(md, /^# 张三/);
});

test('renderResume iterates all educations', () => {
  const md = renderResume(baseForm);
  assert.ok(md.includes('### 清华'));
  assert.ok(md.includes('### 北大'));
});

test('renderResume iterates all experiences', () => {
  const md = renderResume(baseForm);
  assert.ok(md.includes('### 字节 - 前端'));
  assert.ok(md.includes('负责小程序'));
});

test('renderResume shows expected city and salary range', () => {
  const md = renderResume(baseForm);
  assert.ok(md.includes('城市：深圳'));
  assert.ok(md.includes('15K - 25K'));
});

test('renderResume joins skills with 、', () => {
  const md = renderResume(baseForm);
  assert.ok(md.includes('React、Vue'));
});

test('renderResume shows 未提供 when phone empty', () => {
  const md = renderResume({ ...baseForm, phone: '' });
  assert.ok(md.includes('联系方式：未提供'));
});
