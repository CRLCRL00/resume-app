const { test } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/config/db');
const { build } = require('../src/services/resumePrompt');

test('build reads prompt from DB and splits system/user', async () => {
  // 确保 seed 在
  await pool.query(
    "INSERT INTO prompts (code, name, content, version, is_active) VALUES ('resume_generate', 'test', '# 角色\n你测试\n\n# 用户资料\n{user_form}\n\n# 输出\nmd', 99, 1) ON DUPLICATE KEY UPDATE content=VALUES(content)"
  );

  const { system, user } = await build({ name: '张三', skills: ['A'] });
  assert.match(system, /你测试/);
  assert.ok(!system.includes('{user_form}'), 'system should not contain {user_form}');
  assert.match(user, /张三/);
  assert.match(user, /"skills"/);
});

test('build throws if no active prompt', async () => {
  // 把所有 active 关掉
  await pool.query("UPDATE prompts SET is_active = 0 WHERE code = 'resume_generate'");
  await assert.rejects(async () => build({ name: 'x' }), /prompt not configured/);
  // 恢复
  await pool.query("UPDATE prompts SET is_active = 1 WHERE code = 'resume_generate'");
});

test('build JSON-stringifies the form', async () => {
  const { user } = await build({ name: '李四', age: 30, skills: ['B', 'C'] });
  assert.match(user, /"name":\s*"李四"/);
  assert.match(user, /"skills":\s*\[\s*"B"/);
});

test('build removes {user_form} placeholder completely', async () => {
  const { system, user } = await build({ x: 1 });
  assert.ok(!system.includes('{user_form}'));
  assert.ok(!user.includes('{user_form}'));
});

test.after(async () => {
  await pool.query("DELETE FROM prompts WHERE code = 'resume_generate' AND name = 'test'");
  await pool.end();
});