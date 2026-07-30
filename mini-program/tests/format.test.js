const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseYearMonth,
  parseSkills,
  escapeHtml,
  mdToHtml,
} = require('../utils/format');

test('parseYearMonth: 至今 returns null', () => {
  assert.equal(parseYearMonth('至今'), null);
});

test('parseYearMonth: 2024-06 returns {year, month}', () => {
  assert.deepEqual(parseYearMonth('2024-06'), { year: 2024, month: 6 });
});

test('parseSkills: dedup + trim + filter empty', () => {
  assert.deepEqual(parseSkills('React, Vue,, React, '), ['React', 'Vue']);
});

test('escapeHtml: escapes < > & "', () => {
  assert.equal(escapeHtml('<script>"&"\''), '&lt;script&gt;&quot;&amp;&quot;&#39;');
});

test('mdToHtml: # title becomes h1', () => {
  assert.equal(mdToHtml('# 标题').trim(), '<h1>标题</h1>');
});