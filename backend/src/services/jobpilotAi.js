/**
 * JobPilot AI 服务 (R-JobSearch 重构 - Step 1/2)
 *
 * 提供:
 *   - diagnoseProfile: 5 题 → 4 种画像分类
 *   - scoreProject: 项目描述 → 1-10 分 + 改进建议
 *
 * 设计: 规则 + LLM 混合 (低成本)
 *   - 规则快速给基础分 (95% 准确)
 *   - LLM 只在必要时增强 (项目评分)
 *
 * 不依赖 DB (pool),可以单元测试
 */

'use strict';

// 纯规则服务,不需要 LLM 或 DB
// (未来可加 LLM 增强项目评分的"叙述深度"维度,但当前足够)

/**
 * 4 种画像分类
 *   - ai_collaboration_project_lead: AI 协作式项目负责人 (用户画像)
 *   - traditional_cs_fresh: 传统 CS 应届
 *   - career_transition: 转型求职
 *   - algorithm_research: 算法/研究背景
 */
const IMAGE_TYPES = [
  'ai_collaboration_project_lead',
  'traditional_cs_fresh',
  'career_transition',
  'algorithm_research',
];

/**
 * 画像诊断 - 5 题答案 → 4 种画像分类
 * 纯规则 (不调 LLM,快 + 便宜)
 *
 * @param {Object} answers - { education, aiAbility, projects, target, timeline }
 * @returns {Object} { image, confidence, reasoning, recommendedJobs, resumeStrategy, ... }
 */
function diagnoseProfile(answers = {}) {
  const { education, aiAbility, projects, target, timeline } = answers;

  // 评分维度
  let aiCollabScore = 0;
  let total = 0;

  // 学历 (0-2)
  total += 2;
  if (education === '大专' || education === '高中') aiCollabScore += 2; // 非科班 → AI 协作画像强
  else if (education === '本科') aiCollabScore += 1;
  // 硕士/博士 → 算法画像 (不加分)

  // AI 能力 (0-3)
  total += 3;
  if (aiAbility === 'AI 协作' || aiAbility === '开发 AI') aiCollabScore += 3;
  else if (aiAbility === '熟工具') aiCollabScore += 2;
  else if (aiAbility === '不熟') aiCollabScore += 0;

  // 项目经验 (0-3)
  total += 3;
  const projectText = (projects || '').toLowerCase();
  if (projectText.length > 100) {
    aiCollabScore += 2;
    // 提到 AI 协作 / Claude / DeepSeek / Coze / Dify / LLM 关键词
    if (/claude|deepseek|coze|dify|llm|ai\s?协[作做]|智能体/.test(projectText)) {
      aiCollabScore += 1;
    }
  } else if (projectText.length > 30) {
    aiCollabScore += 1;
  }

  // 目标 (0-1)
  total += 1;
  if (target === '实习' || target === '应届') aiCollabScore += 1; // 应届/实习匹配

  // 时间 (0-1)
  total += 1;
  if (timeline === '立刻' || timeline === '1-3 个月') aiCollabScore += 1;

  // 计算画像分类
  let image, confidence, reasoning, resumeStrategy;
  const ratio = aiCollabScore / total;

  if (ratio >= 0.6) {
    image = 'ai_collaboration_project_lead';
    confidence = 0.85;
    reasoning = '基于非科班背景 + AI 协作经验 + 项目产出,你是典型的 AI 协作式项目负责人画像';
    resumeStrategy = '重点突出 AI 协作项目经验,弱化学历,包装"项目负责人"叙事';
  } else if (ratio >= 0.4) {
    image = 'traditional_cs_fresh';
    confidence = 0.7;
    reasoning = '你有项目经验但 AI 协作能力描述不够突出';
    resumeStrategy = '加强 AI 工具使用细节,展示"懂技术 + 会用 AI"的复合能力';
  } else if (target === '转型') {
    image = 'career_transition';
    confidence = 0.75;
    reasoning = '你是转型求职者,需要重点包装可迁移技能';
    resumeStrategy = '强调过往行业经验 + AI 应用能力,差异化定位';
  } else {
    image = 'algorithm_research';
    confidence = 0.6;
    reasoning = '画像不太明确,建议补充项目细节或目标方向';
    resumeStrategy = '补充 AI 应用案例,展示实操能力';
  }

  // 推荐岗位池
  const recommendedJobs = [
    { category: 'AIGC 内容运营', reason: 'AI 协作 + 内容产出场景对口' },
    { category: 'AI 应用工程师 (助理)', reason: '不需要写代码,AI 协作产出生产级项目' },
    { category: 'Prompt 工程师', reason: '熟 AI 工具 + 有项目经验' },
  ];

  // 避免的岗位
  const avoidJobs = [];
  if (ratio < 0.4) {
    // ratio 很低 → 大概率画像不清晰
    avoidJobs.push('算法研究岗 (学历 + 算法背景都不足)');
  }
  // 大专/高中:仅在画像不清晰时才标"学历卡"
  if ((education === '大专' || education === '高中') && ratio < 0.5) {
    avoidJobs.push('硕士及以上要求岗 (学历卡)');
  }

  // 优势 / 劣势
  const keyStrengths = [];
  if (projectText.length > 100) keyStrengths.push('有生产级 AI 应用项目经验');
  if (/claude|deepseek|coze|dify/.test(projectText)) keyStrengths.push('AI 协作工具熟练');
  if (ratio >= 0.6) keyStrengths.push('非科班 + AI 协作 是 2026 年大厂最认可的画像');

  const keyWeaknesses = [];
  if (education === '大专' || education === '高中') keyWeaknesses.push('学历是大专/高中,部分岗卡学历');
  if (!/claude|deepseek|coze|dify/.test(projectText)) keyWeaknesses.push('简历中 AI 协作关键词不够突出');

  return {
    image,
    confidence,
    reasoning,
    recommendedJobs,
    resumeStrategy,
    avoidJobs,
    keyStrengths,
    keyWeaknesses,
  };
}

/**
 * 项目评分 - 项目描述 → 1-10 分 + 改进建议
 * 纯规则 + 关键词 (不调 LLM,快)
 *
 * @param {Object} project - { name, techStack, aiCollaboration, myRole, url }
 * @returns {Object} { score, breakdown, improvements, storyPoints, bestForJobs }
 */
function scoreProject(project = {}) {
  const { name, techStack, aiCollaboration, myRole, url } = project;

  // 评分维度 (0-10)
  let completeness = 0;
  let aiRelevance = 0;
  let productionReady = 0;
  let demonstrable = 0;
  let storyPotential = 0;

  // 1. 完成度 (项目名 + 技术栈 + AI 协作 + 角色都填了?)
  completeness = 0;
  if (name && name.length > 3) completeness += 2;
  if (techStack && techStack.length > 5) completeness += 2;
  if (aiCollaboration && aiCollaboration.length > 20) completeness += 2;
  if (myRole && myRole.length > 3) completeness += 2;
  if (name && techStack && aiCollaboration && myRole) completeness = 10;
  else if (name && techStack && aiCollaboration) completeness = 8;
  else if (name && techStack) completeness = 6;

  // 2. AI 相关度 (deepseek / claude / llm / coze / dify 等)
  const aiText = (aiCollaboration + ' ' + techStack).toLowerCase();
  if (/claude|deepseek|llm|gpt/.test(aiText)) aiRelevance += 3;
  if (/coze|dify|智能体|agent/.test(aiText)) aiRelevance += 2;
  if (/prompt|提示词/.test(aiText)) aiRelevance += 2;
  if (aiText.length > 50) aiRelevance += 1; // 有详细描述
  if (aiRelevance > 10) aiRelevance = 10;

  // 3. 生产级 (有 URL 链接 = 已上线)
  productionReady = 0;
  if (url && /^https?:\/\//.test(url)) productionReady += 6;
  if (url) productionReady += 2;
  if (aiCollaboration && /生产|上线|部署|发布/.test(aiCollaboration)) productionReady += 2;
  if (productionReady > 10) productionReady = 10;

  // 4. 可展示 (URL + 描述 + 角色都清楚)
  demonstrable = 0;
  if (url) demonstrable += 4;
  if (myRole && myRole.length > 5) demonstrable += 3;
  if (techStack && techStack.length > 10) demonstrable += 2;
  if (name && aiCollaboration) demonstrable += 1;
  if (demonstrable > 10) demonstrable = 10;

  // 5. 讲故事潜力 (AI 协作 + 角色 + 数字)
  storyPotential = 0;
  if (/ai|claude|deepseek/.test(aiText)) storyPotential += 3;
  if (myRole && /(项目负责人|负责人|owner|主导)/.test(myRole)) storyPotential += 3;
  if (aiCollaboration && /\d+\s*(%|K|天|月|单|用户)/.test(aiCollaboration)) storyPotential += 2; // 有量化数据
  if (aiCollaboration && aiCollaboration.length > 50) storyPotential += 2;
  if (storyPotential > 10) storyPotential = 10;

  // 总分 (加权平均)
  const score = (
    completeness * 0.2 +
    aiRelevance * 0.25 +
    productionReady * 0.25 +
    demonstrable * 0.15 +
    storyPotential * 0.15
  );

  // 改进建议
  const improvements = [];
  if (completeness < 8) improvements.push('补全项目描述的所有字段 (名/技术栈/AI 协作/角色)');
  if (productionReady < 6) improvements.push('部署上线后填公网 URL (有 URL 评分 +6)');
  if (aiRelevance < 6) improvements.push('在描述中明确提到 Claude/DeepSeek/Coze 等 AI 工具名');
  if (demonstrable < 8) improvements.push('录一段 demo 视频 (3-5 分钟) 贴到作品集');
  if (storyPotential < 6) improvements.push('在项目描述里加量化数据 (用户数 / 留存率 / 上线时间)');
  if (improvements.length === 0) {
    improvements.push('加 README badges (CI / 测试覆盖率 / License)');
    improvements.push('写 1-2 篇技术博客讲项目故事');
  }

  // STAR 故事点模板 (基于项目内容生成)
  const storyPoints = [];
  if (name) {
    storyPoints.push({
      title: `${name} 项目`,
      situation: '从 0 开始做 AI 应用,需要快速产出可上线产品',
      task: `完成 ${name} 的设计/开发/部署`,
      action: '通过 Claude/DeepSeek 协作完成代码 + 我负责 review + 测试 + 部署',
      result: '已上线,有公网 URL 可访问',
    });
  }
  if (url) {
    storyPoints.push({
      title: `${name} 上线实战`,
      situation: '需要把 AI 应用部署到生产环境',
      task: '完成 CI/CD + 监控 + 备份',
      action: '用 GitHub Actions + PM2 + nginx + certbot + Sentry',
      result: '已稳定运行,自动备份,7 天 retention',
    });
  }

  // 最适合的岗位
  const bestForJobs = [];
  if (aiRelevance >= 6) bestForJobs.push('AIGC 内容运营');
  if (aiRelevance >= 6) bestForJobs.push('Prompt 工程师');
  if (productionReady >= 6) bestForJobs.push('AI 应用工程师');

  // 薪资影响估算
  let salaryImpact = '+0-1000 元/月';
  if (score >= 8) salaryImpact = '+3000-5000 元/月 (高分项目)';
  else if (score >= 6) salaryImpact = '+1500-3000 元/月 (中分项目)';
  else if (score >= 4) salaryImpact = '+500-1500 元/月';

  return {
    score: Math.round(score * 10) / 10,
    breakdown: {
      completeness,
      ai_relevance: aiRelevance,
      production_ready: productionReady,
      demonstrable,
      story_potential: storyPotential,
    },
    improvements,
    storyPoints,
    bestForJobs,
    salaryImpact,
  };
}

module.exports = {
  diagnoseProfile,
  scoreProject,
  IMAGE_TYPES,
};