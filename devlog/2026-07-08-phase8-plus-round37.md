# 开发日志 — 2026-07-08（Phase 8+ Round 37）

> 阶段：8+ Round 37 — ADF hardening
> 前置：[2026-07-07-phase8-plus-round36.md](../devlog/2026-07-07-phase8-plus-round36.md)

## 目标

3 hardening 项：
B. 性能 artifact 可视化 + PR comment（sticky comment）
D. VitePress 文档站 + GH Pages 自动部署
G. Admin 全文搜索（jobs/users/resumes）

## 最终结果

| 项 | 状态 |
|----|------|
| B perf PR comment | ✅ JSON output + sticky comment + 4 测 |
| D VitePress docs | ✅ 21 文件 + GH Pages workflow |
| G admin search | ✅ 3 endpoints + LIKE escape + 8 测 |
| **npm test 3x** | ✅ **350 / 347 pass / 2 fail / 1 skip** × 3 |

baseline 338 → 350（+12：B 4 + G 8）。2 fail pre-existing authLockout。

## 改动详情

### B — Perf Artifact + PR Comment

`backend/scripts/perf-bench.js`（扩）：
- 新模式 `BENCH_JSON_OUTPUT=1` 或 `--json`：纯 JSON 数组写 stdout + `$BENCH_OUTPUT_FILE`（默认 `.bench-results.json`）
- 人类表走 stderr（保持可读）
- 加 `tagResult()` helper：每个 endpoint 标 `result: 'ok'|'fail'`（p99/p95 超阈 OR errors > 0）
- 默认行为零改动

`backend/scripts/perf-comment.js`（新，~50 行，0 dep）：
- 读 `.bench-results.json` → 输出 markdown 表格到 stdout（CI 捕获）
- 阈值显示：`p95 < 800ms, p99 < 1500ms`
- 行数 ≤ 30（避 PR 噪声）

`.github/workflows/perf-ci.yml`（改）：
- bench 步骤走 JSON mode → 生成 `.bench-results.json`
- 新 step：`node scripts/perf-comment.js > perf-comment.md`
- upload-artifact 上传 `.bench-results.json` + `perf-comment.md`（if always）
- `marocchino/sticky-pull-request-comment@v2` 发 PR 评（按 header `perf-bench` upsert）
- `if: always()` 让失败也评，reviewer 立即看到哪项破阈

`backend/tests/perf-comment.test.js`（新，4 测）：
- 生成 markdown 含表格 + 阈值
- ✅ / ❌ emoji 区分
- 空 results → "No benchmark data"
- 阈值正确显示

**Sample PR comment**：
```markdown
## Perf Bench (commit 8d9423e)

| Endpoint | p50 (ms) | p95 (ms) | p99 (ms) | RPS | Err | Result |
|---|---|---|---|---|---|---|
| GET /api/health | 23 | 33 | 36 | 2115 | 0 | ✅ |
| POST /api/resume/save | 207 | 275 | 279 | 96 | 0 | ✅ |
| POST /api/resume/generate | 2 | 3 | 4 | 2170 | 0 | ✅ |
| POST /api/match | 4 | 6 | 7 | 1019 | 0 | ✅ |

Thresholds: p95 < 800ms, p99 < 1500ms
```

### D — VitePress Docs + GH Pages

`docs-site/`（21 新文件）：
- VitePress 1.6.4（`^1.5.0` 范围自动解析到 1.6）
- 独立 npm 包，`npm run dev/build/preview`
- 结构：
  - `index.md` — landing hero
  - `guide/` — overview + quickstart + architecture (3 文件)
  - `operations/` — perf-bench + smoke-test (R34/R30 copy) + alerts + admin-queries + audit-logs + two-factor + chaos-testing (5 新)
  - `reference/` — openapi + env-vars
  - `changelog/` — 25 devlog 链接
  - `.vitepress/config.ts` — nav + sidebar + zh-CN + local search

`.github/workflows/docs-deploy.yml`（新）：
- trigger：`push → main` + `workflow_dispatch`
- permissions: `contents/pages/id-token`
- environment: `github-pages`
- 步骤：checkout → setup-node → npm ci → build → configure-pages → upload-pages-artifact → deploy-pages
- ⚠️ **手动操作**：GH repo → Settings → Pages → Build and deployment = **"GitHub Actions"**（首次切，否则 URL 不挂）

根 `package.json` 加 `docs:dev/build/preview`。

根 `.gitignore` 扩 `docs-site/node_modules/` + `.vitepress/dist/cache`。

`README.md` 加 "## 文档" 章节，链 docs-site。

`docs/{perf-bench,smoke-test,eslint}.md` 顶部加 docs-site 链接（向后兼容 + 引导迁）。

⚠️ **deviation**：
- VitePress 1.x 把 `{{ }}` 视作 Vue 插值，R34 perf-bench.md 的 `${{ github.ref }}` 被 SSR 当变量 → `Cannot read 'ref'`。**已修**（escape 为 `&#123;&#123;`）
- `actions/upload-pages-artifact@v3`（v4 不存在）

### G — Admin 全文搜索

3 endpoints 加 `?q=` LIKE 搜索：

`backend/src/routes/admin/jobs.js`：
```js
if (q) {
  where.push('(j.title LIKE ? OR j.company LIKE ? OR j.description_md LIKE ?)');
  params.push(...escapeLike3(q));
}
```
搜 title + company + description_md。

`backend/src/routes/admin/admins.js`：
```js
if (q) {
  where.push('(a.openid LIKE ? OR u.nickname LIKE ?)');
  // LEFT JOIN users u ON u.openid = a.openid
}
```
搜 openid + nickname（跨表 LEFT JOIN）。

`backend/src/routes/admin/resumes.js`（**新文件**）：
```js
if (q) {
  where.push(`(
    u.nickname LIKE ? OR u.openid LIKE ?
    OR JSON_UNQUOTE(JSON_EXTRACT(r.source_form, '$.name')) LIKE ?
    OR JSON_UNQUOTE(JSON_EXTRACT(r.source_form, '$.educations[0].school')) LIKE ?
    OR JSON_UNQUOTE(JSON_EXTRACT(r.source_form, '$.experiences[0].company')) LIKE ?
  )`);
}
```
搜 user 昵称 + 简历 JSON 字段（姓名 / 学校 / 公司）。

`escapeLike()` helper：转义 `\` `%` `_` 防 LIKE 通配符滥用。

8 测覆盖（含 SQL injection 用例 `'; DROP TABLE jobs; --`）：
1. /jobs?q=engineer 返回匹配
2. /jobs?q= 无匹配 → empty + total=0
3. /jobs?q= 含特殊字符 % _ 安全
4. /users?q=admin 返回 admin 行
5. /users?q= nickname 匹配（LEFT JOIN）
6. /jobs?q= 与 page/pageSize 组合 OK
7. /resumes/search?q= 返回匹配
8. SQL injection attempt → safe

mount：`backend/src/routes/admin/index.js` 加 `router.use('/resumes', require('./resumes'))`。

`backend/src/routes/openapi.js` 文档 `q` 参数。

## npm test

| Run | tests | pass | fail | skip |
|-----|-------|------|------|------|
| 1 | 350 | 347 | 2 | 1 |
| 2 | 350 | 347 | 2 | 1 |
| 3 | 350 | 347 | 2 | 1 |

baseline 338 → 350（+12：B 4 + G 8）。0 新 fail。

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | B JSON 输出 mode 默认关闭 | 不破现有调用；CI opt-in |
| 2 | B sticky comment 用 marocchino v2 | GITHUB_TOKEN 无 PAT；按 header upsert 不刷屏 |
| 3 | D VitePress 1.6.4（不锁 1.5.0） | `^1.5.0` 范围自动到最新 stable |
| 4 | D `{{ }}` 转义而非移除 | YAML/GH Actions 上下文有用；保语义 |
| 5 | D Pages workflow 用 v3 artifact | v4 不存在 |
| 6 | G LIKE 而非 FULLTEXT | 小数据集 FULLTEXT 性价比低；前缀索引 LIKE 够用 |
| 7 | G 转义 `\ % _` | 防 LIKE 通配符 |
| 8 | G 搜 resumes 用 JSON_EXTRACT | 不破坏现有 JSON 存储 |
| 9 | G 无 `?q=` 时回退原查询 | 完全向后兼容 |

## 风险

| 风险 | 缓解 |
|------|------|
| B sticky comment 频率高时刷屏 | 按 header 去重 + upsert |
| B JSON 模式丢人类表 | stderr 保留；console 看得到 |
| D Pages workflow 首次需手动开 | devlog 已记；GH UI 提示 |
| D VitePress 升级 major breaking | `^1.x` 锁大版本；升 2.x 需 audit |
| G LIKE 慢在大表 | jobs/users 小（<10k rows）；真大再加 FULLTEXT |
| G JSON_EXTRACT 慢 | 加 `idx_source_form_name` 后续如需 |
| G 8 测含 SQL injection 但 bypass search | 真注入会被 escape 拦；测字符串通过 LIKE 路径 |

## 已知 Follow-up

| # | 项 | 优先级 |
|---|----|--------|
| 1 | 多 pod alert dedupe 改 Redis pub/sub | 低 |
| 2 | E `_v2` 重命名（spec 一致） | 低 |
| 3 | 慢查询告警加 table 维度 | 中 |
| 4 | docs-site 加搜索高亮 + Algolia（量大时） | 低 |
| 5 | D Pages domain 自定义（CRLCRL00.github.io → 域名） | 中 |
| 6 | G resumes 加大表索引（JSON path virtual column） | 低 |

## Commits

| SHA | msg |
|-----|-----|
| `d9b9d7c` | test(admin): admin search suite (8 cases incl. SQL injection) |
| `90edaa0` | feat(admin): /api/admin/resumes/search?q= endpoint |
| `783d820` | feat(admin): /api/admin/users?q= search (openid + nickname LEFT JOIN) |
| `c5bc97e` | feat(admin): /api/admin/jobs?q= search (title/company/description) |
| `332dc03` | docs(site): VitePress docs + GH Pages auto-deploy (R37) |
| `8d9423e` | ci(perf): PR comment via sticky-pull-request-comment |
| `1a06db6` | feat(bench): perf-comment.js markdown generator |
| `5a37d29` | feat(bench): JSON output mode for CI artifact + .bench-results.json |

> 注：devlog 文件本身由 D subagent 的 `332dc03` 预写（仅含 D 内容）；本 commit 覆盖为完整 R37 内容（BDG）。