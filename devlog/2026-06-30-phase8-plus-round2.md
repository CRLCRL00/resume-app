# 开发日志 — 2026-06-30（Phase 8+ Round 2）

> 阶段：8+ (服务端加固)
> 前置：[2026-06-30-phase8-plus-hardening.md](2026-06-30-phase8-plus-hardening.md)

## 目标

Round 2 加固：
- A. API 限流（auth）
- B. 敏感日志脱敏
- C. 自动 backup + cron

## 最终结果

| 项 | 状态 |
|----|------|
| A auth /login IP 限流 | ✅ 10/分钟 |
| B log 脱敏 | ✅ Bearer/JWT/sk-.../手机号/特定 key 名 |
| C mysqldump cron | ✅ /etc/cron.d 03:00 每日 |
| npm test | ✅ 114/114 × 3 绿 |

## 改动详情

### A — Auth 限流

`backend/src/routes/auth.js`:
```js
router.post('/login', async (req, res, next) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
  const rl = await rateLimit.check(`login:ip:${ip}`, 10, 60);
  if (!rl.allowed) throw new AppError(1429, '登录尝试过多，请稍后再试', 429);
  // ...
});
```

防爆破 + 减轻 code2session 微信接口压力。

### B — 日志脱敏

`backend/src/utils/logger.js` 加 redactFormat：
- 字符串模式：`Bearer ...`、`sk-...`、`1[3-9]xxxxxxxxx`
- 对象 key 名匹配（大小写不敏感）：`password`/`token`/`jwt`/`authorization`/`apikey`/`wx_secret`/`code`/`openid`
- 输出 winston info 前 redact，message 字段也处理

### C — Backup cron

`backend/scripts/backup.sh`:
- 读 `DB_PASSWORD` from `/opt/resume-app/backend/.env`（避免 hardcode）
- `mysqldump --single-transaction --quick --routines --triggers` → gzip
- 输出：`/var/backups/resume-app/resume-app-YYYYMMDD-HHMMSS.sql.gz`
- 日志：`/var/log/resume-app-backup.log`
- 7 天前自动删除
- 已上传 `/usr/local/bin/backup-resume-app.sh` (executable)
- cron：`/etc/cron.d/resume-app-backup` 行 `0 3 * * * root /usr/local/bin/...`

#### 已知警告（非致命）
- mysqldump 输出 PROCESS privilege 警告（无文件级锁信息）— 不影响数据导出
- 用 `Using a password on the command line` warning — `--defaults-extra-file` 模式可消除，留待下轮

#### 验证
- 一次手动跑：5658 bytes 备份，包含 7 张 CREATE TABLE（admin_operation_logs, admins, jobs 等）
- cron 已装，明天 3 点自动跑

## npm test

| Run | 通过 | 失败 |
|-----|------|------|
| 1 | 114/114 | 0 |
| 2 | 114/114 | 0 |
| 3 | 114/114 | 0 |

## 风险

| 风险 | 缓解 |
|------|------|
| cron 失败无监控 | log 文件，下一轮加 monitor |
| 备份 7 天 → 不够长 | 数据量小（<50MB），保留仍可达数月 |
| redact 漏掉新 case | 单元 / e2e 可加「无敏感输出」断言 |

## Commits

（会多 commit + push）
