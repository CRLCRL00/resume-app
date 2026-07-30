# 开发日志 — 2026-07-15（Phase 8+ Round 63 — 部分完成 + closeout）

> 阶段：8+ Round 63 — Migration runner 增强 + 5/6 项完成
> 前置：[2026-07-15-phase8-plus-round62.md](../devlog/2026-07-15-phase8-plus-round62.md)

## 起点

User 答"按优先级依次全部执行" → 推进 R63.A→F (依 priority 顺序).

## 完成 vs 卡

| # | 项 | status |
|---|---|---|
| A | Deploy R61-R62 + 手动 GRANT CREATE | 🟡 **卡 user** — `resume_app_user` 无 CREATE 权限, 需 user 跑 `GRANT CREATE, ALTER, DROP ON resume_app.* TO 'resume_app_user'@'localhost'; FLUSH PRIVILEGES;` 然后 `pm2 reload` |
| B | 抽 002/028 migration 文件 + diagnose 去 phantom | ✅ done |
| C | MIGRATIONS_DRY_RUN=1 mode | ✅ done |
| D | /api/health/ready 加 migrations 字段 | ✅ done |
| E | 部署 R63 + server 端 verify | ✅ done |
| F | Phase 8+ 收尾 (本 devlog) | ✅ done |

## R63.B — 抽 missing migration 文件

### 之前 (R62 后)
```
backend/src/db/migrations/
  004-admin-audit.sql
  005-alerts-dead-letter.sql
```
缺: `002-privacy-versions.sql`, `028-client-errors.sql` (都在 schema.sql 里 inline, 没人抽出来).

### 之后
```
backend/src/db/migrations/
  002-privacy-versions.sql   (extracted from schema.sql)
  004-admin-audit.sql
  005-alerts-dead-letter.sql
  028-client-errors.sql      (extracted from schema.sql)
```

### diagnose.js phantom 清理

R40+ REQUIRED_TABLES 含 `match_results` + `audit_logs` — 但代码里**没人用** (只 diagnose 自己 reference).
- `match_results` 列在 REQUIRED_TABLES 但 schema.sql 无此表 — ghost
- `audit_logs` 同样 (实际代码用 `admin_operation_logs` / `admin_audit`)

**清理**: 移除 phantom 2 项 + 移除 phantom column check.

### 命名保留
`001-jobs-index`, `003-audit-archive`, `005-audit-result` — 仍在 schema.sql INSERT IGNORE 标记, 但无 .sql 文件. 视为 legacy, runner 跳过. **未来不要写这些名字的新 migration** (会冲突).

## R63.C — MIGRATIONS_DRY_RUN

### 用途
`MIGRATIONS_DRY_RUN=1 node scripts/test-dryrun.js` — 列出哪些 migration 会被 apply, 但**不写 DB**.

### 适用场景
- prod deploy 前验证 "这次会改什么"
- 排查 "为什么 schema 没动"
- 测试 migration runner 不依赖真 DB 写

### 行为差异
| 步骤 | 普通 | dry-run |
|---|---|---|
| ensure schema_migrations | ✅ | ❌ 跳过 |
| SELECT name FROM schema_migrations | ✅ | ❌ 跳过 (空 set) |
| applyOne (tx + INSERT record) | ✅ | ❌ |
| log "DRY-RUN: would apply" | ❌ | ✅ |
| result.dryRun | undefined | `true` |

### Server 端 verify
```
DRY-RUN RESULT: {
  "applied": ["002-privacy-versions", "004-admin-audit", "005-alerts-dead-letter", "028-client-errors"],
  "skipped": [],
  "failed": null,
  "dryRun": true
}
```
✅ 列 4 个 pending, 0 写 DB.

## R63.D — /api/health/ready migrations 字段

### Response
```json
{
  "code": 0,
  "status": "ready",
  "db": "ok",
  "redis": "ok",
  "persistence": "ok",
  "migrations": {
    "ok": false,
    "applied": [],
    "skipped": [],
    "failed": {
      "file": "<runner>",
      "err": "CREATE command denied to user 'resume_app_user'@'localhost' for table 'schema_migrations'"
    },
    "dryRun": false
  }
}
```

### 设计
- **不** 让 migration 失败 fail readiness — server 仍 up, alert 显眼
- ops 一眼看 `migrations.failed.err` 知缺什么权限
- `migrations.ok` 是 boolean summary (null 表示 boot 还没跑完)

## R63.A — 卡原因详细

### 根因
`GRANT SELECT, INSERT, UPDATE, DELETE ON resume_app.* TO resume_app_user@localhost`
↑ 这是 R40+ least-privilege 配置. 缺 CREATE/ALTER/DROP → migration runner 跑不动.

### 3 个修复路径
| 路径 | 命令 (你跑) | 适用 |
|---|---|---|
| A1 | `mysql -u root -p resume_app < /tmp/bootstrap-migrations.sql` | 需 root mysql 密码 |
| A2 | `sudo mysql --protocol=socket -S /var/run/mysqld/mysqld.sock resume_app < /tmp/bootstrap-migrations.sql` | root@localhost 需 auth_socket |
| A3 | `GRANT CREATE, ALTER, DROP ON resume_app.* TO 'resume_app_user'@'localhost'; FLUSH PRIVILEGES;` + `pm2 reload resume-app-backend` | **推荐** — 后续 0 ops |

### 之后 (A3 完成后)
- `migrations.ok = true`
- `migrations.skipped = [4 items]`
- `migrations.applied = []`
- 不再有 `failed` 字段

## R63.E — 部署 verify

| 检查 | 结果 |
|---|---|
| tar+scp | ✅ |
| tar extract | ✅ |
| `pm2 reload resume-app-backend` | ✅ active (6) |
| `curl /api/health/ready` | ✅ 200, `migrations` 字段出现 |
| `MIGRATIONS_DRY_RUN=1 node scripts/test-dryrun.js` | ✅ 列 4 pending |

## 测试覆盖 (R62+R63 合并)

10/10 pass:
- ✔ splitStatements: simple single CREATE TABLE
- ✔ splitStatements: multi-statement split on ; + newline
- ✔ splitStatements: strips line comments
- ✔ splitStatements: trims whitespace
- ✔ splitStatements: empty input returns []
- ✔ listMigrationFiles: returns sorted *.sql
- ✔ listMigrationFiles: each filename has NNN-name format
- ✔ runMigrations: applies pending, skips applied, aborts on failure
- ✔ runMigrations: aborts on first migration failure
- ✔ runMigrations: dry-run mode logs without writing

## 改了什么

| 文件 | 改动 |
|---|---|
| `backend/src/db/migrations/002-privacy-versions.sql` | 新: extracted from schema.sql |
| `backend/src/db/migrations/028-client-errors.sql` | 新: extracted from schema.sql |
| `backend/src/db/diagnose.js` | 移除 phantom `match_results` + `audit_logs` |
| `backend/src/db/migrate.js` | + `MIGRATIONS_DRY_RUN` env, + `dryRun` opts, + `getLastResult()` |
| `backend/src/routes/health.js` | + migrations 字段 in /api/health/ready |
| `backend/tests/db-migrate.test.js` | + dry-run 测试 (10 total) |
| `backend/scripts/test-dryrun.js` | 新: dev dry-run 入口 |

## baseline

- backend: 425 + 9 (R59) + 9 (R62) + 1 (R63 dry-run) = 444 / 0 fail / 1 skip
- mini-program: 47 / 0 fail
- 23 commits on develop (R40-R63)

## Phase 8+ 收尾 (R40-R63 全景)

| 主题 | rounds | commits | server 状态 |
|---|---|---|---|
| Backend 健壮性 | R40-R45 | 5 | ✅ all 5 endpoints |
| 凭证安全 | R45.5-R46 | 2 | ✅ pre-commit hook + GH PAT revoke 留 user |
| 监控告警 | R40 (dedupe) + R53 (IP drift) | 2 | ✅ prom stack + alert dedup |
| Dashboard 大屏 | R54-R58 | 5 | ✅ 5 endpoints + 全屏 1920×1080 |
| Tunnel 透明化 | R55-R59 | 4 | ✅ HN auto-sync 5min cron |
| 部署运维 | R43.5 (bind) + R55 (pm2) + R60 (deploy) | 3 | ✅ 17→23 commits deployed |
| Schema 治理 | R62-R63 | 2 | ✅ runner 装好, 卡 GRANT |

### 23 commits / 0 fail maintained since R42

### Manual ops 留 user (UI/3rd-party)
1. ✅ ~~Deploy R57-R59~~ (R60 done)
2. ✅ ~~Fix cron file newline~~ (R61 done)
3. ❌ 真 admin openid → UPDATE admins
4. ❌ 真机 preview dashboard 全屏 (R58 done code, 真机 verify 留 user)
5. ❌ revoke 3 GH PAT (UI)
6. ❌ rotate WX code-upload key (UI)
7. ❌ tunnel 升级: serveo Pro / ngrok / cloudflared
8. ❌ ICP 备案 (14-30 天)
9. **NEW (R63.A)**: `GRANT CREATE, ALTER, DROP ON resume_app.* TO 'resume_app_user'@'localhost'`

## Commits (本 round)

| SHA | msg |
|-----|-----|
| 7a3ccaf | feat: R63 - migration runner enhancements (002/028 SQL + dry-run + health) |
| (本 devlog) | docs: R63 closeout + Phase 8+ summary |