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

#### `services/matchPrompt.js`（读 match_rerank prompt）

```js
const pool = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

async function build(resumeContent, jobs) {
  const [rows] = await pool.query(
    "SELECT content FROM prompts WHERE code = 'match_rerank' AND is_active = 1 LIMIT 1"
  );
  if (!rows.length) throw new AppError(1200, 'match_rerank prompt not configured', 500);

  const prompt = rows[0].content;
  const system = prompt.replace('{resume}', '').replace('{jobs}', '').trim();
  const user = JSON.stringify({
    resume: resumeContent,
    jobs: jobs.map(j => ({
      job_id: j.id, title: j.title, company: j.company, city: j.city,
      salary_min: j.salary_min, salary_max: j.salary_max,
      degree_required: j.degree_required, experience_required: j.experience_required,
      skills_required: j.skills_required,
    })),
  }, null, 2);

  return { system, user };
}

module.exports = { build };
```

#### `services/matchService.js`（两阶段匹配 + 缓存）

```js
const pool = require('../config/db');
const redis = require('../config/redis');
const rateLimit = require('./rateLimit');
const { coarseFilter } = require('./jobFilter');
const { build: buildPrompt } = require('./matchPrompt');
const llm = require('./llm');

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

  // 2. 限流
  const rl = await rateLimit.check(`match:${userId}`, 4, 60);
  if (!rl.allowed) throw new AppError(1429, '请求过于频繁，请稍后再试', 429);

  // 3. 粗筛
  const [allJobs] = await pool.query(
    'SELECT id, title, company, city, salary_min, salary_max, degree_required, experience_required, skills_required FROM jobs WHERE is_online = 1 AND is_deleted = 0 ORDER BY sort_weight DESC, id ASC'
  );
  const filtered = coarseFilter(allJobs, sourceForm);
  const top5 = filtered.slice(0, 5);

  if (!top5.length) {
    return { results: [], batch_id: null, message: '暂未找到匹配岗位' };
  }

  // 4. LLM 精排
  const batchId = `match_${Date.now()}_${userId}_${resumeId}`;
  const { system, user } = await buildPrompt(resume.content_md, top5);
  const llmResp = await llm.chatJson(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    { maxTokens: 1500, temperature: 0.5 }
  );

  // 5. 写 matches 表（事务外）
  const results = llmResp.parsed.results || [];
  if (results.length) {
    const values = results.map(r => [userId, resumeId, r.job_id, batchId, r.score || 0, r.reason || '']);
    await pool.query(
      'INSERT INTO matches (user_id, resume_id, job_id, match_batch_id, score, reason) VALUES ?',
      [values]
    );
  }

  // 6. 缓存 batch_id (24h)
  await redis.set(`match:batch:${userId}:${resumeId}`, batchId, 'EX', 24 * 3600);

  // 7. 关联 job 详情（title/company/city/salary）
  const jobMap = new Map(top5.map(j => [j.id, j]));
  const enriched = results
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

// 24h 复用：检查同 resume_id 最近 batch_id
async function checkCache(userId, resumeId) {
  const batchId = await redis.get(`match:batch:${userId}:${resumeId}`);
  if (!batchId) return null;

  const [rows] = await pool.query(
    `SELECT m.job_id, m.score, m.reason, j.title, j.company, j.city, j.salary_min, j.salary_max
     FROM matches m JOIN jobs j ON j.id = m.job_id
     WHERE m.match_batch_id = ? AND m.user_id = ?
     ORDER BY m.score DESC`,
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

// 历史匹配列表
async function history(userId, limit = 10) {
  const [rows] = await pool.query(
    `SELECT DISTINCT match_batch_id, MAX(created_at) AS created_at
     FROM matches WHERE user_id = ?
     GROUP BY match_batch_id ORDER BY created_at DESC LIMIT ?`,
    [userId, limit]
  );
  return rows;
}

module.exports = { match, checkCache, history };
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

    // 先检查缓存
    const cached = await matchService.checkCache(req.user.userId, resume_id);
    if (cached) {
      return res.json({ code: 0, data: cached });
    }

    const result = await matchService.match(req.user.userId, resume_id);
    res.json({ code: 0, data: result });
  } catch (err) { next(err); }
});

router.get('/history', userAuth, async (req, res, next) => {
  try {
    const history = await matchService.history(req.user.userId);
    res.json({ code: 0, data: { items: history } });
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
       FROM jobs WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!rows.length || rows[0].is_deleted) {
      throw new AppError(1004, 'job not found', 404);
    }
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
  data: { results: [], batchId: '', loading: true, error: '', stage: 0 },

  onShow() { this.load(); },

  async load() {
    // 先取 resume_id
    try {
      const resumeRes = await request({ url: '/resume/current' });
      const resumeId = resumeRes.data.resume_id;
      this.match(resumeId);
    } catch (e) {
      this.setData({ loading: false, error: '请先生成简历' });
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
      this.setData({
        loading: false,
        results: res.data.results,
        batchId: res.data.batch_id,
        message: res.data.message,
      });
    } catch (e) {
      wx.hideLoading();
      clearTimeout(timer1); clearTimeout(timer2);
      this.setData({ loading: false, error: '匹配失败，请重试' });
    }
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/match/detail?id=${id}` });
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
  </view>
  <view wx:else>
    <view wx:for="{{results}}" wx:key="job_id" class="card" bindtap="goDetail" data-id="{{item.job_id}}">
      <view style="display:flex; justify-content:space-between;">
        <view style="font-weight:bold;">{{item.title}}</view>
        <view style="font-size:36rpx; color:{{item.score >= 80 ? '#07c160' : (item.score >= 60 ? '#ff9800' : '#999')}};">{{item.score}}</view>
      </view>
      <view class="label">{{item.company}} · {{item.city}} · {{item.salary_min}}-{{item.salary_max}}K</view>
      <view wx:if="{{item.reason}}" class="label" style="margin-top:8rpx; color:#666;">{{item.reason}}</view>
    </view>
  </view>
</view>
```

### 3.3 `pages/match/detail` 页面

`detail.js`：
```js
const { request } = require('../../utils/request');
const { mdToHtml } = require('../../utils/format');

Page({
  data: { job: null, mdHtml: '', loading: true },

  onLoad(query) { this.load(query.id); },

  async load(id) {
    try {
      const res = await request({ url: `/jobs/${id}` });
      const job = res.data;
      this.setData({
        loading: false,
        job,
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
    <view class="card">
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