# Phase 2 — 小程序骨架 设计文档

> 日期：2026-06-27
> 阶段：2 / 8（小程序骨架）
> 前置：[Phase 0+1 验收报告](../../devlog/2026-06-27-phase1-verify.md) + [收尾 devlog](../../devlog/2026-06-27-phase1-followup.md)
> 状态：设计评审通过

---

## §1 目标与验收

### 目标

真机走通 **登录 → 表单 → 简历预览**。后端 stub 3 接口，前端原生 JS，极简 UI。

### 验收标准（来自设计文档 §5）

| # | 验收项 | 通过条件 |
|---|--------|----------|
| 1 | 真机扫开发者工具预览码 | 首页可见 |
| 2 | 首次进入自动 wx.login | 后端换 token 成功 |
| 3 | 首页「开始填写」→ 表单页 | 12+ 字段可见，教育/工作可增删 |
| 4 | 填完点「生成简历」→ loading → 预览 | Markdown 渲染 |
| 5 | 退出再进 | 跳过登录直接首页（token 持久化） |
| 6 | 后端测试 | 32 老测试全 pass，新增 stub 测试 ≥ 21 |
| 7 | 前端 utils 测试 | validate + format ≥ 10 case 全 pass |
| 8 | 代码 | 后端 commit + 前端 mini-program/ 目录 commit |

---

## §2 页面架构（4 页 + 工具）

### 决策：多页直跳（方案 A）

3 个独立页面，`wx.navigateTo` 跳转。理由：跟微信示例一致、新手友好、调试简单。

### 页面清单

| 路径 | 文件 | 用途 |
|------|------|------|
| `/pages/index/index` | 首页 | 欢迎 + 「开始填写」+ 「我的简历」 |
| `/pages/form/form` | 表单页 | 12+ 字段、教育/工作可增删 |
| `/pages/preview/preview` | 预览页 | Markdown 渲染 |
| `/pages/login/login` | 登录页（**自动触发，可省略 UI**） | wx.login + 后端 |

### 启动流程

```
app.js onLaunch
  ├─ 有 token → 进首页
  └─ 无 token → wx.login → POST /api/auth/login → 存 token → 进首页
```

---

## §3 后端 Stub 接口（3 个新增）

### 3.1 `POST /api/resume/save`

**鉴权**：userAuth

**入参**（joi 校验）：
```json
{
  "source_form": {
    "name": "string, required, max 64",
    "gender": "male|female|other, required",
    "degree": "string, required, max 16",
    "phone": "string, optional, CN mobile",
    "educations": [{
      "school": "string required max 128",
      "major": "string required max 64",
      "degree": "string required max 16",
      "start": "YYYY-MM required",
      "end": "YYYY-MM 或 '至今' required"
    }],
    "experiences": [{
      "company": "string required max 128",
      "title": "string required max 64",
      "start": "YYYY-MM required",
      "end": "YYYY-MM 或 '至今' required",
      "desc": "string required max 2000"
    }],
    "expected": {
      "city": "string required max 64",
      "position": "string required max 128",
      "salary_min": "int required min 0",
      "salary_max": "int required min 0, must >= salary_min (Joi.ref)"
    },
    "skills": ["string array, 1-20 items"]
  }
}
```

**校验规则**：
- `salary_max >= salary_min`：`Joi.number().min(Joi.ref('salary_min')).required()`
- 错误返回 `{code:400, message:"薪资上限不能低于下限"}`

**处理**：
1. 写 `resumes` 表：`user_id, source_form, content_md=''`
2. 同用户老 active resume 置 `is_active=0`
3. 新 resume `is_active=1`

**返**：
```json
{
  "resume_id": 123,
  "created_at": "2026-06-27T..."
}
```

**错误**：401（无 token）/ 400（joi 失败）

**统一错误格式**（沿用 Phase 1 契约，不改字段名）：
```json
{
  "code": 400,
  "message": "薪资上限不能低于下限",
  "data": null
}
```
- `code`：HTTP 状态码对齐（400/401/403/404/429/500）
- `message`：人类可读，前端直接 toast
- `data`：可选，结构化附加信息

---

### 3.2 `POST /api/resume/generate`

**鉴权**：userAuth

**入参**：
```json
{ "resume_id": 123 }
```

**处理（STUB，不调 LLM）**：
1. 查 `resumes` 表（验 ownership + 取 `source_form`）
2. 用模板函数生成 Markdown（**Phase 3 替换成 LLM**）
3. `UPDATE resumes SET content_md = ?`

**模板逻辑**（纯函数 `services/resumeTemplate.js`，支持多段）：

```js
function renderResume(form) {
  const lines = [];
  lines.push(`# ${form.name}`);
  lines.push('');
  lines.push('## 基本信息');
  lines.push(`- 性别：${form.gender}`);
  lines.push(`- 学历：${form.degree}`);
  lines.push(`- 联系方式：${form.phone || '未提供'}`);
  lines.push('');

  lines.push('## 教育经历');
  for (const e of form.educations) {
    lines.push(`### ${e.school} (${e.start} - ${e.end})`);
    lines.push(`- 专业：${e.major}`);
    lines.push(`- 学历：${e.degree}`);
    lines.push('');
  }

  lines.push('## 工作经历');
  for (const x of form.experiences) {
    lines.push(`### ${x.company} - ${x.title} (${x.start} - ${x.end})`);
    lines.push(x.desc);
    lines.push('');
  }

  lines.push('## 求职期望');
  lines.push(`- 城市：${form.expected.city}`);
  lines.push(`- 岗位：${form.expected.position}`);
  lines.push(`- 薪资：${form.expected.salary_min}K - ${form.expected.salary_max}K`);
  lines.push('');

  lines.push('## 技能');
  lines.push(form.skills.join('、'));

  return lines.join('\n');
}
```

**返**：
```json
{
  "resume_id": 123,
  "content_md": "# 张三\n\n## 基本信息\n..."
}
```

**错误**：401 / 404（resume 不存在或非本人）

---

### 3.3 `GET /api/resume/current`

**鉴权**：userAuth

**入参**：无

**处理**：取当前 user 最新 `is_active=1` resume

**返**：
```json
{
  "resume_id": 123,
  "content_md": "...",
  "source_form": {...}
}
```

**错误**：401 / 404（无 active resume）

---

### 3.4 文件位置

```
backend/src/
├── routes/resume.js           # 3 接口路由
├── services/resumeTemplate.js # stub 模板生成（纯函数，node:test 测）
└── middleware/
    └── validate.js            # joi schemas（复用 + 新增 resume schema）
```

---

## §4 前端结构

### 4.1 目录

```
mini-program/
├── app.js                  # onLaunch: token 检查 + login
├── app.json                # pages + window
├── app.wxss                # 全局极简样式
├── project.config.json     # AppID=wxf9c88ec9dd38cc64
├── sitemap.json
├── pages/
│   ├── index/
│   │   ├── index.js
│   │   ├── index.wxml
│   │   ├── index.wxss
│   │   └── index.json
│   ├── form/
│   │   ├── form.js         # 12+ 字段、教育/工作增删
│   │   ├── form.wxml
│   │   ├── form.wxss
│   │   └── form.json
│   └── preview/
│       ├── preview.js      # GET /api/resume/current + 渲染
│       ├── preview.wxml
│       ├── preview.wxss
│       └── preview.json
├── utils/
│   ├── request.js          # wx.request 封装
│   ├── auth.js             # token 存储（wx.getStorageSync）
│   ├── validate.js         # 表单校验纯函数 ← 测试
│   └── format.js           # JSON 拼装 + 日期格式化 ← 测试
└── tests/
    ├── validate.test.js    # node:test
    └── format.test.js     # node:test
```

### 4.2 关键 utils（要测的）

**`utils/validate.js`**：
```js
function validatePhone(phone) { /* CN mobile regex，空值合法 */ }
function validateYearMonth(s) { /* YYYY-MM 或 '至今' */ }
function validateResume(form) { /* 返回 errors 对象，校验整体表单 */ }
```

**`utils/format.js`**：
```js
function buildSourceForm(formData) { /* 拼成后端期望 JSON */ }
function parseYearMonth(s) { /* 'YYYY-MM' → {year, month}，'至今' → null */ }
function formatDate(iso) { /* ISO → 'YYYY-MM-DD HH:mm' */ }
function parseSkills(input) { /* 'a,b,, c' → ['a','b','c'] 去重+去空 */ }
function mdToHtml(md) { /* 极简 md → html（先 escapeHtml 再转标签） */ }
function escapeHtml(str) { /* XSS 防护：& < > " 转义 */ }
```

**`utils/request.js`**（关键封装）：
```js
function request({ url, method, data }) {
  const token = wx.getStorageSync('token');
  return new Promise((resolve, reject) => {
    wx.request({
      url: BASE_URL + url,
      method,
      data,
      header: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
      },
      success: (res) => {
        if (res.statusCode === 200) resolve(res.data);
        else if (res.statusCode === 401) {
          wx.removeStorageSync('token');
          wx.showToast({ title: '请重新登录', icon: 'none' });
          reject(res.data);
        } else {
          wx.showToast({ title: res.data?.message || '请求失败', icon: 'none' });
          reject(res.data);
        }
      },
      fail: (err) => { wx.showToast({ title: '网络错误', icon: 'none' }); reject(err); },
    });
  });
}
```

### 4.3 UI 极简风

```css
/* app.wxss 全局 reset */
* { box-sizing: border-box; margin: 0; padding: 0; }
page { background: #f7f8fa; font-family: -apple-system, sans-serif; }
.container { padding: 24rpx; }
.btn-primary { background: #07c160; color: white; border-radius: 8rpx; }
.btn-secondary { background: white; color: #333; border: 1rpx solid #ddd; }
.card { background: white; border-radius: 12rpx; padding: 32rpx; margin: 16rpx 0; }
.input { border: 1rpx solid #ddd; border-radius: 8rpx; padding: 16rpx; width: 100%; box-sizing: border-box; }
```

### 4.4 预览页 Markdown 渲染

**方案**：用 `<rich-text nodes="{{mdHtml}}">`，前端把 Markdown 转 HTML。

**`mdToHtml` 实现**（极简，先 escape 再转标签）：
```js
function mdToHtml(md) {
  // 1. 先 escape 防 XSS（rich-text 历史上出过漏洞）
  let s = escapeHtml(md);
  // 2. 转标签
  s = s.replace(/^# (.+)$/gm, '<h1>$1</h1>')
       .replace(/^## (.+)$/gm, '<h2>$1</h2>')
       .replace(/^### (.+)$/gm, '<h3>$1</h3>')
       .replace(/^- (.+)$/gm, '<li>$1</li>');
  // 3. li 包 ul（连续 li 合成 ul 块）
  s = s.replace(/(<li>[^]*?<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
  // 4. 换行 → <br>
  s = s.replace(/\n/g, '<br>');
  return s;
}
```

**`escapeHtml`**（防 XSS）：
```js
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```

**为什么不用 wxParse**：第三方库，Phase 2 不引依赖。Phase 6 再换 marked.js。

**`<rich-text>` 安全警告**：微信官方文档明确，nodes 中的 HTML 不会被组件外的 CSP 限制，必须**前端先 escape**。

**为什么不用 wxParse**：第三方库，Phase 2 不引依赖。

**实现**：`mdToHtml` 处理 `# ##` 标题 + 列表 + 段落，**不做完整 GFM**（Phase 6 加 marked 库）。

### 4.5 表单字段（12+）

| 组 | 字段 | 控件 |
|----|------|------|
| 基本 | 姓名 / 性别（picker）/ 学历（picker）/ 手机（可选） | input + picker |
| 教育 | 学校 / 专业 / 学历 / 起止 | 多段卡片 + 「+」按钮 |
| 工作 | 公司 / 职位 / 起止 / 描述 | 多段卡片 + 「+」按钮 |
| 期望 | 城市 / 岗位 / 薪资范围 | input |
| 技能 | 标签输入（逗号分隔） | input |

存储结构（前端 → 后端）：
```json
{
  "name": "...", "gender": "male", "degree": "本科", "phone": "",
  "educations": [{"school":"...","major":"...","degree":"本科","start":"2018-09","end":"2022-06"}],
  "experiences": [{"company":"...","title":"...","start":"2022-07","end":"至今","desc":"..."}],
  "expected": {"city":"深圳","position":"前端","salary_min":15,"salary_max":25},
  "skills": ["React","Vue"]
}
```

---

## §5 测试策略

### 5.1 后端（node:test）

| 测试文件 | case | mock |
|----------|------|------|
| `tests/resume/save.test.js` | 4 | DB（pool.query mock）+ userAuth |
| `tests/resume/generate.test.js` | 4 | DB + resumeTemplate |
| `tests/resume/current.test.js` | 3 | DB |
| `tests/services/resumeTemplate.test.js` | 6 | 纯函数，测各字段渲染 |
| `tests/middleware/validate-resume.test.js` | 4 | joi schema |

**目标 ≥ 21 新测试，全 pass**（含之前 32 个共 ≥ 53）

### 5.2 前端（node:test，跑 utils）

| 测试文件 | case |
|----------|------|
| `mini-program/tests/validate.test.js` | 5 |
| `mini-program/tests/format.test.js` | 5 |

**目标 ≥ 10 新测试，全 pass**

**测试 case 详细场景**：

`validate.test.js`（node:test）：
1. `validatePhone('') === true`（空值合法）
2. `validatePhone('123456') === false`（非法）
3. `validatePhone('13800138000') === true`（合法）
4. `validateYearMonth('2024-13') === false`（月份越界）
5. `validateResume({...salary_min: 25, salary_max: 15})` 返回 `{expected: '薪资上限不能低于下限'}`

`format.test.js`：
1. `parseYearMonth('至今') === null`
2. `parseYearMonth('2024-06') === {year:2024, month:6}`
3. `parseSkills('React, Vue,, React, ') === ['React','Vue']`（去重+去空）
4. `escapeHtml('<script>') === '&lt;script&gt;'`
5. `mdToHtml('# 标题') === '<h1>标题</h1>'`

### 5.3 后端 `userAuth` mock 模板

```js
// tests/helpers/mockAuth.js
const mockUserAuth = (req, res, next) => {
  req.user = { id: 123, openid: 'test_openid' };
  next();
};
const mockUserAuthFail = (req, res) => {
  res.status(401).json({ code: 401, message: '未授权', data: null });
};
module.exports = { mockUserAuth, mockUserAuthFail };
```

### 5.4 UI 测试

**不做**。靠真机 + 开发者工具肉眼验。

---

## §6 部署

### 6.1 后端

- 改 backend 代码 → commit + push → `pm2 restart resume-app-backend --update-env`
- 服务器地址：`https://43.139.176.199/api/*`

### 6.2 小程序

- 代码在本地 `mini-program/` 目录，**不上服务器**
- 用户用微信开发者工具本地打开
- `project.config.json` 写：
  - `appid: "wxf9c88ec9dd38cc64"`
  - `projectname: "resume-app"`
- 「真机调试」扫码预览

### 6.3 小程序后台配置（用户手动）

去 mp.weixin.qq.com → 开发管理 → 开发设置 → 服务器域名：
- request 合法域名：`https://43.139.176.199`
- uploadFile / downloadFile：暂不配

**Phase 2 验收不通过** if 不配（wx.request 会 fail）。

---

## §7 任务估算（参考）

| 块 | 任务数 |
|----|--------|
| 后端 stub（3 接口 + 模板） | 8 |
| 后端测试（≥ 21） | 4 |
| 前端骨架（app.js + 4 页面） | 8 |
| 前端 utils + 测试 | 4 |
| Devlog + 验收 | 2 |
| **合计** | **~26 任务** |

---

## §8 范围之外（YAGNI）

| 不做 | 原因 |
|------|------|
| tabBar（首页+我的） | 设计文档 Phase 2 没要，Phase 6 加 |
| loading skeleton | 骨架够用 |
| 表单分页（基础页+经历页） | 单页够用 |
| LLM 真生成 | Phase 3 |
| 简历匹配 | Phase 5 |
| 管理端 | Phase 4 |
| wxParse / marked | Phase 6 加 |
| TypeScript | 后续 |
| miniprogram-automator | 学习成本高，UI 手动测 |
| 国际化 / 推送 / PDF | 设计文档 MVP 不做 |

---

## §9 风险 + 缓解

| 风险 | 缓解 |
|------|------|
| 用户没注册微信开发者工具 | 启动清单列出 |
| 用户没配服务器域名 | 启动清单列出（不配 wx.request 失败） |
| 表单字段太多，新手设计耗时 | 用 picker + 模板，新手可改字段即可 |
| wxss 在不同手机渲染差异 | 极简风 + rpx 单位 |
| 微信开发者工具对 node:test 限制 | 前端测试用纯 node 跑（不依赖 wx 全局） |

---

## §10 启动清单（Phase 2 开始前用户必做）

1. ✅ 已完成：注册微信小程序开发者工具账号
2. ⏳ 待办：本地装微信开发者工具（**最新稳定版**）
3. ⏳ 待办：用开发者工具新建项目，导入 `mini-program/` 目录（项目创建后会自动生成 `project.config.json`）
4. ⏳ 待办：**导入后手动检查** `project.config.json` 中 `appid` 是否为 `wxf9c88ec9dd38cc64`（**避免自动生成的配置覆盖**）
5. ⏳ 待办：确认用户拥有 `wxf9c88ec9dd38cc64` 账号的**开发权限**（真机调试会提示"无权限"）
6. ⏳ 待办：开发者工具 → 设置 → 项目设置 → **勾选"不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书"**（仅测试用，**因服务器用自签证书**）
7. ⏳ 待办：（可选）mp.weixin.qq.com → 开发管理 → 开发设置 → 配置 request 合法域名 `https://43.139.176.199`（不勾上面那个才必须）
8. ⏳ 待办：手机微信升到 **8.0+**（部分 API 新接口需新版本）

**自签证书问题解决方案**：服务器目前用自签证书（备案期），勾选「不校验合法域名」是最快的方案。备案完成后切回正式校验。

---

## §11 决策记录

**决策 1**：后端 stub + 前端真调（不 mock 前端请求）— 用户选

**决策 2**：原生 WXML/WXSS/JS（不用 Taro/uni-app）— 用户选

**决策 3**：UI 极简风（白底+圆角+阴影）— 用户选

**决策 4**：单页流程（不用 tabBar）— 用户选

**决策 5**：表单完整 12+ 字段（教育/工作多段）— 用户选

**决策 6**：多页直跳（不用状态机单页）— 用户选

**决策 7**：后端 stub 全量 3 接口（save/generate/current）— 用户选

**决策 8**：前端 utils 用 node:test 测纯函数，UI 不测 — 用户选

**决策 9**（review 采纳）：错误格式**沿用 Phase 1** `{code, message, data?}`，不改字段名 — 避免破坏 Phase 1 契约（已 OK）

**决策 10**（review 采纳）：`<rich-text>` 渲染前**先 escapeHtml 防 XSS**（微信历史上出过漏洞）

**决策 11**（review 采纳）：开发者工具**勾选不校验合法域名**（自签证书问题最简方案）

**数据模型确认**（schema.sql L23-35 已存在）：
- `resumes.source_form`：JSON 类型（MySQL 8.0+ 原生 JSON，可存 `{educations:[{...}], skills:["..."]}` 含字符串）
- `resumes.content_md`：MEDIUMTEXT
- `resumes.is_active`：TINYINT(1)（每次 save 改老 active=0，新 active=1）