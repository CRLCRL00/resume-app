# Phase 3 — LLM 真生成 设计文档

> 日期：2026-06-28
> 阶段：3 / 8（简历生成）
> 前置：[Phase 2 design](../specs/2026-06-27-简历推荐小程序-phase2-design.md)
> 状态：设计评审通过

---

## §1 目标与验收

### 目标

表单 → 真调 DeepSeek LLM 生成 Markdown 简历 → 渲染预览。Redis 限流防刷、DB content_md 缓存、3 段 loading 反馈。

### 验收标准

| # | 验收项 | 通过条件 |
|---|--------|----------|
| 1 | 真机填表点「生成简历」 | 请求发到后端 `/api/resume/generate` |
| 2 | 前端 3 段 loading | 0-1s「提交中」/ 1-15s「生成中」/ >15s「生成中，首次较慢」 |
| 3 | Redis 限流 | 同一 user 1 分钟内 >4 次 → 第 5 次 429 |
| 4 | 后端真调 DeepSeek | 返回真实生成内容（不是 Phase 2 模板） |
| 5 | 写入 DB | `resumes.content_md` 真存 |
| 6 | DB 缓存命中 | 同 resume_id 第 2 次点「生成」 → 不调 LLM，直接返 |
| 7 | LLM 失败处理 | DeepSeek 不可达 → 502 + 友好错误，前端 toast |
| 8 | 测试 | 后端新增 ≥ 18，前端新增 ≥ 4，全 pass |
| 9 | 服务器部署 | 真机可走完整流程 |

---

## §2 后端改动（4 文件）

### 2.1 新增 `services/resumePrompt.js`

**职责**：从 `prompts` 表读 `code='resume_generate' is_active=1` 的模板，替换 `{user_form}` 占位符。

```js
const pool = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

async function build(sourceForm) {
  const [rows] = await pool.query(
    "SELECT content FROM prompts WHERE code = 'resume_generate' AND is_active = 1 LIMIT 1"
  );
  if (!rows.length) throw new AppError(1200, 'prompt not configured', 500);

  const promptContent = rows[0].content;
  // 整个 prompt 内容（含 # 角色 / # 任务 / # 输出格式 / # 约束）作为 system
  // {user_form} 替换后作为 user message
  const system = promptContent.replace('{user_form}', '').trim();
  const user = JSON.stringify(sourceForm, null, 2);

  return { system, user };
}

module.exports = { build };
```

**说明**：避免 system 重复（之前 hardcode 一句「资深 HR」+ seed 里也有「资深 HR」= 两次）。整个 prompt 模板作为 system，`user_form` JSON 作为 user。

### 2.2 新增 `services/rateLimit.js`

**职责**：基于 Redis `INCR` + `EXPIRE` 的滑动窗口限流。

```js
const redis = require('../config/redis');

async function check(key, limit, windowSec) {
  const r = await redis.incr(key);
  if (r === 1) {
    await redis.expire(key, windowSec);
  }
  return {
    allowed: r <= limit,
    count: r,
    remaining: Math.max(0, limit - r),
  };
}

module.exports = { check };
```

### 2.3 新增 `services/resumeGenerator.js`

**职责**：调 LLM，返 Markdown 字符串。

```js
const { build } = require('./resumePrompt');
const { chat } = require('./llm');

async function generate(sourceForm) {
  const { system, user } = await build(sourceForm);
  const result = await chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { maxTokens: 1500, temperature: 0.7 }
  );
  return result.content.trim();
}

module.exports = { generate };
```

### 2.4 改 `routes/resume.js` 的 `/generate`

**新流程**：

```js
router.post('/generate', userAuth, async (req, res, next) => {
  try {
    const { resume_id } = req.body;
    if (!resume_id) throw new AppError(1000, 'resume_id required', 400);

    const userId = req.user.userId;

    // 1. 限流
    const rl = await rateLimit.check(`generate:${userId}`, 4, 60);
    if (!rl.allowed) {
      throw new AppError(1429, '请求过于频繁，请稍后再试', 429);
    }

    // 2. 取 resume
    const [rows] = await pool.query(
      'SELECT id, source_form, content_md FROM resumes WHERE id = ? AND user_id = ? LIMIT 1',
      [resume_id, userId]
    );
    if (!rows.length) throw new AppError(1004, 'resume not found', 404);

    const row = rows[0];
    const sourceForm = typeof row.source_form === 'string'
      ? JSON.parse(row.source_form)
      : row.source_form;

    // 3. DB 缓存命中（content_md 非空 + source_form 未变）
    // 简化：content_md 非空就直接返（Phase 4 可加 source_form hash 检查）
    if (row.content_md && row.content_md.length > 0) {
      return res.json({ code: 0, data: { resume_id, content_md: row.content_md, cached: true } });
    }

    // 4. 真调 LLM
    const contentMd = await resumeGenerator.generate(sourceForm);

    // 5. 写 DB
    await pool.query('UPDATE resumes SET content_md = ? WHERE id = ?', [contentMd, resume_id]);

    res.json({ code: 0, data: { resume_id, content_md: contentMd, cached: false } });
  } catch (err) {
    next(err);
  }
});
```

**改动**：保留 `/save` 和 `/current`，**只改 `/generate`**。

**错误处理**：LLM 失败（`llm.js` 已抛 `AppError(1100, ..., 502)`）→ `next(err)` → 全局 errorHandler 返 `{code:1100, message:"llm ..."}`。

---

## §3 前端改动（2 文件）

### 3.1 `pages/form/form.js` — 3 段 loading

**改 submit 函数**：

```js
let loadingTimer1, loadingTimer2;

async submit() {
  // ... 表单校验同上 ...

  wx.showLoading({ title: '提交中...' });
  loadingTimer1 = setTimeout(() => wx.showLoading({ title: '生成中...' }), 1000);
  loadingTimer2 = setTimeout(() => wx.showLoading({ title: '生成中，首次较慢，请耐心等待' }), 15000);

  try {
    const saveRes = await request({ url: '/resume/save', method: 'POST', data: { source_form: form } });
    const resumeId = saveRes.data.resume_id;
    const genRes = await request({ url: '/resume/generate', method: 'POST', data: { resume_id: resumeId } });
    wx.hideLoading();
    clearTimeout(loadingTimer1);
    clearTimeout(loadingTimer2);
    wx.navigateTo({ url: '/pages/preview/preview' });
  } catch (e) {
    wx.hideLoading();
    clearTimeout(loadingTimer1);
    clearTimeout(loadingTimer2);
    // request.js 已经 toast 过了
  }
}
```

**新增 utils/loading.js**（纯函数，可测）：

```js
// 返 3 段时间点（ms）和文案
function loadingStages() {
  return [
    { at: 0, text: '提交中...' },
    { at: 1000, text: '生成中...' },
    { at: 15000, text: '生成中，首次较慢，请耐心等待' },
  ];
}

module.exports = { loadingStages };
```

### 3.2 `pages/preview/preview.js` — 错误兜底

**改 load 函数**：

```js
async load() {
  this.setData({ loading: true, error: false });
  try {
    const res = await request({ url: '/resume/current' });
    const contentMd = res.data.content_md || '';
    this.setData({ loading: false, error: false, contentMd, mdHtml: mdToHtml(contentMd) });
  } catch (e) {
    this.setData({ loading: false, error: true });
  }
}
```

**预览页 WXML 加错误态**：

```xml
<view wx:elif="{{error}}" class="card">
  <view>简历加载失败</view>
  <view class="btn-primary" bindtap="goForm" style="margin-top:24rpx;">去重新填写</view>
</view>
```

---

## §4 测试

### 4.1 后端（≥ 18）

| 文件 | case | 备注 |
|------|------|------|
| `tests/service-resumePrompt.test.js` | 4 | DB mock + `{user_form}` 替换 + system/user 分离 |
| `tests/service-rateLimit.test.js` | 4 | Redis INCR/EXPIRE mock |
| `tests/service-resumeGenerator.test.js` | 3 | llm mock + prompt 调用链 |
| `tests/route-resume-generate-llm.test.js` | 7 | 缓存命中/未命中/限流/LLM 成功/LLM 失败/参数错/未授权 |

**总 18 个新测试**。

### 4.2 前端（≥ 4）

| 文件 | case |
|------|------|
| `mini-program/tests/loading.test.js` | 4（loadingStages 返 3 段时间点+文案） |

### 4.3 测试模式

**Redis mock**（参考 `tests/db.test.js` 现有 pattern）：
```js
const redis = require('../src/config/redis');
require('../src/config/redis').incr = async (k) => 1;
require('../src/config/redis').expire = async (k, s) => 'OK';
```

**LLM mock**（参考 `tests/llm.test.js`）：
```js
require('../src/services/llm').chat = async () => ({ content: '# mock', usage: {...} });
```

---

## §5 部署

### 后端

- commit + push
- 服务器：`pm2 restart resume-app-backend --update-env`

### 前端

- 无服务器改动
- 开发者工具自动热重载

### 真机验收

- 真机扫码 → 填表 → 点「生成简历」→ 看 3 段 loading → 预览页显示真生成内容
- 连点 5 次「生成」→ 第 5 次 429 toast

---

## §6 范围之外（YAGNI）

| 不做 | 原因 |
|------|------|
| LLM retry | 失败直接返 502，避免雪崩；用户手动重试 |
| prompt admin 改 | Phase 4 |
| source_form hash 缓存（同表单不重跑） | Phase 4 |
| 流式输出（SSE） | Phase 6 |
| 自定义 prompt 模板（多版本切换） | Phase 4 |
| 简历导出 PDF / Markdown 下载 | MVP 不做 |

---

## §7 风险 + 缓解

| 风险 | 缓解 |
|------|------|
| LLM 慢（5-15s） | 3 段 loading + proxy_read_timeout 35s（已有） |
| DeepSeek rate limit | Redis 4/min + 用户手动重试 |
| prompt 写错 user_form | 测试覆盖占位符替换 |
| Redis 挂了 | rateLimit 返 allowed=true（fail-open）|
| LLM 返回 markdown 不完整 | 直接存 DB，前端渲染时容错（rich-text 自动忽略未闭合标签）|

---

## §8 启动清单（Phase 3 开始前）

- [x] Phase 2 真机验收（部分：模拟器跑过，真机扫码验证待补 — 不阻塞 Phase 3 实施）
- [x] 服务器 DeepSeek key 已配（Phase 1.5 验过）
- [x] `prompts` 表已有 seed（`resume_generate` 模板）

无新手动项。

---

## §9 决策记录

**决策 1**：DB content_md 缓存（不查 Redis，不查 source_form hash） — 用户选

**决策 2**：Redis INCR 限流 4/min — 用户选

**决策 3**：LLM 失败返 502，不 fallback 模板 — 用户选

**决策 4**：前端 3 段 loading 文案 — 用户选

**决策 5**：prompt 从 DB 读（每次查，Phase 4 加 cache） — 用户选