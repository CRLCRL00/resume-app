const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadingStages } = require('../utils/loading');

test('loadingStages returns 3 stages', () => {
  const stages = loadingStages();
  assert.equal(stages.length, 3);
});

test('loadingStages stages have at + text', () => {
  const stages = loadingStages();
  for (const s of stages) {
    assert.ok(typeof s.at === 'number');
    assert.ok(typeof s.text === 'string' && s.text.length > 0);
  }
});

test('loadingStages ascending timestamps', () => {
  const stages = loadingStages();
  assert.ok(stages[0].at < stages[1].at);
  assert.ok(stages[1].at < stages[2].at);
});

test('loadingStages first stage at 0ms with submit text', () => {
  const stages = loadingStages();
  assert.equal(stages[0].at, 0);
  assert.match(stages[0].text, /提交/);
});

test('loadingStages third stage mentions slow', () => {
  const stages = loadingStages();
  assert.match(stages[2].text, /较慢|耐心|稍候/);
});