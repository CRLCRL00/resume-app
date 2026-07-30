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
  // 恢复默认 seed（避免污染后续测试）
  await pool.query(
    "UPDATE prompts SET content = '# 角色\\n你是一位资深 HR，专长把零散经历改写成有冲击力的简历段落。\\n\\n# 任务\\n根据用户提供的资料，生成一份结构化中文简历，输出 Markdown。\\n\\n# 用户资料\\n{user_form}\\n\\n# 输出格式（严格遵守）\\n```markdown\\n# {{姓名}}\\n\\n## 个人概况\\n- 期望城市：...\\n- 期望岗位：...\\n- 期望薪资：...K/月\\n\\n## 教育背景\\n...\\n\\n## 工作经历\\n...\\n\\n## 技能清单\\n...\\n\\n## 项目亮点\\n...\\n```\\n\\n# 约束\\n- 篇幅 ≤ 600 字\\n- 用动词开头，避免空洞形容\\n- 技能点必须从用户资料里出现，不要编造' WHERE code = 'resume_generate' AND is_active = 1"
  );
  await pool.end();
});