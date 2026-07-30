# Phase 5 — 岗位匹配 设计文档

> 日期：2026-06-29
> 阶段：5 / 8（匹配核心）
> 前置：[Phase 4 design](../specs/2026-06-28-简历推荐小程序-phase4-design.md)
> 状态：设计评审通过

---

## §1 目标与验收

### 目标

用户生成简历 → 点「找岗位」→ 后端粗筛 + LLM 精排 top 5 → 列表页展示 + 详情页。

### 验收标准

| # | 验收项 | 通过条件 |
|---|--------|----------|
| 1 | 首页按钮 | 生成简历后显示「找岗位」 |
| 2 | 触发匹配 | loading 3 段（复用 `utils/loading.js`）|
| 3 | 列表展示 | 5 个岗位：title/company/city/salary + score + reason |
| 4 | 详情页 | 点列表项 → description_md + skills |
| 5 | 24h 缓存 | 同 batch 24h 内重进直接返，不调 LLM |
| 6 | 粗筛 0 结果 | 友好空状态「暂未找到匹配岗位」 |
| 7 | 限流 | 4/min，第 5 次 429 |
| 8 | LLM 失败 | 502 友好提示 |
| 9 | 测试 | 后端新增 ≥ 20，前端新增 ≥ 4 |
| 10 | 服务器部署 | 真机可走匹配流程 |

---

## §2 后端改动

### 2.1 新增 service

#### `services/jobFilter.js`（粗筛纯函数）

```js
function coarseFilter(jobs, userForm) {
  const userCity = userForm.expected?.city;
  const uMin = userForm.expected?.salary_min || 0;
  const uMax = userForm.expected?.salary_max || 0;

  return jobs.filter(j => {
    if (userCity && j.city !== userCity) return false;
    // 薪资宽：job.salary_min <= user.salary_max * 1.5 AND job.salary_max >= user.salary_min * 0.8
    if (uMax > 0 && j.salary_min > uMax * 1.5) return false;
    if (uMin > 0 && j.salary_max < uMin * 0.8) return false;
    return true;
  });
}

module.exports = { coarseFilter };
```

#### `services/matchPrompt.js`（读 match_rerank prompt + 占位符替换）

```js
const pool = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

async function build(resumeContent, jobs) {
  const [rows] = await pool.query(
    "SELECT content FROM prompts WHERE code = 'match_rerank' AND is_active = 1 LIMIT 1"
  );
  if (!rows.length) throw new AppError(1200, 'match_rerank prompt not configured', 500);

  const jobsJson = JSON.stringify(jobs.map(j => ({
    job_id: j.id, title: j.title, company: j.company, city: j.city,
    salary_min: j.salary_min, salary_max: j.salary_max,
    degree_required: j.degree_required, experience_required: j.experience_required,
    skills_required: j.skills_required,
  })), null, 2);

  // 模板示例：「你是资深HR，简历：{resume} 岗位：{jobs} 严格JSON输出」
  const fullPrompt = rows[0].content
    .replace('{resume}', resumeContent)
    .replace('{jobs}', jobsJson);

  return {
    system: '你是专业的岗位匹配专家，严格按要求的 JSON 格式输出结果。',
    user: fullPrompt,
  };
}

module.exports = { build };
```

#### `services/matchService.js`（两阶段匹配 + 缓存 + 校验）

```js
const pool = require('../config/db');
const redis = require('../config/redis');
const rateLimit = require('./rateLimit');
const { coarseFilter } = require('./jobFilter');  // 兜底 JS 校验
const { build: buildPrompt } = require('./matchPrompt');
const llm = require('./llm');

// 学历排序（宽松匹配：用户学历 >= 岗位要求）
const DEGREE_RANK = { '不限': 0, '高中': 1, '大专': 2, '本科': 3, '硕士': 4, '博士': 5 };

async function match(userId, resumeId) {
  // 1. 取 resume
  const [rows] = await pool.query(
    'SELECT id, source_form, content_md FROM resumes WHERE id = ? AND user_id = ? LIMIT 1',
    [resumeId, userId]
  );
  if (!rows.length) throw new AppError(1004, 'resume not found', 404);
  const resume = rows[0];
  const sourceForm = typeof resume.source_form === 'string'
    ? JSON.parse(resume.source_form)
    : resume.source_form;

  // 2. 限流（缓存命中由路由层短路，这里只算真实 LLM 调用）
  const rl = await rateLimit.check(`match:${userId}`, 4, 60);
  if (!rl.allowed) throw new AppError(1429, '请求过于频繁，请稍后再试', 429);

  // 3. SQL 下推粗筛（city + salary 宽 + 学历宽松 + 经验粗匹配）
  const userCity = sourceForm.expected?.city || '';
  const uMin = sourceForm.expected?.salary_min || 0;
  const uMax = sourceForm.expected?.salary_max || 0;
  const userDegreeRank = DEGREE_RANK[sourceForm.degree] || 0;

  const sqlFilters = ['is_online = 1', 'is_deleted = 0'];
  const sqlParams = [];
  if (userCity) {
    sqlFilters.push('city = ?');
    sqlParams.push(userCity);
  }
  if (uMax > 0) {
    sqlFilters.push('salary_min <= ?');
    sqlParams.push(uMax * 1.5);
  }
  if (uMin > 0) {
    sqlFilters.push('salary_max >= ?');
    sqlParams.push(uMin * 0.8);
  }
  // 学历宽松：job.degree_required rank <= user.degree rank OR 不限
  sqlFilters.push(`(degree_required = '不限' OR (${userDegreeRank} >= COALESCE(NULLIF(${userDegreeRank}, 0), 0) AND ${userDegreeRank} >= CASE degree_required
    WHEN '不限' THEN 0 WHEN '高中' THEN 1 WHEN '大专' THEN 2 WHEN '本科' THEN 3 WHEN '硕士' THEN 4 WHEN '博士' THEN 5 ELSE 0 END))`);

  const [candidates] = await pool.query(
    `SELECT id, title, company, city, salary_min, salary_max, degree_required, experience_required, skills_required
     FROM jobs WHERE ${sqlFilters.join(' AND ')}
     ORDER BY sort_weight DESC, id ASC LIMIT 10`,
    sqlParams
  );

  // JS 兜底再 filter 一遍（确保 top 5 干净）
  const filtered = coarseFilter(candidates, sourceForm).slice(0, 5);

  if (!filtered.length) {
    return { results: [], batch_id: null, message: '暂未找到匹配岗位' };
  }

  // 4. LLM 精排
  const batchId = `match_${Date.now()}_${userId}_${resumeId}`;
  const { system, user } = await buildPrompt(resume.content_md, filtered);
  const llmResp = await llm.chatJson(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    { maxTokens: 1500, temperature: 0.5 }
  );

  // 5. 结果校验 + 排序
  const validJobIds = new Set(filtered.map(j => j.id));
  const validResults = (llmResp.parsed.results || [])
    .filter(r => validJobIds.has(r.job_id))
    .filter(r => typeof r.score === 'number' && r.score >= 0 && r.score <= 100)
    .map(r => ({ job_id: r.job_id, score: Math.round(r.score), reason: String(r.reason || '').slice(0, 60) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  // 6. 写 matches 表
  if (validResults.length) {
    const values = validResults.map(r => [userId, resumeId, r.job_id, batchId, r.score, r.reason]);
    await pool.query(
      'INSERT INTO matches (user_id, resume_id, job_id, match_batch_id, score, reason) VALUES ?',
      [values]
    );
  }

  // 7. 缓存 batch_id (24h)
  await redis.set(`match:batch:${userId}:${resumeId}`, batchId, 'EX', 24 * 3600);

  // 8. 关联 job 详情
  const jobMap = new Map(filtered.map(j => [j.id, j]));
  const enriched = validResults
    .map(r => {
      const j = jobMap.get(r.job_id);
      if (!j) return null;
      return {
        job_id: j.id, title: j.title, company: j.company, city: j.city,
        salary_min: j.salary_min, salary_max: j.salary_max,
        score: r.score, reason: r.reason,
      };
    })
    .filter(Boolean);

  return { results: enriched, batch_id: batchId };
}

// 24h 复用
async function checkCache(userId, resumeId) {
  const batchId = await redis.get(`match:batch:${userId}:${resumeId}`);
  if (!batchId) return null;

  const [rows] = await pool.query(
    `SELECT m.job_id, m.score, m.reason, j.title, j.company, j.city, j.salary_min, j.salary_max
     FROM matches m JOIN jobs j ON j.id = m.job_id
     WHERE m.match_batch_id = ? AND m.user_id = ?
     ORDER BY m.score DESC LIMIT 5`,
    [batchId, userId]
  );
  if (!rows.length) return null;
  return {
    results: rows.map(r => ({
      job_id: r.job_id, title: r.title, company: r.company, city: r.city,
      salary_min: r.salary_min, salary_max: r.salary_max,
      score: r.score, reason: r.reason,
    })),
    batch_id: batchId,
    cached: true,
  };
}

module.exports = { match, checkCache };
```

### 2.2 新增 routes

#### `routes/match.js`

```js
const express = require('express');
const router = express.Router();
const { userAuth } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const matchService = require('../services/matchService');

router.post('/', userAuth, async (req, res, next) => {
  try {
    const { resume_id } = req.body;
    if (!resume_id) throw new AppError(1000, 'resume_id required', 400);

    // 先查缓存（命中不扣限流）
    const cached = await matchService.checkCache(req.user.userId, resume_id);
    if (cached) return res.json({ code: 0, data: cached });

    // 缓存未命中 → 真实 LLM 调用 → 扣限流
    const result = await matchService.match(req.user.userId, resume_id);
    res.json({ code: 0, data: result });
  } catch (err) { next(err); }
});

module.exports = router;
```

#### `routes/jobs.js`（详情接口）

```js
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) throw new AppError(1000, 'invalid id', 400);
    const [rows] = await pool.query(
      `SELECT id, title, company, city, salary_min, salary_max,
              degree_required, experience_required, skills_required, description_md,
              is_online, is_deleted, created_at
       FROM jobs WHERE id = ? AND is_online = 1 AND is_deleted = 0 LIMIT 1`,
      [id]
    );
    if (!rows.length) throw new AppError(1004, 'job not found', 404);
    const j = rows[0];
    if (typeof j.skills_required === 'string') j.skills_required = JSON.parse(j.skills_required);
    res.json({ code: 0, data: j });
  } catch (err) { next(err); }
});

module.exports = router;
```

### 2.3 app.js 挂载

```js
const matchRouter = require('./routes/match');
const jobsRouter = require('./routes/jobs');
// ...
app.use('/api/match', matchRouter);
app.use('/api/jobs', jobsRouter);
```

---

## §3 前端改动

### 3.1 首页加「找岗位」按钮

`pages/index/index.wxml` 加按钮：
```xml
<view wx:if="{{hasResume}}" class="btn-primary" bindtap="goMatch">找岗位</view>
```

`pages/index/index.js` 加：
```js
goMatch() {
  wx.navigateTo({ url: '/pages/match/list' });
},
```

### 3.2 `pages/match/list` 页面

`list.js`：
```js
const { request } = require('../../utils/request');
const { loadingStages } = require('../../utils/loading');

Page({
  data: { results: [], batchId: '', loading: true, error: '', message: '' },

  onShow() { this.load(); },

  onPullDownRefresh() {
    this.load();
  },

  async load() {
    // 先取 resume_id
    try {
      const resumeRes = await request({ url: '/resume/current' });
      const resumeId = resumeRes.data.resume_id;
      this.match(resumeId);
    } catch (e) {
      this.setData({ loading: false, error: '请先生成简历' });
      wx.stopPullDownRefresh();
    }
  },

  async match(resumeId) {
    const stages = loadingStages();
    wx.showLoading({ title: stages[0].text, mask: true });
    const timer1 = setTimeout(() => wx.showLoading({ title: stages[1].text, mask: true }), stages[1].at);
    const timer2 = setTimeout(() => wx.showLoading({ title: stages[2].text, mask: true }), stages[2].at);

    try {
      const res = await request({ url: '/match', method: 'POST', data: { resume_id: resumeId } });
      wx.hideLoading();
      clearTimeout(timer1); clearTimeout(timer2);
      wx.stopPullDownRefresh();
      this.setData({
        loading: false,
        results: res.data.results,
        batchId: res.data.batch_id,
        message: res.data.message || '',
      });
    } catch (e) {
      wx.hideLoading();
      clearTimeout(timer1); clearTimeout(timer2);
      wx.stopPullDownRefresh();
      this.setData({ loading: false, error: '匹配失败，请重试' });
    }
  },

  goDetail(e) {
    const { id, score, reason } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/match/detail?id=${id}&score=${score}&reason=${encodeURIComponent(reason || '')}` });
  },

  goForm() {
    wx.navigateTo({ url: '/pages/form/form' });
  },
});
```

`list.wxml`：
```xml
<view class="container">
  <view wx:if="{{loading}}" class="card">匹配中...</view>
  <view wx:elif="{{error}}" class="card">
    <view>{{error}}</view>
    <view class="btn-primary" bindtap="goForm" style="margin-top:24rpx;">去填写简历</view>
  </view>
  <view wx:elif="{{results.length === 0}}" class="card">
    <view>{{message || '暂未找到匹配岗位'}}</view>
    <view class="label">试试调整期望城市或薪资范围</view>
    <view class="btn-primary" bindtap="goForm" style="margin-top:24rpx;">修改期望</view>
  </view>
  <view wx:else>
    <view wx:for="{{results}}" wx:key="job_id" class="card" bindtap="goDetail" data-id="{{item.job_id}}" data-score="{{item.score}}" data-reason="{{item.reason}}">
      <view style="display:flex; justify-content:space-between;">
        <view style="font-weight:bold;">{{item.title}}</view>
        <view style="font-size:36rpx; color:{{item.score >= 80 ? '#07c160' : (item.score >= 60 ? '#ff9800' : '#999')}};">{{item.score}}</view>
      </view>
      <view class="label">{{item.company}} · {{item.city}} · {{item.salary_min}}-{{item.salary_max}}K</view>
      <view wx:if="{{item.reason}}" class="label" style="margin-top:8rpx; color:#666;">💡 {{item.reason}}</view>
    </view>
  </view>
</view>
```

`list.json`（开启下拉刷新）：
```json
{
  "navigationBarTitleText": "匹配结果",
  "enablePullDownRefresh": true,
  "backgroundColor": "#f7f8fa"
}
```

### 3.3 `pages/match/detail` 页面（带 score + reason）

`detail.js`：
```js
const { request } = require('../../utils/request');
const { mdToHtml } = require('../../utils/format');

Page({
  data: { job: null, mdHtml: '', score: 0, reason: '', loading: true },

  onLoad(query) {
    this.load(query.id, query.score, query.reason);
  },

  async load(id, score, reason) {
    try {
      const res = await request({ url: `/jobs/${id}` });
      const job = res.data;
      this.setData({
        loading: false,
        job,
        score: parseInt(score || 0, 10),
        reason: decodeURIComponent(reason || ''),
        mdHtml: mdToHtml(job.description_md || ''),
      });
    } catch (e) {
      this.setData({ loading: false });
    }
  },
});
```

`detail.wxml`：
```xml
<view class="container">
  <view wx:if="{{loading}}" class="card">加载中...</view>
  <view wx:elif="{{!job}}" class="card">岗位不存在</view>
  <view wx:else>
    <view class="card" wx:if="{{score > 0}}">
      <view style="display:flex; justify-content:space-between; align-items:center;">
        <view style="font-size:36rpx; font-weight:bold;">{{job.title}}</view>
        <view style="font-size:48rpx; font-weight:bold; color:{{score >= 80 ? '#07c160' : (score >= 60 ? '#ff9800' : '#999')}};">{{score}}</view>
      </view>
      <view class="label">{{job.company}} · {{job.city}}</view>
      <view class="label">{{job.salary_min}}-{{job.salary_max}}K · {{job.degree_required}} · {{job.experience_required}}</view>
      <view wx:if="{{reason}}" class="label" style="margin-top:16rpx; color:#07c160;">💡 {{reason}}</view>
    </view>
    <view class="card" wx:else>
      <view style="font-size:36rpx; font-weight:bold;">{{job.title}}</view>
      <view class="label">{{job.company}} · {{job.city}}</view>
      <view class="label">{{job.salary_min}}-{{job.salary_max}}K · {{job.degree_required}} · {{job.experience_required}}</view>
    </view>
    <view class="card">
      <view style="font-weight:bold; margin-bottom:16rpx;">技能要求</view>
      <view class="label">{{job.skills_required.join('、')}}</view>
    </view>
    <view class="card resume-body">
      <rich-text nodes="{{mdHtml}}" />
    </view>
  </view>
</view>
```

**列表跳详情传 score+reason**：list.wxml 的 `bindtap` 改成：
```xml
<view ... bindtap="goDetail" data-id="{{item.job_id}}" data-score="{{item.score}}" data-reason="{{item.reason}}">
```
list.js 的 `goDetail`：
```js
goDetail(e) {
  const { id, score, reason } = e.currentTarget.dataset;
  wx.navigateTo({ url: `/pages/match/detail?id=${id}&score=${score}&reason=${encodeURIComponent(reason)}` });
}
```
detail.js 的 `onLoad` 改成 `onLoad(query) { this.load(query.id, query.score, query.reason); }`，load 里用 query.score / query.reason。

### 3.4 `app.json` 加 2 页

```json
{
  "pages": [
    "pages/index/index",
    "pages/form/form",
    "pages/preview/preview",
    "pages/match/list",
    "pages/match/detail"
  ]
}
```

### 3.5 `utils/constants.js`（score 颜色阈值）

```js
const SCORE_COLOR = {
  HIGH: '#07c160',   // >= 80
  MID:  '#ff9800',   // >= 60
  LOW:  '#999',      // < 60
};

function scoreColor(score) {
  if (score >= 80) return SCORE_COLOR.HIGH;
  if (score >= 60) return SCORE_COLOR.MID;
  return SCORE_COLOR.LOW;
}

module.exports = { SCORE_COLOR, scoreColor };
```

list.wxml / detail.wxml 用 `style="color:{{item.score >= 80 ? '#07c160' : ...}}"` 改成 wxs 函数引用，或 list.js / detail.js 里调 `scoreColor(score)` 算出 `color: '#xxx'` 后 setData。**简化**：list.js 里 `results` map 时附 `color` 字段：

```js
const enriched = (res.data.results || []).map(r => ({ ...r, color: require('../../utils/constants').scoreColor(r.score) }));
```

wxml 改成 `color:{{item.color}}`。

---

## §4 测试

### 4.1 后端（≥ 20）

| 文件 | case | 备注 |
|------|------|------|
| `tests/service-jobFilter.test.js` | 5 | 城市严格/薪资宽/0 结果 |
| `tests/service-matchPrompt.test.js` | 3 | 占位符替换 |
| `tests/service-matchService.test.js` | 5 | 缓存命中/未命中/限流/LLM 失败/空结果 |
| `tests/route-match.test.js` | 4 | 401/触发/历史/参数错 |
| `tests/route-jobs-detail.test.js` | 3 | 401（无 userAuth 要求，公开）/404/200 |

**注**：jobs 详情公开（任何人都能看），不加 userAuth。

### 4.2 前端（≥ 4）

| 文件 | case |
|------|------|
| `mini-program/tests/match-format.test.js` | 4（score 着色阈值 / reason 截断 / 列表过滤空结果） |

---

## §5 部署 + 启动

### 后端
- commit + push → 服务器 pull + restart

### 前端
- 开发者工具自动热重载

### 启动清单
- 无新手动项（Phase 4 admin 注册过的用户可用）

---

## §6 范围之外（YAGNI）

| 不做 | 原因 |
|------|------|
| 岗位反馈（喜欢/不喜欢） | Phase 6 加固 |
| 相似岗位推荐 | Phase 6 |
| 批量导出匹配结果 | MVP 不做 |
| 匹配历史筛选 | MVP 不做 |
| 多维度粗筛（学历/技能） | LLM 评估足够 |
| 用户没简历时手动触发匹配 | 走 `/resume/current` 404 自动引导 |

---

## §7 风险 + 缓解

| 风险 | 缓解 |
|------|------|
| 5 个 LLM 烧 token | 一次 LLM 调用评估 5 个岗位（不是 5 次） |
| 24h 缓存 + 用户改简历 | 改简历触发新 resume_id → 新 batch_id |
| LLM 失败 | 502 友好提示（Phase 3 pattern） |
| matches 表膨胀 | 不删（设计决策） |
| Redis fail-open | rateLimit 已 fail-open（Phase 3 实现） |

---

## §8 决策记录

**决策 1**：城市严格 + 薪资宽（粗筛） — 用户选
**决策 2**：top 5（LLM 精排） — 用户选
**决策 3**：matches 表 + 24h 复用（Redis 存 batch_id） — 用户选
**决策 4**：要详情页（独立 `/api/jobs/:id` + 详情页） — 用户选
**决策 5**：Redis 限流 4/min — 用户选

**决策 6**（设计选择）：jobs 详情公开（不需 userAuth） — 设计选择
**决策 7**（设计选择）：新 `routes/match.js`（不污染 resume.js） — 设计选择

**决策 8**（review 采纳）：SQL 下推粗筛（不用 JS 全量过滤） — review 采纳
**决策 9**（review 采纳）：LLM 返回结果做合法性校验（job_id in 候选 + score 0-100 + 排序 + slice 5） — review 采纳
**决策 10**（review 采纳）：matches 表 `match_batch_id` 加单独索引 — review 采纳（schema 补丁）
**决策 11**（review 采纳）：粗筛加学历宽松 + 经验粗匹配 — review 采纳
**决策 12**（review 采纳）：限流前置（缓存命中不扣限流） — review 采纳（路由先 checkCache）
**决策 13**（review 采纳）：详情页带 score + reason（query 传） — review 采纳
**决策 14**（review 采纳）：列表页下拉刷新 — review 采纳
**决策 15**（review 采纳）：空状态「修改期望」按钮 — review 采纳
**决策 16**（review 采纳）：history 接口 YAGNI（移出 Phase 5） — review 采纳

---

## §9 配套修改

### 9.1 schema.sql 增加索引（Phase 5 部署时打补丁）

```sql
-- matches 表新增索引
ALTER TABLE matches ADD INDEX idx_match_batch (match_batch_id);
```

（已有 `idx_user_resume_batch (user_id, resume_id, match_batch_id)` 复合索引，但单查 batch_id 不走复合索引前缀，加独立索引）

**jobs 表索引已够用**（schema.sql 现有）：
- `idx_online_city (is_online, is_deleted, city)` — 覆盖粗筛前 3 个条件
- `idx_salary (salary_min, salary_max)` — salary 范围
- `idx_degree (degree_required)` — 学位（但 CASE WHEN 不走索引，MVP 全扫可接受）

Phase 5 MVP 阶段不新加 jobs 复合索引（岗位 < 100，全表扫比加索引快）。Phase 6 加固期视数据量决定加 `(is_online, is_deleted, salary_min, salary_max)`。

### 9.2 经验粗匹配 SQL（暂用模糊）

Phase 5 MVP 简化处理：
- 岗位经验要求 `1-3年`：用户填 0/1/2/3/5+ 都过
- SQL 难精准表达区间，**MVP 跳过经验过滤**（靠 LLM 评分时考虑）
- 学历宽松走 SQL（学位排序）