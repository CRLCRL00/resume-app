# Contributing — R132 GitHub Flow

> 2026-07-31: 弃用 "直接 push main" ad-hoc 模式,改 GitHub Flow (PR + review + CI).

## 📋 流程

```
feature branch → PR (用模板) → CI (test + lint) green → Code Review → Merge to main → Deploy
```

### 1. 开新功能 / 修 bug

```bash
git checkout main && git pull
git checkout -b feat/<name>     # 例: feat/jobpilot-industries / fix/wx-mp-preview-push-fail
```

### 2. 本地开发 + 测

```bash
# Backend
cd backend && npm test            # 必跑 (114 unit tests)
cd backend && npm run lint        # 强烈推荐

# Frontend
cd mini-program                    # IDE 重编译看效果

# 全栈 smoke
node backend/scripts/smoke-e2e.js  # 11 critical endpoints
```

### 3. Commit (Conventional Commits)

```bash
git commit -m "<type>(<scope>): <subject>
<blank>
<body — 解释 WHY>
<blank>
Co-Authored-By: Claude <noreply@anthropic.com>"
```

`type` ∈ `feat` / `fix` / `docs` / `style` / `refactor` / `test` / `chore` / `perf` / `build` / `ci`
`scope` ∈ `backend` / `mini-program` / `ci` / `docs`

✅ 一个 commit 一个逻辑 (atomic)
❌ 不要 "fix stuff" / "WIP" / merge commit 信息

### 4. Push + 开 PR

```bash
git push origin feat/<name>
gh pr create --title "feat(scope): subject" --body-file .github/pull_request_template.md
# 或 web UI: github.com/<repo>/compare/main...<branch>
```

PR 标题也要 Conventional Commits。**不要直 push main**。

### 5. CI 必须绿 (pr-check workflow)

PR 创建后 GH 自动跑:
- `backend-test`: `npm test` (114 unit cases)
- `frontend-syntax`: wxml view 标签平衡 + js `node --check`
- `docs-check`: README + RUNBOOK + CONTRIBUTING 存在

任何一个 ❌ → PR 不能 merge。点 pr-check 详情看 fail log。

### 6. Code Review

按 `.github/CODEOWNERS`:
- `backend/**` → @CRLCRL00 review
- `mini-program/**` → @CRLCRL00 review
- `backend/db/migrations/` + `.env.example` + `config/**` + `auth.js` → @CRLCRL00 (高敏感)
- `.github/workflows/emergency-deploy.yml` + `deploy.yml` → @CRLCRL00 (deploy)

review checklist (在 `.github/pull_request_template.md`):
- 代码符合 SOP
- 测试通过
- commit message 规范
- 单 commit 单逻辑
- 文档更新
- 没 debug 残留
- 没 secret hardcode

### 7. Merge

通过 review + CI 绿后:
- 推荐 **Squash and merge** (把 N 个 commit 合成 1 个, 历史干净)
- merge 后自动 delete branch

### 8. Deploy

merge 到 main 自动触发:
- `emergency-deploy.yml` (D4 scp + run script) — 跑 7-phase fix
- `deploy.yml` (scp + run deploy.sh) — 标准 backend deploy
- `wx-mp-preview.yml` (push validation, jobs skipped) — 假 trigger, 现在抑制

`emergency-deploy.yml` 在 push 时 SSH 进 prod 跑 one-shot-prod-fix.sh, 含:
1. git pull
2. backup DB
3. migration
4. pm2 reload --update-env
5. smoke 探测

deploy 失败 → 看 GH Actions log + `ssh prod pm2 logs resume-app-backend`。

## 🚨 紧急修复 (hotfix)

紧急 bug 跳过 PR review:
```bash
git checkout main && git pull
# 直接改 + push (但仍 commit 留 audit trail)
```

或者用 GH Actions emergency-deploy.yml 手动 Run workflow。

## 🛑 不要做

- ❌ 直接 push main (绕过 review + CI)
- ❌ 大杂烩 commit ("fix + feat + docs")
- ❌ force push main
- ❌ 不测就 push
- ❌ secret / token commit (CI 会扫)
- ❌ 在 master 分支开 PR

## 📊 状态查询

```bash
# 最近 run
gh run list --limit 5

# 看某个 run
gh run view <run-id> --log

# 看 workflow file 状态
gh workflow list

# prod 状态
ssh prod pm2 list
ssh prod curl https://43.139.176.199:443/api/health
```

## 🔧 工具

- `gh` CLI (推荐, 比 web UI 高效)
- WeChat 开发者工具 (IDE)
- `pm2 logs resume-app-backend` (prod log)
- `mysql -h 127.0.0.1 -uroot -p...` (prod DB)

## 📚 相关文档

- [README.md](README.md) — 项目总览
- [RUNBOOK.md](RUNBOOK.md) — 运维 / 故障排查
- [docs/operations/](docs/operations/) — 部署 / 备份 / 监控
- [devlog/](devlog/) — 开发日志