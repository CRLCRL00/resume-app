const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scoreColor } = require('../utils/constants');

test('scoreColor returns HIGH for score >= 80', () => {
  assert.equal(scoreColor(80), '#07c160');
  assert.equal(scoreColor(100), '#07c160');
});

test('scoreColor returns MID for 60 <= score < 80', () => {
  assert.equal(scoreColor(60), '#ff9800');
  assert.equal(scoreColor(79), '#ff9800');
});

test('scoreColor returns LOW for score < 60', () => {
  assert.equal(scoreColor(59), '#999');
  assert.equal(scoreColor(0), '#999');
});
