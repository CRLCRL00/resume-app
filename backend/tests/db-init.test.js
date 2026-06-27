const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('schema.sql file exists', () => {
  const p = path.join(__dirname, '..', 'src', 'db', 'schema.sql');
  assert.ok(fs.existsSync(p), 'schema.sql should exist');
});

test('seed.sql file exists', () => {
  const p = path.join(__dirname, '..', 'src', 'db', 'seed.sql');
  assert.ok(fs.existsSync(p), 'seed.sql should exist');
});
