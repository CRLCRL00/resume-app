/**
 * jobpilotAi 单元测试 (无 DB 依赖)
 *
 * 测试:
 *   - diagnoseProfile: 5 题 → 4 种画像分类
 *   - scoreProject: 项目描述 → 1-10 分 + 改进建议
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { diagnoseProfile, scoreProject, IMAGE_TYPES } = require('../src/services/jobpilotAi');

// ==================== diagnoseProfile ====================

test('diagnoseProfile: AI 协作画像 (非科班 + AI 协作 + 详细项目)', () => {
  const r = diagnoseProfile({
    education: '大专',
    aiAbility: 'AI 协作',
    projects: '用 Claude/DeepSeek 协作做了生产级 AI 应用,已上线',
    target: '实习',
    timeline: '1-3 个月',
  });
  assert.equal(r.image, 'ai_collaboration_project_lead');
  assert.ok(r.confidence >= 0.8);
  assert.ok(r.keyStrengths.length >= 1);
  assert.equal(r.avoidJobs.length, 0);
});

test('diagnoseProfile: 传统 CS 应届 (本科 + 熟工具 + 简单项目)', () => {
  const r = diagnoseProfile({
    education: '本科',
    aiAbility: '熟工具',
    projects: 'React 项目,用过 ChatGPT',
    target: '实习',
    timeline: '1-3 个月',
  });
  // ratio 应该 < 0.6,所以不是 ai_collaboration
  assert.notEqual(r.image, 'ai_collaboration_project_lead');
});

test('diagnoseProfile: 转型求职 (目标 = 转型)', () => {
  const r = diagnoseProfile({
    education: '本科',
    aiAbility: '不熟',
    projects: '传统行业 5 年经验',
    target: '转型',
    timeline: '6+ 个月',
  });
  // 即使 ratio 低,因为 target='转型' 应该走 career_transition
  assert.equal(r.image, 'career_transition');
});

test('diagnoseProfile: 关键词命中加分 (deepseek/coze/dify/llm)', () => {
  const r1 = diagnoseProfile({
    education: '大专',
    aiAbility: 'AI 协作',
    projects: '普通项目',  // 无 AI 关键词
    target: '实习',
    timeline: '立刻',
  });
  const r2 = diagnoseProfile({
    education: '大专',
    aiAbility: 'AI 协作',
    projects: '用 DeepSeek + Coze + Dify 做 AI 应用',  // 有 AI 关键词
    target: '实习',
    timeline: '立刻',
  });
  // 有 AI 关键词应该 confidence 更高 (虽然 image 可能相同)
  // 或者 keyStrengths 更多
  assert.ok(r2.keyStrengths.length >= r1.keyStrengths.length);
});

test('diagnoseProfile: 空 answers → fallback', () => {
  const r = diagnoseProfile({});
  // 不 crash,返回 image (可能是 algorithm_research 或 career_transition)
  assert.ok(IMAGE_TYPES.includes(r.image));
  assert.ok(r.confidence > 0);
});

test('diagnoseProfile: 大专学历 → avoidJobs 含"学历卡"', () => {
  const r = diagnoseProfile({
    education: '大专',
    aiAbility: '不熟',
    projects: '',
    target: '实习',
    timeline: '1-3 个月',
  });
  // 因为 education 大专 + ratio 低,avoidJobs 应含学历相关
  assert.ok(r.avoidJobs.some(j => /学历/.test(j)));
});

test('diagnoseProfile: 推荐岗位池稳定', () => {
  const r = diagnoseProfile({
    education: '大专',
    aiAbility: 'AI 协作',
    projects: 'AI 项目',
    target: '实习',
    timeline: '1-3 个月',
  });
  assert.ok(r.recommendedJobs.length >= 2);
  assert.ok(r.recommendedJobs.some(j => /AIGC/.test(j.category)));
});

test('diagnoseProfile: IMAGE_TYPES 导出 4 种', () => {
  assert.equal(IMAGE_TYPES.length, 4);
  assert.ok(IMAGE_TYPES.includes('ai_collaboration_project_lead'));
});

// ==================== scoreProject ====================

test('scoreProject: 完整 + 生产级 + AI 协作 → 高分', () => {
  const r = scoreProject({
    name: '简历推荐小程序',
    techStack: 'Express, Node 22, MySQL, Redis, DeepSeek LLM',
    aiCollaboration: '通过 Claude/DeepSeek 协作完成代码,我负责 review + 测试 + 部署',
    myRole: '项目负责人',
    url: 'https://43.139.176.199:443',
  });
  assert.ok(r.score >= 7, `expected >= 7, got ${r.score}`);
  assert.equal(r.breakdown.production_ready, 10);  // 有 https URL
  // ai_relevance 取决于 LLM 关键词命中次数,至少 3
  assert.ok(r.breakdown.ai_relevance >= 3);
});

test('scoreProject: 无 URL → production_ready 低', () => {
  const r = scoreProject({
    name: 'demo',
    techStack: 'Node',
    aiCollaboration: '用 Claude',
    myRole: 'dev',
  });
  assert.ok(r.breakdown.production_ready < 6);
  assert.ok(r.score < 8);
});

test('scoreProject: 无项目名 → 抛错 / 低分', () => {
  const r = scoreProject({});
  // 没 name,fallback 应该低分
  assert.ok(r.score < 5);
  // storyPoints 应为空数组
  assert.equal(r.storyPoints.length, 0);
});

test('scoreProject: AI 关键词命中加分', () => {
  const baseProject = {
    name: 'p',
    techStack: '',
    aiCollaboration: '',
    myRole: '',
    url: '',
  };
  const noAi = scoreProject(baseProject);
  const withAi = scoreProject({
    ...baseProject,
    techStack: 'Claude DeepSeek LLM',
    aiCollaboration: '用 Coze Dify 智能体',
  });
  // 有 AI 关键词的应该 ai_relevance 更高
  assert.ok(withAi.breakdown.ai_relevance > noAi.breakdown.ai_relevance);
});

test('scoreProject: 量化数据加分 (story_potential)', () => {
  const r = scoreProject({
    name: 'p',
    techStack: '',
    aiCollaboration: '用 Claude,114 单测全绿,1万用户',
    myRole: '项目负责人',
  });
  // 有数字 + AI + 项目负责人 → story_potential 应该 ≥ 6
  assert.ok(r.breakdown.story_potential >= 6);
});

test('scoreProject: 改进建议列表', () => {
  const r = scoreProject({ name: 'p' });
  // 缺很多字段 → 应有多个改进建议
  assert.ok(r.improvements.length >= 1);
});

test('scoreProject: salaryImpact 分级', () => {
  const high = scoreProject({
    name: 'p',
    techStack: 'DeepSeek Claude LLM',
    aiCollaboration: '用 Claude/DeepSeek 协作,114 单测全绿,1万用户',
    myRole: '项目负责人',
    url: 'https://example.com',
  });
  const low = scoreProject({ name: 'p' });
  assert.match(high.salaryImpact, /\d+-\d+\s*元/);
  assert.match(low.salaryImpact, /\d+-\d+\s*元/);
  // 高分应该有更高 salaryImpact
  const highNum = parseInt(high.salaryImpact.match(/(\d+)/)[1]);
  const lowNum = parseInt(low.salaryImpact.match(/(\d+)/)[1]);
  assert.ok(highNum > lowNum);
});

test('scoreProject: bestForJobs 含 AI 相关岗位', () => {
  const r = scoreProject({
    name: 'p',
    techStack: 'DeepSeek',
    aiCollaboration: '用 Claude 协作',
    myRole: '负责人',
    url: 'https://x.com',
  });
  assert.ok(r.bestForJobs.length >= 1);
  assert.ok(r.bestForJobs.some(j => /AIGC|Prompt|AI/.test(j)));
});

test('scoreProject: storyPoints 基于项目生成', () => {
  const r = scoreProject({
    name: '简历推荐小程序',
    techStack: 'Node',
    aiCollaboration: 'AI 协作',
    myRole: '负责人',
    url: 'https://x.com',
  });
  assert.ok(r.storyPoints.length >= 2);
  assert.ok(r.storyPoints[0].title.includes('简历推荐小程序'));
});

test('scoreProject: 各维度分数 ≤ 10', () => {
  const r = scoreProject({
    name: '完美项目',
    techStack: 'DeepSeek Claude Coze Dify LLM Agent',
    aiCollaboration: '用 Claude/DeepSeek 协作完成所有代码,114 单测全绿,1万用户,99.9% 可用性',
    myRole: '项目负责人主导',
    url: 'https://example.com',
  });
  for (const v of Object.values(r.breakdown)) {
    assert.ok(v <= 10, `${v} should be <= 10`);
  }
});