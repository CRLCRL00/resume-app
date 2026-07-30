# Phase 4 — 管理端 设计文档

> 日期：2026-06-28
> 阶段：4 / 8（管理端）
> 前置：[Phase 3 design](../specs/2026-06-28-简历推荐小程序-phase3-design.md)
> 状态：设计评审通过

---

## §1 目标与验收

### 目标

在小程序里给管理员一个入口，做**岗位 CRUD + Prompt 读改 + 操作日志查询**。分包实现，按 openid 自动判断入口。

### 验收标准

| # | 验收项 | 通过条件 |
|---|--------|----------|
| 1 | 普通用户扫码 | 看不到「管理」tab |
| 2 | admin 用户扫码 | 看到「管理」tab |
| 3 | 管理 tab | 3 子页（岗位 / Prompt / 日志） |
| 4 | 岗位 CRUD | 列表分页 + 新建 + 编辑 + 上下架 + 软删 + 恢复 |
| 5 | Prompt 读改 | 列表 + 当前内容 + 编辑（保存新版本，老版本保留） |
| 6 | 日志查询 | 时间倒序分页，含「谁/何时/做了什么」 |
| 7 | 鉴权 | 非 admin token 调 admin 接口 → 403 |
| 8 | 日志记录 | 所有 admin 写操作都写 `admin_operation_logs` |
| 9 | 测试 | 后端新增 ≥ 25，前端新增 ≥ 10 |
| 10 | 服务器部署 | 真机可走管理流程 |

---

## §2 后端改动

### 2.1 新增 admin 路由（替换/扩展现有 `routes/admin/index.js`）

```
GET    /api/admin/jobs?page=1&pageSize=20    # 列表（含软删）
POST   /api/admin/jobs                        # 新建
PUT    /api/admin/jobs/:id                    # 编辑
PATCH  /api/admin/jobs/:id/online             # 上下架
DELETE /api/admin/jobs/:id                    # 软删
PATCH  /api/admin/jobs/:id/restore            # 恢复

GET    /api/admin/prompts                     # 列表
GET    /api/admin/prompts/:code               # 当前 active 版本内容
PUT    /api/admin/prompts/:code               # 编辑

GET    /api/admin/logs?page=1&pageSize=20    # 日志列表
GET    /api/admin/check                       # 现有：返回 isAdmin
```

### 2.2 拆分 routes/admin/

```
backend/src/routes/admin/
├── index.js              # 汇总（require all + mount）
├── jobs.js               # 岗位 CRUD
├── prompts.js            # Prompt 读改
├── logs.js               # 日志查询
└── check.js              # 现有：保留
```

`routes/admin/index.js` 重新写：

```js
const router = express.Router();
router.use(require('./check'));
router.use(require('./jobs'));
router.use(require('./prompts'));
router.use(require('./logs'));
module.exports = router;
```

**app.js 不变**（`app.use('/api/admin', adminRouter)` 已有）。

### 2.3 joi schemas（middleware/validate.js 新增）

```js
const jobSchema = Joi.object({
  title: Joi.string().max(128).required(),
  company: Joi.string().max(128).required(),
  city: Joi.string().max(64).required(),
  salary_min: Joi.number().integer().min(0).required(),
  salary_max: Joi.number().integer().min(Joi.ref('salary_min')).required(),
  degree_required: Joi.string().max(16).default('不限'),
  experience_required: Joi.string().max(16).default('不限'),
  skills_required: Joi.array().items(Joi.string()).default([]),
  description_md: Joi.string().max(20000).required(),
});

const promptUpdateSchema = Joi.object({
  content: Joi.string().max(50000).required(),
});
```

### 2.4 新增 service：services/adminLog.js

```js
const pool = require('../config/db');

async function record(adminOpenid, action, targetType, targetId, detail, ip) {
  await pool.query(
    'INSERT INTO admin_operation_logs (admin_openid, action, target_type, target_id, detail, ip) VALUES (?,?,?,?,?,?)',
    [adminOpenid, action, targetType || null, targetId != null ? String(targetId) : null,
     JSON.stringify(detail || {}), ip || null]
  );
}

module.exports = { record };
```

### 2.5 每个 admin 写操作调 record()

例如 jobs POST：

```js
router.post('/jobs', userAuth, adminAuth, async (req, res, next) => {
  try {
    const { error, value } = jobSchema.validate(req.body);
    if (error) throw new AppError(1000, error.message, 400);

    const [r] = await pool.query(
      'INSERT INTO jobs (title, company, city, salary_min, salary_max, degree_required, experience_required, skills_required, description_md) VALUES (?,?,?,?,?,?,?,?,?)',
      [value.title, value.company, value.city, value.salary_min, value.salary_max,
       value.degree_required, value.experience_required, JSON.stringify(value.skills_required),
       value.description_md]
    );
    await adminLog.record(req.user.openid, 'job.create', 'job', r.insertId, value, req.ip);
    res.json({ code: 0, data: { job_id: r.insertId } });
  } catch (err) {
    next(err);
  }
});
```

`record` 在事务外调（避免长事务）。

### 2.6 Prompt update 自动 version 递增

```js
router.put('/prompts/:code', userAuth, adminAuth, async (req, res, next) => {
  try {
    const { error, value } = promptUpdateSchema.validate(req.body);
    if (error) throw new AppError(1000, error.message, 400);

    const code = req.params.code;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // 1. 老 active 置 0
      await conn.query('UPDATE prompts SET is_active = 0 WHERE code = ? AND is_active = 1', [code]);
      // 2. 取 max version
      const [vrows] = await conn.query('SELECT MAX(version) AS max_v FROM prompts WHERE code = ?', [code]);
      const newVersion = (vrows[0].max_v || 0) + 1;
      // 3. 插新 active
      const [r] = await conn.query(
        'INSERT INTO prompts (code, name, content, version, is_active) VALUES (?, ?, ?, ?, 1)',
        [code, code, value.content, newVersion]
      );
      await conn.commit();
      await adminLog.record(req.user.openid, 'prompt.update', 'prompt', code,
        { old_version: vrows[0].max_v, new_version: newVersion, length: value.content.length }, req.ip);
      res.json({ code: 0, data: { prompt_id: r.insertId, version: newVersion } });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    next(err);
  }
});
```

### 2.7 列表分页

所有 list 路由支持 `page`（默认 1）+ `pageSize`（默认 20，最大 100）：

```js
const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
const pageSize = Math.min(parseInt(req.query.pageSize, 10) || 20, 100);
const offset = (page - 1) * pageSize;
const [rows] = await pool.query(`SELECT ... FROM ... LIMIT ? OFFSET ?`, [pageSize, offset]);
const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM ...');
res.json({ code: 0, data: { items: rows, total, page, pageSize } });
```

---

## §3 前端改动（分包）

### 3.1 app.json：分包 + 动态 tabBar

```json
{
  "pages": [
    "pages/index/index",
    "pages/form/form",
    "pages/preview/preview"
  ],
  "subpackages": [{
    "root": "admin",
    "pages": [
      "pages/jobs/list",
      "pages/jobs/edit",
      "pages/prompts/list",
      "pages/prompts/edit",
      "pages/logs/list"
    ]
  }],
  "tabBar": {
    "color": "#999",
    "selectedColor": "#07c160",
    "list": [
      { "pagePath": "pages/index/index", "text": "首页" }
    ]
  }
}
```

**关键**：tabBar 默认只有「首页」。`onLaunch` 调 `/api/admin/check`，admin 才调 `wx.setTabBarItem` 加「管理」。

### 3.2 app.js：动态 tabBar

```js
async onLaunch() {
  // ... 现有 login ...
  if (typeof wx.getSystemInfoSync === 'function') {
    const info = wx.getSystemInfoSync();
    if (info.platform === 'devtools') return;
  }
  this.login();

  // admin tab 检查
  setTimeout(() => this.checkAdmin(), 1500);
},

async checkAdmin() {
  try {
    const res = await require('./utils/request').request({ url: '/admin/check' });
    if (res.data?.isAdmin) {
      wx.setTabBarItem({
        index: 1,
        pagePath: 'admin/pages/jobs/list',
        text: '管理',
      });
    }
  } catch (e) {
    // 非 admin 或网络错，不显示
  }
}
```

### 3.3 6 个分包页面

| 路径 | 文件 |
|------|------|
| `admin/pages/jobs/list` | 列表 + 分页 + 操作（上下架/编辑/软删/恢复） |
| `admin/pages/jobs/edit` | 新建/编辑表单（query `?id=...` 区分） |
| `admin/pages/prompts/list` | 列出所有 code + 当前 active version |
| `admin/pages/prompts/edit` | textarea 编辑 |
| `admin/pages/logs/list` | 时间倒序分页 |

每个页面 4 文件（js + wxml + wxss + json）。

### 3.4 列表页通用模式

```js
Page({
  data: { items: [], total: 0, page: 1, pageSize: 20, loading: false },

  onShow() {
    this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      const res = await request({
        url: `/admin/jobs?page=${this.data.page}&pageSize=${this.data.pageSize}`,
      });
      this.setData({ items: res.data.items, total: res.data.total, loading: false });
    } catch (e) {
      this.setData({ loading: false });
    }
  },

  onReachBottom() {
    if (this.data.items.length < this.data.total) {
      this.setData({ page: this.data.page + 1 });
      this.load();
    }
  },
});
```

---

## §4 测试

### 4.1 后端（≥ 25）

| 文件 | case | 备注 |
|------|------|------|
| `tests/admin-jobs-crud.test.js` | 12 | list/pagination/create/edit/online/offline/delete/restore + 401 + 403 + joi 400 |
| `tests/admin-prompts-crud.test.js` | 6 | list/get/update + version 递增 + 401 + 403 |
| `tests/admin-logs.test.js` | 4 | list/pagination + 401 + 403 + 记录自动写入 |
| `tests/service-adminLog.test.js` | 3 | record 各字段 |

### 4.2 前端（≥ 10）

| 文件 | case |
|------|------|
| `mini-program/tests/admin-format.test.js` | 5（job 格式化 / pagination params / 时间戳 / 操作类型映射 / IP） |
| `mini-program/tests/admin-validate.test.js` | 5（job 校验 / salary_max ≥ salary_min / skills 数组 / 长度限制 / 必填字段） |

### 4.3 测试模式

**adminAuth mock**：复用 Phase 3 的 `helpers/mockAuth.js` 里的 mockUserAuth + 自写 mockAdminAuth：

```js
// tests/helpers/mockAdminAuth.js
const mockAdminAuth = (req, _res, next) => {
  req.user = { userId: 1, openid: 'admin_test' };
  next();
};
const mockAdminAuthFail = (_req, res) => {
  res.status(403).json({ code: 403, message: 'admin only', data: null });
};
```

或者直接**真实 adminAuth + 在 admins 表临时插 openid**（更 end-to-end）。本 spec 推荐后者。

---

## §5 部署 + 启动

### 后端
- commit + push → 服务器 `git pull && pm2 restart --update-env`

### 前端
- 开发者工具自动热重载
- `app.json` 改动需要重启开发者工具（或重建项目）

### 启动清单（用户手动）
1. ✅ 服务器 SSH 准备
2. ⏳ **手动 SQL 注册 admin**：
   ```bash
   ssh ubuntu@43.139.176.199
   # 先真机登录一次拿 openid（Phase 2 的 wx.login 返 openid，可通过 DB 查）
   mysql -u root -pResumeApp@2026 resume_app
   > SELECT openid FROM users ORDER BY id DESC LIMIT 1;  # 拿最新登录用户的 openid
   > UPDATE admins SET openid = '你的 openid', note = 'CRL' WHERE id = 1;
   ```
3. ⏳ 真机重进 → onLaunch 触发 checkAdmin → 显示「管理」tab

---

## §6 范围之外（YAGNI）

| 不做 | 原因 |
|------|------|
| Admin 增删 / 邀请 | 手动 SQL 够用 |
| 数据统计 / 仪表盘 | MVP 不需要 |
| 回收站 / 多级软删 | 软删 + 恢复够用 |
| 批量导入/导出岗位 | 上线初期手动 SQL 灌入 |
| Prompt 多版本对比 | 仅保留历史，新版本覆盖生效 |
| 操作日志搜索/筛选 | 时间倒序 + 分页够用 |
| 操作日志导出 | MVP 不做 |
| 操作回滚（一键恢复修改前） | 复杂，Phase 6 |
| 富文本编辑器 | textarea + markdown 预览（Phase 6 加 marked） |

---

## §7 风险 + 缓解

| 风险 | 缓解 |
|------|------|
| admin token 泄露 | 中间件每次查 admins 表（不缓存） |
| 软删岗位被匹配查到 | jobs 已 `WHERE is_deleted=0`（Phase 5） |
| Prompt edit 后旧内容失效 | 老版本保留（is_active=0），新版本 active |
| 操作日志膨胀 | 1000 行后归档（Phase 6） |
| 分包体积 > 2MB | admin 页面 < 50KB |
| onLaunch checkAdmin 失败 → 看不到 tab | 用户手动刷新或重启开发者工具 |

---

## §8 决策记录

**决策 1**：3 模块（岗位 + Prompt + 日志）— 用户选
**决策 2**：手动 SQL 注册 admin — 用户选
**决策 3**：动态 tabBar 入口 — 用户选
**决策 4**：列表加分页 — 用户选
**决策 5**：软删 + 恢复（不做回收站）— 用户选
**决策 6**：分包 root = `admin/`（不是 `pages/admin/`）— 设计选择
**决策 7**：操作日志在事务外写（避免长事务）— 设计选择