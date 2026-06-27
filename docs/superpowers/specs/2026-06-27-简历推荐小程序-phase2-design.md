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
      "salary_max": "int required min 0"
    },
    "skills": ["string array, 1-20 items"]
  }
}
```

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

**模板逻辑**（纯函数 `services/resumeTemplate.js`）：
```markdown
# {{name}}

## 基本信息
- 性别：{{gender}}
- 学历：{{degree}}
- 联系方式：{{phone || '未提供'}}

## 教育经历
### {{school}} ({{start}} - {{end}})
- 专业：{{major}}
- 学历：{{degree}}

## 工作经历
### {{company}} - {{title}} ({{start}} - {{end}})
{{desc}}

## 求职期望
- 城市：{{expected.city}}
- 岗位：{{expected.position}}
- 薪资：{{expected.salary_min}}K - {{expected.salary_max}}K

## 技能
{{skills.join('、')}}
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
function validatePhone(phone) { /* CN mobile regex */ }
function validateYearMonth(s) { /* YYYY-MM 或 '至今' */ }
function validateResume(form) { /* 返回 errors 对象 */ }
```

**`utils/format.js`**：
```js
function buildSourceForm(formData) { /* 拼成后端期望 JSON */ }
function parseYearMonth(s) { /* 'YYYY-MM' → {year, month} */ }
function formatDate(iso) { /* ISO → 'YYYY-MM-DD HH:mm' */ }
```

### 4.3 UI 极简风

```css
/* app.wxss 全局 */
page { background: #f7f8fa; font-family: -apple-system, sans-serif; }
.container { padding: 24rpx; }
.btn-primary { background: #07c160; color: white; border-radius: 8rpx; }
.btn-secondary { background: white; color: #333; border: 1rpx solid #ddd; }
.card { background: white; border-radius: 12rpx; padding: 32rpx; margin: 16rpx 0; }
.input { border: 1rpx solid #ddd; border-radius: 8rpx; padding: 16rpx; }
```

### 4.4 预览页 Markdown 渲染

**方案**：用 `<rich-text nodes="{{mdHtml}}">`，前端把 Markdown 转 HTML（用 `utils/format.js` 加个 `mdToHtml(md)` 函数）。

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

### 5.3 UI 测试

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
2. ⏳ 待办：去 mp.weixin.qq.com → 开发管理 → 开发设置 → 配置 request 合法域名 `https://43.139.176.199`
3. ⏳ 待办：本地装微信开发者工具（最新稳定版）
4. ⏳ 待办：用开发者工具新建项目，导入 `mini-program/` 目录（项目创建后会自动生成 `project.config.json`）

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