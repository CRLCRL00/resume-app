const { test } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/config/db');
const { build } = require('../src/services/matchPrompt');

test('build reads match_rerank prompt from DB and replaces placeholders', async () => {
  await pool.query("DELETE FROM prompts WHERE code = 'match_rerank_test_xxx'");
  await pool.query(
    "INSERT INTO prompts (code, name, content, version, is_active) VALUES ('match_rerank_test_xxx', 'test', '# 你是HR\n简历：{resume}\n岗位：{jobs}\n输出JSON', 1, 1)"
  );

  const { system, user } = await build('RESUME_TEXT', [{ id: 1, title: 't' }]);
  assert.match(system, /匹配专家/);
  assert.match(user, /RESUME_TEXT/);
  assert.match(user, /"job_id":\s*1/);
  assert.ok(!user.includes('{resume}'));
  assert.ok(!user.includes('{jobs}'));
});

test('build throws if no active prompt', async () => {
  await pool.query("UPDATE prompts SET is_active = 0 WHERE code = 'match_rerank'");
  await assert.rejects(async () => build('x', []), /match_rerank/);
  await pool.query("UPDATE prompts SET is_active = 1 WHERE code = 'match_rerank'");
});

test('build JSON-stringifies jobs array with null safe', async () => {
  const { user } = await build('r', [{ id: 2, title: 't', skills_required: null }]);
  assert.match(user, /"job_id":\s*2/);
});

test.after(async () => {
  await pool.query("DELETE FROM prompts WHERE code = 'match_rerank_test_xxx'");
  await pool.end();
});
