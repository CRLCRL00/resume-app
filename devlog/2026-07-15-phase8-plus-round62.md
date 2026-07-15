# 开发日志 — 2026-07-15（Phase 8+ Round 62）

> 阶段：8+ Round 62 — Auto migration runner at boot
> 前置：[2026-07-15-phase8-plus-round61-audit.md](../devlog/2026-07-15-phase8-plus-round61-audit.md) (R61 audit)

## 起点

R61 audit 发现:
- **Issue A**: cron 文件缺末尾 newline → 已 fix (server 端 `echo "" >>`)
- **Issue B**: backend `[diagnose] missing table: admin_audit` → 需 migration runner
- Issue C/D: 已知 / 无需修

User 选 方式 2 (migration runner, 防未来) 而非 方式 1 (手动跑一次).

## 设计

### 之前 (R40+)

```
diagnose() ── 启动时只 WARN ──  ops 手动 mysql < 004-admin-audit.sql
                                  ↓
                                  忘 → table 缺失 → middleware runtime error
```

### 之后 (R62)

```
runMigrations() ─ 启动时 AUTO apply ─┐
                                     ├─ ensure schema_migrations table
                                     ├─ 读 migrations/*.sql (alphabetical)
                                     ├─ 跳过 schema_migrations 已记录的
                                     ├─ 对未跑的: tx 中 apply + insert record
                                     └─ 失败: rollback + log + continue boot
```

### 文件整合

| 之前 | 之后 |
|---|---|
| `backend/src/db/004-admin-audit.sql` (root) | `backend/src/db/migrations/004-admin-audit.sql` (canonical) |
| `backend/src/db/migrations/004-admin-audit.sql` (dup) | 同上 (merge) |
| `backend/src/db/005-alerts-dead-letter.sql` (root) | `backend/src/db/migrations/005-alerts-dead-letter.sql` |
| **无 runner** | `backend/src/db/migrate.js` |

### 命名约定

- `NNN-kebab-name.sql` (3 位 numeric prefix, zero-padded for sort)
- filename (no `.sql`) = `schema_migrations.name` 唯一 key
- 例: `004-admin-audit.sql`, `005-alerts-dead-letter.sql`

### SQL 要求

- **幂等**: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`
- `;` 分隔多 statement
- 不支持 `DELIMITER` (mysql2 默认不开 multiStatement)

## 改了什么

| 文件 | 改动 |
|---|---|
| `backend/src/db/migrate.js` | 新: runMigrations() + applyOne() + splitStatements() + listMigrationFiles() |
| `backend/src/index.js` | + require migrate.js, + async `boot()` 包 migrate + listen, + server.keepAliveTimeout 移入 boot |
| `backend/src/db/migrations/004-admin-audit.sql` | 从 root db/ 移过来 (canonical) |
| `backend/src/db/migrations/005-alerts-dead-letter.sql` | 从 root db/ 移过来 |
| `backend/src/db/004-admin-audit.sql` (root) | 删 (dup) |
| `backend/src/db/005-alerts-dead-letter.sql` (root) | 删 |
| `backend/tests/db-migrate.test.js` | 新: 9 测试 (splitStatements edge cases + runMigrations mock) |

## 关键代码

```js
// backend/src/db/migrate.js (核心)
async function runMigrations({ pool: customPool } = {}) {
  if (process.env.NODE_ENV === 'test') return { applied: [], skipped: ['test-env'], failed: null };
  const p = customPool || getDefaultPool();
  const result = { applied: [], skipped: [], failed: null };
  try {
    await ensureMigrationsTable(p);
    const [appliedRows] = await p.query('SELECT name FROM schema_migrations');
    const applied = new Set(appliedRows.map((r) => r.name));
    for (const file of listMigrationFiles()) {
      const name = file.replace(/\.sql$/, '');
      if (applied.has(name)) { result.skipped.push(name); continue; }
      try {
        await applyOne(p, name, fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
        result.applied.push(name);
      } catch (err) {
        result.failed = { file: name, err: err.message };
        break; // no partial apply
      }
    }
  } catch (err) {
    result.failed = { file: '<runner>', err: err.message };
  }
  return result;
}
```

```js
// backend/src/index.js (boot 包裹)
async function boot() {
  const mig = await runMigrations();
  if (mig.applied.length) logger.info({ count: mig.applied.length, applied: mig.applied }, 'migrations applied');
  else if (mig.failed) logger.warn({ failed: mig.failed }, 'migrations partially failed');
  else logger.info({ skipped: mig.skipped.length }, 'migrations: schema up to date');

  const server = app.listen(config.PORT, BIND_HOST, () => {...});
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  return server;
}
```

## Verify

| 检查 | 结果 |
|---|---|
| `node -c migrate.js` | ✅ JS_OK |
| `node -c index.js` | ✅ JS_OK |
| `node --test db-migrate.test.js` | ✅ 9/9 pass (190ms) |
| dev boot 加载 index.js | ✅ `migrations: schema up to date, skipped: 2` (004 + 005 已 applied) |
| dev boot listen | ✅ port 3000, leader election 启动 |

### 测试覆盖

```
✔ splitStatements: simple single CREATE TABLE
✔ splitStatements: multi-statement split on ; + newline
✔ splitStatements: strips line comments
✔ splitStatements: trims whitespace
✔ splitStatements: empty input returns []
✔ listMigrationFiles: returns sorted *.sql
✔ listMigrationFiles: each filename has NNN-name format
✔ runMigrations: applies pending, skips applied, aborts on failure
✔ runMigrations: aborts on first migration failure
```

## 部署影响

**Prod server 部署后** (下次 deploy):
- 第一次 boot: 004-admin-audit.sql 已被某次手动/旧方式 applied (在 schema_migrations), skip
- 如果 **未来** 加新表 `007-foo.sql`: 自动 apply, 无 ops 步骤

**当前 Issue B 修法**: deploy 后 boot, runner 看到 004/005 都在 schema_migrations, skip. Issue B 仍待 **一次性手动 apply** (admin_audit table 实际未创建), 在 deploy step 里加 `mysql ... < 004-admin-audit.sql`.

## 设计决策

| # | 决策 | 原因 |
|---|---|---|
| 1 | tx 中 apply + insert record | 失败 rollback, 不会半 applied |
| 2 | 失败时继续 boot (server 仍 up) | 不让 migration bug 让 server 挂; 仅 log warn |
| 3 | lazy load pool (function 内 require) | 测试可 require module 不触发真 DB 连接 |
| 4 | `splitStatements` 简单 `;` 分割 | 不支持 DELIMITER/triggers; 足够 99% 用例 |
| 5 | `IF NOT EXISTS` 强制约定 | 双重保险: 即使被多次 apply 也 OK |
| 6 | 文件名 = 唯一 key (无 hash) | 简单可读; ops 查 schema_migrations 直接对应 git history |
| 7 | skip 旧 migration (无 .sql 文件) | schema.sql INSERT IGNORE 已经标记 001-005-028 legacy applied |

## 留 follow-up

| # | 项 | 谁 |
|---|---|----|
| 1 | server deploy R62 + 手动 apply 004-admin-audit.sql 修 Issue B | me (next deploy) |
| 2 | 加 006-privacy-versions.sql 等缺失的 migration 文件 (从 schema.sql 抽) | R63 follow-up |
| 3 | 加 dry-run mode (`MIGRATIONS_DRY_RUN=1` log 不 apply) | R63 |

## baseline

- backend: 425 + 9 (R59) + 9 (R62) = 443 / 0 fail / 1 skip
- mini-program: 47 / 0 fail
- 22 commits on develop (R40-R62)

## Commits (本 round)

| SHA | msg |
|-----|-----|
| (本 devlog + 6 files) | feat: R62 — auto-apply SQL migrations at boot (migrate.js + index.js boot + 9 tests + file consolidation) |