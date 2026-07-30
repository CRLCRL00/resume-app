# Phase 6 — 加固期 设计文档

> 日期：2026-06-29
> 阶段：6 / 8（上线打磨）
> 前置：[Phase 5 design](../specs/2026-06-29-简历推荐小程序-phase5-design.md)
> 状态：设计评审通过

---

## §1 目标与验收

### 目标

MVP 上线前加固 — **备份真演练 + 安全（MySQL 业务账号 + HTTPS 头）+ npm test hang 修**。

### 验收标准

| # | 验收项 | 通过条件 |
|---|--------|----------|
| 1 | 备份真演练 | mysqldump → 导入 `resume_app_test` → 表行数与生产一致 |
| 2 | MySQL 业务账号 | root 不再被 backend 用，新账号只 4 权限（SELECT/INSERT/UPDATE/DELETE） |
| 3 | HTTPS 头 | HSTS + CSP + X-Frame-Options 都在 curl -I 响应里 |
| 4 | npm test | 全部一次跑通 + 自动退出（< 60s）|
| 5 | 服务器 smoke | backend 仍 200 + 真 LLM 仍工作 |
| 6 | Devlog | 写完成总结 |

---

## §2 任务清单

### 2.1 MySQL 业务账号

**目的**：避免 backend 用 root 账号连 MySQL。

**步骤**：
```bash
# 服务器 SSH
ssh -i "C:/Users/CRL/.ssh/id_r" ubuntu@43.139.176.199

# 生成强密码（一次性）
NEW_PASS=$(openssl rand -hex 16)

# 创建账号（root 权限）
mysql -u root -pResumeApp@2026 << EOF
CREATE USER 'resume_app_user'@'localhost' IDENTIFIED BY '$NEW_PASS';
GRANT SELECT, INSERT, UPDATE, DELETE ON resume_app.* TO 'resume_app_user'@'localhost';
FLUSH PRIVILEGES;
SELECT user, host FROM mysql.user WHERE user='resume_app_user';
EOF
```

**改 `.env`**：
```ini
DB_USER=resume_app_user
DB_PASSWORD=$NEW_PASS   # 上面生成的值
```

**restart**：
```bash
pm2 restart resume-app-backend --update-env
```

**测试 backend**：
```bash
curl -sk https://43.139.176.199/api/health
# 期望 200
```

**Root 账号保留**（admin 任务用）：
- 备份脚本仍用 root（需 LOCK TABLES）
- Phase 6 ops 用 root

### 2.2 HTTPS 安全头

**修改 `/etc/nginx/sites-enabled/resume-app.conf`**：

在 `server { listen 443 ... }` 块里 `add_header` 区域加：

```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header Content-Security-Policy "default-src 'self'; img-src 'self' data:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://43.139.176.199;" always;
```

> 说明：
> - `script-src 'unsafe-inline'` 必需（小程序 SDK 用 inline script）
> - `connect-src https://43.139.176.199` 允许前端调后端
> - `img-src data:` 允许 base64 图（如有）

**应用**：
```bash
nginx -t && nginx -s reload
```

**验证**：
```bash
curl -sk -I https://43.139.176.199/api/health | grep -iE 'strict-transport|content-security|x-frame'
# 期望看到 3 行
```

### 2.3 备份真演练（独立 schema）

**步骤**：
```bash
# 服务器 SSH
ssh -i "C:/Users/CRL/.ssh/id_r" ubuntu@43.139.176.199

# 1. mysqldump（root 权限）
mysqldump -u root -pResumeApp@2026 --single-transaction --routines --triggers resume_app > /tmp/backup_drill_$(date +%Y%m%d).sql
ls -lh /tmp/backup_drill_*.sql

# 2. 记录生产行数
mysql -u root -pResumeApp@2026 resume_app -e "
SELECT 'users' AS tbl, COUNT(*) AS cnt FROM users
UNION SELECT 'resumes', COUNT(*) FROM resumes
UNION SELECT 'jobs', COUNT(*) FROM jobs WHERE is_deleted=0
UNION SELECT 'matches', COUNT(*) FROM matches
UNION SELECT 'admins', COUNT(*) FROM admins
UNION SELECT 'prompts', COUNT(*) FROM prompts
UNION SELECT 'admin_operation_logs', COUNT(*) FROM admin_operation_logs;
" > /tmp/backup_drill_before.txt
cat /tmp/backup_drill_before.txt

# 3. 创建独立 schema + 导入
mysql -u root -pResumeApp@2026 -e "CREATE DATABASE IF NOT EXISTS resume_app_test;"
mysql -u root -pResumeApp@2026 resume_app_test < /tmp/backup_drill_*.sql

# 4. 验证恢复行数
mysql -u root -pResumeApp@2026 resume_app_test -e "
SELECT 'users' AS tbl, COUNT(*) AS cnt FROM users
UNION SELECT 'resumes', COUNT(*) FROM resumes
UNION SELECT 'jobs', COUNT(*) FROM jobs WHERE is_deleted=0
UNION SELECT 'matches', COUNT(*) FROM matches
UNION SELECT 'admins', COUNT(*) FROM admins
UNION SELECT 'prompts', COUNT(*) FROM prompts
UNION SELECT 'admin_operation_logs', COUNT(*) FROM admin_operation_logs;
" > /tmp/backup_drill_after.txt

# 5. diff 对比（应无差异）
diff /tmp/backup_drill_before.txt /tmp/backup_drill_after.txt && echo "DRILL OK"

# 6. 清理
mysql -u root -pResumeApp@2026 -e "DROP DATABASE resume_app_test;"
rm -f /tmp/backup_drill_*.sql /tmp/backup_drill_*.txt
```

**报告输出**：devlog `2026-06-29-backup-drill.md` 记录：
- 时间
- 备份文件大小
- diff 结果（OK 或列出差异）
- 教训（如果有）

### 2.4 npm test hang 修

**原因**：HTTP 集成测试（route-auth、route-test-llm、route-admin-placeholder、resume-save、resume-current、health）跑完后没 `pool.end()` / `redis.quit()`，node:test 等 keep-alive socket 不退出。

**修法**：每个文件末尾加 `test.after`：

```js
// 例: tests/route-auth.test.js
test.after(async () => {
  await pool.end();
  await redis.quit();
});
```

**涉及文件**：
| 文件 | 现状 |
|------|------|
| `tests/route-auth.test.js` | 已有 `pool.end()` 缺 `redis.quit()` |
| `tests/route-test-llm.test.js` | 缺 |
| `tests/route-admin-placeholder.test.js` | 缺 |
| `tests/resume-save.test.js` | 缺 |
| `tests/resume-current.test.js` | 缺 |
| `tests/health.test.js` | 缺 |

**注**：不删测试逻辑（route-auth 已有 `pool.end()` 但缺 `redis.quit()`），只补全。

**验证**：
```bash
cd backend && timeout 60 npm test
# 期望 < 60s 跑完 + 显示 N pass
```

### 2.5 Devlog

写 `devlog/2026-06-29-phase6-verify.md`，包含：
- 5 任务完成
- 备份演练报告
- MySQL 账号变更（密码不写明文）
- HTTPS 头 curl 输出
- npm test 时间 + 通过数
- Phase 7 启动清单

---

## §3 文件改动清单

**后端**（无新代码）：
- 服务器 `.env`：DB_USER + DB_PASSWORD
- 服务器 `/etc/nginx/sites-enabled/resume-app.conf`：2 个 add_header

**后端测试**：
- 6 个文件：加 `test.after`

**文档**：
- `devlog/2026-06-29-phase6-verify.md`（新建）
- `devlog/2026-06-29-backup-drill.md`（新建）

**无新代码文件**（Phase 6 全是 ops + 测试清理）

---

## §4 部署

**无 push**（Phase 6 全在服务器上改）。

**部署顺序**：
1. MySQL 账号 + restart backend（**先**做，否则 nginx 改了再 restart 会失败）
2. 备份演练（不影响服务）
3. Nginx 配置（不影响服务）
4. npm test 修（本地跑）

---

## §5 风险 + 缓解

| 风险 | 缓解 |
|------|------|
| 业务账号 GRANT 不够 | 4 权限（SELECT/INSERT/UPDATE/DELETE）够 backend 所有 SQL |
| 业务账号密码泄露 | 仅 localhost，openssl rand 生成 16 字节 hex |
| CSP 阻断 | 用宽松策略（含 'unsafe-inline'，仅本域）|
| 备份演练误覆盖 | 独立 schema `resume_app_test`，不碰 `resume_app` |
| npm test 改坏测试 | 改一行 + 立即跑 + commit |
| `.env` 改错 | 保留 root 账号做 rollback |

---

## §6 范围之外（YAGNI）

| 不做 | 原因 |
|------|------|
| Redis 业务账号 | Redis 已有密码，localhost 限制够了 |
| 经验模糊匹配 | Phase 5 推到 Phase 6，但本 spec 不做 |
| Redis 降级日志 | Phase 5 推到 Phase 6，本 spec 不做 |
| jobs 复合索引 | MVP < 100 岗位，全表扫可接受 |
| 操作日志归档 | 1000 行后再说 |
| 错误监控告警 | MVP 阶段本地看 PM2 logs 够 |
| 微信审核材料 | Phase 7+8 准备 |
| HTTPS 真证书 | 备案后用 Let's Encrypt |

---

## §7 决策记录

**决策 1**：A 核心加固范围（不含 B 体验提升 + C 审核准备） — 用户选
**决策 2**：独立 schema 验证备份 — 用户选
**决策 3**：每个测试加 test.after（不用 force-exit） — 用户选
**决策 4**：新建 MySQL 业务账号 — 用户选
**决策 5**：HSTS + CSP（不只是 HSTS）— 用户选

**决策 6**（设计选择）：root 账号保留（admin/backup 用）— 设计选择
**决策 7**（设计选择）：C 含 'unsafe-inline'（小程序 SDK 必需）— 设计选择