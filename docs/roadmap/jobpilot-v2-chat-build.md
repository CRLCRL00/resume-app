# JobPilot v2 — 对话建简历模块 (R-JobPilot-v2-ChatBuild)

> **核心变更**：推翻 R115 Wizard 主动提问 + 现有所有 R98-R140 装饰模式 + 抖音大屏/Tinder/雷达图等,
> 在 JobPilot v1 5 步流程内**新增 Step 2.5「AI 对话建简历」** 模块。
>
> **作者授权**：用户授权可推翻 R115 和现有所有模式包括架构,本次为全栈重构。

---

## 1. 定位与背景

### 1.1 推翻 R115 的原因

| 维度 | R115 Wizard (现有) | R-JobPilot-v2 (新) |
|------|---------------------|---------------------|
| **追问顺序** | 硬编码 18 字段顺序 (basic→education→work→expected→skills) | **基于画像动态调整** 5-8 轮对话 |
| **追问深度** | 统一深度 | 4 种画像各一套追问规则 (差异化) |
| **追问策略** | 按字段问 | **追问"量化结果" + "AI 协作细节" + "STAR 引导"** |
| **中断恢复** | 不支持 (用户退出 = 丢失) | **支持** (chat_build_sessions 表存历史) |
| **跟画像诊断关联** | 无 (各自独立) | **强耦合** (画像决定追问深度) |
| **跟项目评分关联** | 无 | **衔接** (Step 2.5 输出 → Step 3 输入) |
| **测试覆盖** | 127/127 (R115 当时) | 重新设计,**保留行为测试 + 新增画像分支测试** |

### 1.2 跟 JobPilot v1 的关系

[docs/roadmap/jobpilot/architecture.md](file:///D:/项目/简历app/docs/roadmap/jobpilot/architecture.md) 已经定义了 5 步:

| Step | 内容 | 现状 |
|------|------|------|
| 1 | 画像诊断 (5 题 → 4 种画像) | ✅ 已实现 `jobpilotAi.diagnoseProfile` |
| 2 | 项目经验提取 + 评分 | ✅ 已实现 `jobpilotAi.scoreProject` |
| 3 | 真实岗位匹配 | 🟡 部分实现 (matchService) |
| 4 | 简历生成 (调 DeepSeek) | ✅ 已实现 `resumeGenerator.generate` |
| 5 | 投递追踪 + 面试准备 | 🟡 部分实现 (openapi 中) |

**问题**: 5 步里**没有"对话建简历"步骤**。简历生成 (Step 4) 依赖结构化表单输入,但表单字段是 R115 那套硬编码。

**R-JobPilot-v2 解决方案**: **插入 Step 2.5** —— 5-8 轮对话生成结构化简历 JSON,再走 Step 4 生成 Markdown 简历。

### 1.3 新 5 步流程 (含 Step 2.5)

```
Step 1   画像诊断 (jobpilotAi.diagnoseProfile)
            ↓ 输出: {image, confidence, recommendedJobs, resumeStrategy}
Step 2.5 🆕 对话建简历 (chatBuildService) ← 本次新增
            ↓ 输入: 画像 + 已答字段
            ↓ 输出: 完整简历 JSON
            ↓ 复用: resumeTemplate.js 字段定义
Step 2   项目评分 (jobpilotAi.scoreProject)
            ↓ 输入: 简历 JSON 中的 projects[]
            ↓ 输出: 1-10 分 + STAR 故事点
Step 3   岗位匹配 (matchService)
            ↓ 输入: 画像 + 简历 JSON
            ↓ 输出: 匹配度 1-10 分 + 推荐岗位
Step 4   简历生成 (resumeGenerator.generate)
            ↓ 输入: 简历 JSON
            ↓ 输出: Markdown 简历 + STAR
Step 5   投递追踪 + 面试准备
```

---

## 2. 核心设计

### 2.1 对话状态机

```
session.start
   ↓
[问第 1 个字段 - 基于画像决定] → user.answer → session.record
   ↓
[画像 + 已答字段 + 当前轮数] → [追问策略决策 (规则引擎)]
   ↓
[问下一字段] → user.answer → ...
   ↓
[轮数达到画像推荐轮数 OR 必填字段已填] → session.complete
   ↓
输出完整简历 JSON → 触发 Step 2 (项目评分) + Step 4 (简历生成)
```

### 2.2 追问深度规则 (基于画像)

**4 种画像 + 追问策略**:

| 画像 | 追问轮数 | 重点追问字段 | 追问深度规则 |
|------|----------|--------------|--------------|
| `ai_collaboration_project_lead` (AI 协作式项目负责人) | 6-8 轮 | **AI 协作细节**、**量化结果**、最有成就感项目 | 必问"用了什么 AI 工具" + "Prompt 怎么设计" + "效率提升 X%" |
| `traditional_cs_fresh` (传统 CS 应届) | 5-6 轮 | 技术栈深度、算法理解、课程项目 | 必问"用了什么算法" + "复杂度多少" + "能讲讲实现细节吗" |
| `career_transition` (转型) | 7-8 轮 | **过往行业经验**、**可迁移技能** | 必问"之前行业最大的洞察" + "哪些能力可以迁移到 AI" |
| `algorithm_research` (算法/研究) | 5-6 轮 | 研究方向、论文、竞赛 | 必问"研究方向" + "发表论文" + "竞赛奖项" |

**追问触发规则** (通用,所有画像适用):
- 用户回答 < 10 字 → 追问"能具体说说吗?"
- 用户回答提到 % / 倍 / 万 / 千 → 自动追问"这个数字是怎么算出来的"
- 用户回答提到 AI 工具 (Claude/DeepSeek/Coze/Dify) → 自动追问"Prompt 怎么设计的"
- 用户回答模糊 (无具体场景) → 追问"能给我一个具体例子吗?"

### 2.3 字段优先级排序 (基于画像)

每个画像的"必填字段" + "可选字段" 不同:

```js
// chatBuildService.js
const FIELD_PRIORITY = {
  ai_collaboration_project_lead: {
    required: ['name', 'phone', 'projects[0].aiCollaboration', 'projects[0].result', 'skills'],
    optional: ['education.detail', 'work.detail', 'certificates'],
  },
  traditional_cs_fresh: {
    required: ['name', 'phone', 'education.detail', 'projects[0].techStack', 'skills'],
    optional: ['aiCollaboration', 'certificates'],
  },
  career_transition: {
    required: ['name', 'phone', 'work[0].industry', 'work[0].transferable', 'projects[0].story'],
    optional: ['certificates', 'aiCollaboration'],
  },
  algorithm_research: {
    required: ['name', 'phone', 'education.research', 'projects[0].algorithm', 'publications'],
    optional: ['certificates'],
  },
};
```

---

## 3. Prompt 模板 (核心交付物)

### 3.1 完整 Prompt

**存放在 `prompts` 表** (`code = 'chat_build_next_question'`, 跟现有 `resume_generate` 模式一致, 支持热更新):

```markdown
# 角色定义
你是 AI 简历面试官,正在帮候选人通过 5-8 轮对话建简历。

候选人画像 (基于 Step 1 诊断结果):
- 学历: {{education}}
- AI 能力: {{aiAbility}}
- 项目经验摘要: {{projectsSummary}}
- 目标: {{target}}
- 时间: {{timeline}}
- 画像分类: {{image}}  # ai_collaboration_project_lead / traditional_cs_fresh / career_transition / algorithm_research
- 推荐追问轮数: {{recommendedRounds}}
- 重点追问维度: {{priorityFields}}
- 简历策略: {{resumeStrategy}}

# 简历字段清单 (按画像优先级排)
{{#each fields}}
- {{fieldId}}: {{fieldLabel}} ({{priority}}: required | optional)
{{/each}}

# 对话历史
{{conversationHistory}}
# 格式: [{fieldId, question, answer, extractedFields}, ...]

# 当前状态
- 当前字段: {{currentFieldId}} ({{currentFieldLabel}})
- 当前值: {{currentValue}}
- 剩余必填字段: {{remainingRequiredFields}}
- 当前轮数: {{currentRound}} / {{recommendedRounds}}

# 任务
像面试官一样问 1 个具体问题,帮候选人把这字段填好。
- nextQuestion: 1 个具体问题 (≤30 字,直接发给候选人)
- hint: 1 个简短提示 (≤20 字,作为 placeholder 提示)
- isComplete: 当前字段是否已完成 (true = 字段填好可以跳下一个)
- extractedFields: 从用户回答中提取的所有字段值 (key-value)
- nextFieldId: 下一个要问的字段 ID (基于画像优先级)

# 画像定制追问规则

## 如果画像是 ai_collaboration_project_lead (AI 协作式项目负责人):
- 必问"你用了哪些 AI 工具?Prompt 怎么设计?"
- 必问"有没有量化结果?效率提升 X% / 节省 X 小时?"
- 项目描述里提到 Claude/DeepSeek/Coze/Dify → 自动追问"协作的具体流程"

## 如果画像是 traditional_cs_fresh (传统 CS 应届):
- 必问"这个项目用了什么算法?复杂度多少?"
- 必问"能讲讲实现细节吗?"
- 课程项目 → 追问"这个项目的难点在哪?"

## 如果画像是 career_transition (转型):
- 必问"之前行业最大的洞察是什么?"
- 必问"哪些能力可以迁移到 AI 应用?"
- 项目经验少 → 追问"过往哪些工作可以体现'会用 AI 工具'?"

## 如果画像是 algorithm_research (算法/研究):
- 必问"研究方向是什么?"
- 必问"发表过论文吗?竞赛奖项?"
- 项目偏研究 → 追问"这个算法的创新点在哪?"

# 通用追问规则
- 用户回答 < 10 字 → 追问"能具体说说吗?"
- 用户回答提到 % / 倍 / 万 / 千 → 自动追问"这个数字是怎么算出来的"
- 用户回答提到 AI 工具 → 自动追问"Prompt 怎么设计的"
- 用户回答模糊 (无具体场景) → 追问"能给我一个具体例子吗?"
- 用户回答"不知道" → 给一个示例回答帮用户开口

# 输出格式 (严格 JSON)
{
  "nextQuestion": "你用了哪些 AI 工具协作完成这个项目?",
  "hint": "例如 Claude、DeepSeek、Coze 等",
  "isComplete": true,
  "extractedFields": {
    "projects[0].aiCollaboration": "用 Claude 协作完成 80% 代码,我做 review 和测试",
    "projects[0].promptStrategy": "设计 3 轮 Prompt: 需求拆解 → 代码生成 → 测试验证"
  },
  "nextFieldId": "projects[0].result"
}
```

### 3.2 追问示例 (10 个,覆盖 4 种画像)

#### AI 协作式项目负责人画像

```
轮 1 (开场):
Q: 你好!我看你简历 app 项目用了 DeepSeek LLM,能跟我说说你具体怎么协作的吗?
A: 用 Claude 帮我写代码,我做需求拆解和测试

轮 2 (追问 AI 协作细节):
Q: 你提到"Claude 帮你写代码",能给我一个具体场景吗?比如最难的一个 bug?
A: 有一次 DeepSeek 输出格式不对,Claude 帮我设计了 JSON retry 机制

轮 3 (追问量化结果):
Q: 这个 JSON retry 机制效果怎么样?有没有数据?
A: retry 3 次后成功率从 70% 提到 95%

轮 4 (追问 Prompt 设计):
Q: 你跟 Claude 协作时,Prompt 是怎么设计的?有模板吗?
A: 我设计了 3 段式 Prompt: 角色设定 + 任务约束 + 输出格式

轮 5 (STAR 引导):
Q: 这个 Prompt 模板效果怎么样?能讲讲一个真实案例吗?
A: 用在简历生成场景,生成质量提升 30%

轮 6 (确认完成):
Q: 我看你这个项目的核心 AI 协作故事已经很清楚了,可以进入下一个环节吗?
A: 可以
```

#### 传统 CS 应届画像

```
轮 1 (开场):
Q: 你好!看你是 CS 背景,能跟我说说你最有技术含量的项目吗?
A: 课程里做过一个 LRU 缓存

轮 2 (追问算法):
Q: LRU 缓存的核心算法是什么?时间复杂度多少?
A: 哈希表 + 双向链表,O(1) 查找

轮 3 (追问实现):
Q: 双向链表这块有遇到什么坑吗?能讲讲实现细节?
A: 节点删除时要更新 prev/next 指针,边界条件容易错

轮 4 (追问量化):
Q: 这个项目有实际应用吗?性能数据怎么样?
A: 在 XX 系统里用,查询性能提升 40%

轮 5 (确认完成):
Q: 技术深度这块讲得很清楚,还有其他想补充的吗?
A: 没有
```

#### 转型画像

```
轮 1 (开场):
Q: 你好!看你是从 XX 行业转过来的,能跟我说说之前行业的核心洞察吗?
A: 我之前做电商运营,最深的洞察是"流量 ≠ 转化"

轮 2 (追问可迁移):
Q: 这个洞察能迁移到 AI 应用吗?能举个例子吗?
A: 我做了 AI 内容生成工具,帮用户生成"高转化文案"而不是"高曝光文案"

轮 3 (追问量化):
Q: 这个工具有用户数据吗?转化率提升多少?
A: 内测 100 个用户,平均转化率提升 25%

轮 4 (追问 AI 协作):
Q: 这个工具用了哪些 AI 工具协作完成?
A: Claude 设计 Prompt,我做业务策略

轮 5 (确认完成):
Q: 转型故事讲得很清楚,可以进入下一步吗?
A: 可以
```

#### 算法/研究画像

```
轮 1 (开场):
Q: 你好!看你是算法方向,能跟我说说你的研究方向吗?
A: 主要做 NLP,具体是文本生成

轮 2 (追问算法):
Q: 这个方向的核心算法是什么?有发表论文吗?
A: 基于 Transformer 的生成模型,有 1 篇 ACL 一作

轮 3 (追问项目):
Q: 能讲讲一个最有挑战的项目吗?
A: 做过一个低资源语言生成,用 prompt tuning

轮 4 (追问量化):
Q: 这个项目效果怎么样?有数据吗?
A: 在 3 个低资源语言上 BLEU 提升 5-8 分

轮 5 (确认完成):
Q: 研究经历讲得很清楚,可以进入下一步吗?
A: 可以
```

---

## 4. 推翻 vs 复用 vs 新增

### 4.1 推翻清单 (删除)

| 模块 | 文件/位置 | 删除原因 |
|------|-----------|----------|
| **R115 Wizard 主动提问** | `backend/src/routes/ai.js` (`/assist-field?mode=wizard`) | 被 chatBuildService 取代 |
| **R115 Wizard 前端 modal** | `mini-program/.../wizard*` | 同上 |
| **R114 ai-suggestion-chip 旧 UI** | `mini-program/.../assist-mode` | 不再需要 (chatBuild 是新的) |
| **R116 抖音大屏竖滑** | `mini-program/.../bigscreen*` | 不符合"AI 求职助手"定位 |
| **R117 Tinder 划卡** | `mini-program/.../tinder*` | 同上 |
| **R118 技能雷达图** | `mini-program/.../radar*` | 不实用 |
| **R120 AI 头像** | `mini-program/.../avatar*` | 装饰性,无功能价值 |
| **R98-R122 装饰动画** | 流星/星云/旋转/庆祝/脉冲 | 同上 |

### 4.2 复用清单 (不动)

| 模块 | 文件 | 复用方式 |
|------|------|----------|
| DeepSeek LLM 客户端 | `backend/src/services/llm.js` | chatBuildService 直接 require |
| 简历生成 Prompt 加载 | `backend/src/services/resumePrompt.js` | 改造成支持多种 code (`resume_generate` / `chat_build_next_question`) |
| 简历生成器 | `backend/src/services/resumeGenerator.js` | Step 4 直接复用 |
| 简历模板渲染 | `backend/src/services/resumeTemplate.js` | chatBuild 输出 JSON 字段映射到模板 |
| 画像诊断 | `backend/src/services/jobpilotAi.js` `diagnoseProfile` | Step 1 直接调用 |
| 项目评分 | `backend/src/services/jobpilotAi.js` `scoreProject` | Step 2 直接调用 |
| JWT 鉴权 | `backend/src/middleware/auth.js` | chatBuild route 直接用 |
| 永久 token | `backend/src/services/token.js` | 同上 |
| 配额系统 | Redis Lua 原子扣减 | chatBuild 加 `quotaCode='chat_build'` |
| 限流中间件 | `backend/src/services/rateLimit.js` | chatBuild route 加 IP 限流 |
| CI/CD | `.github/workflows/` | 同 R115 模式 |
| 测试框架 | `backend/tests/` `node:test` | 同 R115 模式 (127/127 保留) |

### 4.3 新增清单

| 模块 | 文件 | 说明 |
|------|------|------|
| 对话建简历 service | `backend/src/services/chatBuildService.js` | 核心 service (状态机 + 追问深度规则) |
| 对话建简历 Prompt | `backend/src/services/chatBuildPrompt.js` | 从 `prompts` 表加载 `chat_build_next_question` |
| 对话历史表 | `chat_build_sessions` (DB) | 存会话状态 (userId / round / answeredFields / currentFieldId) |
| JobPilot v1 路由 | `backend/src/routes/jobpilot.js` | 拆分为 v1 子路由 |
| 子路由 | `/api/jobpilot/v1/chat-build/start` / `/next` / `/complete` | 3 个新 route |
| 前端模块 | `mini-program/jobpilot/chat-build/` | 对话 UI (基于画像显示追问深度) |
| 前端状态管理 | `mini-program/jobpilot/chat-build/state.js` | 对话状态机 |

---

## 5. 数据模型

### 5.1 chat_build_sessions 表

```sql
CREATE TABLE chat_build_sessions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id VARCHAR(64) NOT NULL,
  image VARCHAR(64) NOT NULL,              -- 画像分类
  recommended_rounds INT NOT NULL,         -- 推荐轮数
  current_round INT DEFAULT 0,             -- 当前轮数
  current_field_id VARCHAR(128),           -- 当前字段 ID
  answered_fields JSON,                    -- 已答字段 [{fieldId, question, answer, extractedFields}]
  conversation_history JSON,               -- 对话历史 [{role, content, ts}]
  status VARCHAR(32) DEFAULT 'active',     -- active / completed / abandoned
  result JSON,                             -- 最终简历 JSON (complete 时填充)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at DATETIME,
  INDEX idx_user_status (user_id, status),
  INDEX idx_status_updated (status, updated_at)
);
```

### 5.2 简历 JSON 字段映射

**chatBuildService 输出的简历 JSON 字段** 跟 `resumeTemplate.js` 渲染字段一致:

```js
// 简历 JSON 顶层结构
{
  name: string,
  gender: string,
  degree: string,                          // 学历
  phone: string,
  educations: [{ school, start, end, major, degree }],
  experiences: [{ company, title, start, end, desc }],
  expected: { city, position, salary_min, salary_max },
  skills: string[],
  projects: [{
    name, techStack, aiCollaboration, myRole, url,
    result, promptStrategy                  // 新增字段 (R-JobPilot-v2)
  }],
  certificates: [{ name, issuer, date }],  // 新增字段
  publications: [{ title, venue, date }],   // 新增字段 (算法画像)
  storyPoints: [{ title, situation, task, action, result }]  // 复用 resumeGenerator 输出
}
```

---

## 6. API 设计

### 6.1 POST /api/jobpilot/v1/chat-build/start

**请求**:
```json
{
  "image": "ai_collaboration_project_lead",  // 来自 Step 1
  "answers": { /* 5 题答案 */ }
}
```

**响应**:
```json
{
  "sessionId": "cb_abc123",
  "image": "ai_collaboration_project_lead",
  "recommendedRounds": 7,
  "priorityFields": ["projects[0].aiCollaboration", "projects[0].result", ...],
  "firstQuestion": "你用了哪些 AI 工具协作完成这个项目?",
  "hint": "例如 Claude、DeepSeek、Coze 等",
  "currentFieldId": "projects[0].aiCollaboration"
}
```

### 6.2 POST /api/jobpilot/v1/chat-build/next

**请求**:
```json
{
  "sessionId": "cb_abc123",
  "userAnswer": "用 Claude 帮我写代码,我做需求拆解和测试"
}
```

**响应**:
```json
{
  "isComplete": false,
  "nextQuestion": "能给我一个具体场景吗?比如最难的一个 bug?",
  "hint": "例如 Claude 帮你定位 bug 的过程",
  "extractedFields": {
    "projects[0].aiCollaboration": "用 Claude 帮我写代码,我做需求拆解和测试"
  },
  "nextFieldId": "projects[0].aiCollaboration.detail",
  "currentRound": 2,
  "remainingRounds": 5
}
```

### 6.3 POST /api/jobpilot/v1/chat-build/complete

**触发条件**: `currentRound >= recommendedRounds` 或所有 required 字段已填。

**请求**:
```json
{
  "sessionId": "cb_abc123"
}
```

**响应**:
```json
{
  "status": "completed",
  "resumeJson": { /* 完整简历 JSON */ },
  "storyPoints": [/* STAR 故事点 */],
  "nextStep": "project_score"  // 触发 Step 2 (项目评分)
}
```

---

## 7. 前端设计

### 7.1 mini-program/jobpilot/chat-build/ 结构

```
mini-program/jobpilot/chat-build/
├── index.wxml              # 主页面 (对话 UI)
├── index.wxss              # 样式
├── index.js                # 状态机 + API 调用
├── components/
│   ├── question-card/      # 问题卡片
│   ├── answer-input/       # 答案输入
│   ├── progress-bar/       # 进度条 (currentRound / recommendedRounds)
│   └── image-badge/        # 画像标签 (显示当前画像)
└── utils/
    ├── state-machine.js    # 客户端状态机
    └── api.js              # API 调用封装
```

### 7.2 UI 关键交互

```
┌─────────────────────────────────┐
│ 🏷️ AI 协作式项目负责人         │  ← 画像标签
│                                 │
│ ████████░░░░░ 3 / 7            │  ← 进度条
│                                 │
│ ┌─────────────────────────────┐ │
│ │ AI 面试官:                  │ │
│ │ 你用了哪些 AI 工具协作完成  │ │
│ │ 这个项目?                    │ │
│ │                              │ │
│ │ 💡 例如 Claude、DeepSeek 等  │ │
│ └─────────────────────────────┘ │
│                                 │
│ ┌─────────────────────────────┐ │
│ │ [答案输入框]                │ │
│ │                              │ │
│ └─────────────────────────────┘ │
│                                 │
│      [下一问 →]                 │
└─────────────────────────────────┘
```

---

## 8. 实施路线 (4 周)

### Week 1: 架构 + 数据模型
- [ ] 创建 `chat_build_sessions` 表 (DB migration)
- [ ] 改造 `resumePrompt.js` 支持多 code (`chat_build_next_question`)
- [ ] 拆 `jobpilot.js` route 为 v1 子路由
- [ ] 集成测试 (DB + route)

### Week 2: 对话建简历核心 + Prompt
- [ ] `chatBuildService.js` (状态机 + 追问深度规则引擎)
- [ ] `chatBuildPrompt.js` (从 prompts 表加载)
- [ ] 4 种画像的追问深度规则
- [ ] 单元测试 10+ 个 (每个画像 2-3 个 + 通用追问规则 2 个)
- [ ] e2e smoke 3 个 (start/next/complete)

### Week 3: 前端重做 + 推翻旧 UI
- [ ] 删除 R115/R116/R117/R118/R120 文件
- [ ] 新建 `mini-program/jobpilot/chat-build/` UI
- [ ] 跟画像诊断 + 项目评分页面衔接
- [ ] 前端单测 (mini-program 套件)

### Week 4: 联调 + 上线
- [ ] 端到端测试 (5 步流程全跑通)
- [ ] npm test 全绿 (127+ 新测试)
- [ ] 部署到 43.139.176.199:443
- [ ] Sentry / 监控配置
- [ ] 用户反馈收集 (首周)

---

## 9. 测试策略

### 9.1 单元测试 (10+ 个)

| 测试 | 覆盖点 |
|------|--------|
| `chatBuildService.test.js#start` | start 创建 session + 返回 firstQuestion |
| `chatBuildService.test.js#next-ai-collab` | AI 协作画像追问 AI 协作细节 |
| `chatBuildService.test.js#next-cs-fresh` | 传统 CS 画像追问算法 |
| `chatBuildService.test.js#next-career-transition` | 转型画像追问过往行业 |
| `chatBuildService.test.js#next-algorithm` | 算法画像追问研究方向 |
| `chatBuildService.test.js#next-quantify` | 回答含 % / 倍 / 万 → 追问量化 |
| `chatBuildService.test.js#next-ai-tool` | 回答含 AI 工具 → 追问 Prompt |
| `chatBuildService.test.js#next-vague` | 回答模糊 → 追问具体例子 |
| `chatBuildService.test.js#complete-rounds` | 达到推荐轮数 → complete |
| `chatBuildService.test.js#complete-required` | 必填字段填完 → complete |

### 9.2 e2e (3 个)

| 测试 | 场景 |
|------|------|
| `chatBuild.e2e.test.js#full-ai-collab` | AI 协作画像全流程 (7 轮 → complete → resume) |
| `chatBuild.e2e.test.js#full-career-transition` | 转型画像全流程 (8 轮 → complete → resume) |
| `chatBuild.e2e.test.js#interrupted-recovery` | 用户中断 → 重新进入 → 恢复对话 |

### 9.3 回归测试

- [ ] 现有 127/127 测试**全部保留并通过** (除被推翻的 R115 测试)
- [ ] R115 测试标记为 `skipped` (注明被 R-JobPilot-v2 取代)
- [ ] jobpilotAi.test.js 测试保留 (画像诊断 + 项目评分不动)
- [ ] resumeGenerator.test.js 测试保留 (Step 4 复用)

---

## 10. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 推翻 R115 测试覆盖丢失 | 短期测试覆盖率下降 | Week 1 同步写新测试,保持 127+ 量级 |
| 前端推翻工作量被低估 | Week 3 可能延期 | Week 3 D1 先做"删除清单"评估真实工作量 |
| DeepSeek API 成本上升 | 5-8 轮对话 = 5-8 次 LLM 调用 | 加 Redis 配额 (每天 5 次免费对话) |
| 追问深度规则不够智能 | 用户体验差 | Week 4 收集真实用户反馈 → 迭代 Prompt |
| 中断恢复实现复杂 | Week 2 工作量上升 | 用 `chat_build_sessions` 表 + 简单状态恢复,不做"撤销" |
| JobPilot v1 其他步骤未完成 | 5 步流程跑不通 | Step 1 + 2.5 + 4 优先做完,Step 2/3/5 保留现有占位 |

---

## 11. 交付物清单

### Week 1 交付
- `docs/roadmap/jobpilot-v2-chat-build.md` (本文档)
- `backend/db/migrations/chat_build_sessions.sql`
- `backend/src/routes/jobpilot.js` (拆分 v1 子路由)

### Week 2 交付
- `backend/src/services/chatBuildService.js`
- `backend/src/services/chatBuildPrompt.js`
- `backend/src/services/prompts/chat_build_next_question.md` (新增 Prompt)
- `backend/tests/chatBuildService.test.js` (10+ 单测)
- `backend/tests/chatBuild.e2e.test.js` (3 e2e)

### Week 3 交付
- `mini-program/jobpilot/chat-build/` (完整 UI 模块)
- 删除 R115/R116/R117/R118/R120 文件清单 + commit
- `mini-program/tests/chatBuild.test.js`

### Week 4 交付
- npm test 全绿 (127+ 新测试)
- 上线 43.139.176.199:443
- README 更新 (JobPilot v2 流程图)
- CHANGELOG (R-JobPilot-v2 变更)

---

## 12. 关键决策记录

| # | 决策 | 原因 | 日期 |
|---|------|------|------|
| 1 | 走 JobPilot v1 + 新增 Step 2.5 | 跟架构文档对齐,5 步变 5+0.5 步而非独立新流程 | 2026-08-02 |
| 2 | 推翻 R115 而非并存 | 用户授权全栈重构;并存会引入代码冗余 | 2026-08-02 |
| 3 | 追问深度基于画像规则引擎 | 4 种画像 × 必填字段不同,差异化体验 | 2026-08-02 |
| 4 | Prompt 存数据库 (代码化) | 跟现有 `resume_generate` 一致,支持热更新 | 2026-08-02 |
| 5 | 对话历史存 DB (支持中断恢复) | 用户体验更好,不丢数据 | 2026-08-02 |
| 6 | 不收付费 + 加 Redis 配额 (每天 5 次) | 用户已确认先不做付费,配额是工程必需 | 2026-08-02 |
| 7 | 复用 jobpilotAi.js (纯规则) | 画像诊断 + 项目评分是纯规则,不动 | 2026-08-02 |
| 8 | 复用 resumeTemplate.js 字段映射 | chatBuild 输出 JSON 字段跟现有模板一致 | 2026-08-02 |