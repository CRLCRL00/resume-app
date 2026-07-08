# 开发日志 — 2026-07-08（Phase 8+ Round 37）

> 阶段：8+ Round 37 — VitePress 文档站点
> 前置：[2026-07-07-phase8-plus-round36.md](../devlog/2026-07-07-phase8-plus-round36.md)

## 目标

聚合 `docs/` + `devlog/` + 新运维文档到 VitePress 静态站点，push main 自动部署 GitHub Pages。

## 最终结果

| 项 | 状态 |
|----|------|
| docs-site 骨架 | ✅ VitePress 1.6.4 + zh-CN |
| guide 3 篇 | ✅ index / quickstart / architecture |
| operations 9 篇 | ✅ 5 new + 2 copy + 2 index |
| reference 3 篇 | ✅ openapi / env-vars / index |
| changelog 1 篇 | ✅ 25 devlog 链接 |
| GH Pages deploy workflow | ✅ docs-deploy.yml |
| `npm run build` | ✅ 1.8M dist / 3.3s |
| `backend npm test` | ✅ 347/350（2 pre-existing authLockout fail） |
| `backend npm run lint` | ✅ 0 errors / 7 warnings |

## 改动详情

### 1. `docs-site/` (新)

- `package.json` — vitepress ^1.5.0，独立 npm 包
- `.vitepress/config.ts` — title/locale/nav/sidebar/local search
- `index.md` — landing + hero + 3 features
- `guide/{index,quickstart,architecture}.md` — 3 篇
- `operations/{index,perf-bench,smoke-test,alerts,admin-queries,audit-logs,two-factor,chaos-testing}.md` — 8 篇
- `reference/{index,openapi,env-vars}.md` — 3 篇
- `changelog/index.md` — 25 devlog 链接
- `.gitignore` — 排除 node_modules/dist/cache

### 2. `.github/workflows/docs-deploy.yml` (新)

- trigger: `push → main`（带 paths 过滤）+ `workflow_dispatch`
- concurrency cancel-in-progress
- Node 20 → `npm ci` → `npm run build` → `actions/configure-pages@v4` → `actions/upload-pages-artifact@v3` → `actions/deploy-pages@v4`
- environment: `github-pages`
- timeout 5min

### 3. 根目录

- `package.json` — 加 `docs:dev` / `docs:build` / `docs:preview`
- `.gitignore` — 加 `docs-site/node_modules/` / `docs-site/.vitepress/dist/` / `docs-site/.vitepress/cache/`
- `README.md` — 加 `## 文档` 章节 + 文档导航表首行指向 docs-site

### 4. 旧 `docs/*.md` 不删

- `docs/perf-bench.md` + `docs/smoke-test.md` + `docs/eslint.md` 顶部加 docs-site 链接（向后兼容）
- 不动 `docs/audit/` / `docs/superpowers/` / `docs/operations/` 等其它文件

## npm test

| Run | tests | pass | fail | skip |
|-----|-------|------|------|------|
| 1 | 350 | 347 | 2 | 1 |

2 fail pre-existing `authLockout.test.js`（R36 已记）；不归本 PR。

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | 独立 `docs-site/package.json`（不绑根） | vitepress devDep 不污染 backend / mini-program；GH Pages build 不需要根 install |
| 2 | `zh-CN` locale + 中文 hero | 项目全中文；目标用户 = ops / 审核 / 新人 |
| 3 | local search（无 Algolia） | 单仓库小文档量；Algolia 需账号 / API key |
| 4 | workflow `paths` 过滤只 trigger docs-site 变更 | push main 频繁时节省 CI 分钟 |
| 5 | perf-bench.md 里 `${{ github.ref }}` 转义成 HTML entity | VitePress 1.x 把 `{{ }}` 当 Vue 插值解析；导致 SSR `Cannot read 'ref'` |
| 6 | 旧 docs/ 不删 | 仓库内简版作 fallback；外部链接暂不破 |
| 7 | VitePress 1.6.4（不是 1.5） | npm `^1.5.0` 解析到 1.6.4；同 1.x 大版本，无 breaking |

## 风险

| 风险 | 缓解 |
|------|------|
| GH Pages 首次启用需 repo Settings → Pages → Source = "GitHub Actions" | README devlog 标注；部署 PR 前手动设 |
| 中文搜索对代码片段 / 英文支持弱 | 后续可换 Algolia；现仅 ops 用，不卡 |
| docs-site 跟 docs/ 双份内容可能漂移 | 旧 docs 顶部明确指向 docs-site 站点版；审计时只审一份 |
| workflow 没设 `if: github.event_name == 'push' \|\| github.event_name == 'workflow_dispatch'` | trigger 已用 on: 限定；足够 |
| 没装 pnpm | 项目约定 npm，CI 也用 `npm ci`；一致 |

## 已知 Follow-up

| # | 项 | 优先级 |
|---|----|--------|
| 1 | GH Pages 启用后第一次 push 验证 URL | 高 |
| 2 | 把 `docs/audit/微信管理后台操作手册.md` 搬到 docs-site | 中 |
| 3 | 切 Algolia search（需申请 account） | 低 |
| 4 | `docs-site` 用 docker build 复刻 GH Pages 环境 | 低 |

## 部署前检查清单

- [ ] GitHub repo → Settings → Pages → Build and deployment = "GitHub Actions"
- [ ] 第一次手动 `workflow_dispatch` 跑一次
- [ ] Pages URL 应该是 `https://CRLCRL00.github.io/resume-app/`
- [ ] 验证 nav 4 项 / sidebar / 搜索 都能用

## Commits

| SHA | msg |
|-----|-----|
| (pending) | docs: VitePress site + GH Pages auto-deploy |
