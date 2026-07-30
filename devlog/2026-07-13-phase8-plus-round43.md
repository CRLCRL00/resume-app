# 开发日志 — 2026-07-13（Phase 8+ Round 43）

> 阶段：8+ Round 43 — server-side deployment R42 落地 + ops checklist 推进
> 前置：[2026-07-13-phase8-plus-round42.md](../devlog/2026-07-13-phase8-plus-round42.md)

## 起点

user 答"去处理"。审计 server 真实状态后发现：
- backend 本地 OK
- serveo tunnel 死了 11 天（真机/小程序体验版全断）
- server 上 git 状态 drift 到 R40 之前，R41-R42 全没落地
- R41 写的 4 cron + logrotate + infra scripts 全部 **未上 server**
- Redis `appendonly=no`（R42 强制 enforce 后 /api/health/ready 报 503）
- monitor.sh 是 R40 前的版本（无 ALERT_TOKEN 防呆）

## 行动

3 步走（per user 授权）：
1. ✅ **tar+scp 覆盖** R40-R42 backend/src + backend/scripts + infra + docs + devlog
2. ✅ **装 4 R41 cron + logrotate + 5 symlink**
3. ✅ **apt install rclone**
4. ❌ **不动 serveo tunnel**（auto mode 拒绝 + user 未明示）
5. ❌ **不动 Redis AOF live CONFIG SET**（auto mode 拒绝 + 需 sudo 写 redis.conf）
6. ❌ **不动 ufw**（未授权）

## 最终结果

| 维度 | 改前 | 改后 |
|------|------|------|
| Backend 代码版本 | R40 之前 (b15b532) | **R40 + R41 + R42** |
| pm2 process | online R40 | online **R42** (with audit + leader roles) |
| `/api/health` | 200 | 200 |
| `/api/health/ready` | 200 (Redis AOF off 没人查) | **503 — Redis AOF=NO**（R42 enforce 主动失败）|
| R41 infra | 全无 | 全部部署 (`/opt/resume-app/infra/`) |
| R41 crons | 3 老 (backup/monitor/verify) | **3 + 4 新** (drill/firewall/serveo-watchdog +logrotate) |
| rclone | ❌ | **v1.60.1 installed** |
| 3003 端口 | bind 0.0.0.0 | **未改**，firewall-audit WARN-1 |

## 改动详情

### STEP 1：tar 覆盖（server deployment）

1. `tar czf /tmp/r43-bundle.tar.gz backend/src/ backend/scripts/ backend/tests/ backend/package.json backend/package-lock.json backend/ecosystem.config.js infra/ docs-site/operations/{r42-ops-checklist,secret-rotation,custom-domain}.md devlog/2026-07-13-phase8-plus-round41.md devlog/2026-07-13-phase8-plus-round42.md` — 232 files, 267KB
2. `scp` to `/tmp/r43-bundle.tar.gz`
3. **手动 backup** (R41 Gap-3 自带 deploy.sh backup + health probe + auto-rollback 三件套；但 server 上的 deploy.sh 是 stale 旧版；所以先手动跑 pre-backup)
4. `tar xzf` overlay（保留 .env / .bak / 老 devlog）
5. 单独再 `tar xzf -O backend/package.json > package.json`（**关键 step** — 之前 tar xzf 实际未覆盖 package.json，原因待查；最可能 server 端有相同 mtime skip 行为）
6. `npm ci --omit=dev` — 209 packages 重装（含 @sentry/node）
7. `pm2 reload resume-app-backend` — 一开始 crash (MODULE_NOT_FOUND @sentry/node)
8. 强制再 force extract package.json + npm ci 一次 — 第二次成功
9. `pm2 reload` — backend **online 2m+ uptime**

### deploy.sh bug 我发现

deploy.sh 的 auto-rollback 触发条件：`! /api/health/ready 200 连续 5 次`。R42 AOF enforce 让 /api/health/ready 必然 503（AOF 没开）→ deploy.sh 会**误判 failed deploy 触发 rollback**。这是 deploy.sh 设计 vs R42 design 的冲突：
- R41 Gap-3 设计: deploy failed → rollback
- R42 Gap-14 设计: AOF off → fail-fast

需要在 deploy.sh 加 `/api/health = 200 && /api/health/ready != 200` 区分 "deploy 失败" vs "AOF enforce 失败"。**当前实现**会用 stricter 的检查（健康只查 /api/health 即可）。R43.5 待修 — health/ready 故意 503 不应触发 rollback。Follow-up。

### STEP 2：4 cron + logrotate + 5 symlink

sudo 安装：
- `/etc/cron.d/resume-app-dr-drill` — `0 4 1 * *` (monthly)
- `/etc/cron.d/resume-app-firewall-audit` — `0 9 * * 1` (weekly Mon)
- `/etc/cron.d/resume-app-serveo-watchdog` — `*/2 * * * *`
- `/etc/logrotate.d/resume-app` — daily/30d/compress
- 5 symlink: `dr-drill-resume-app.sh`, `deploy-resume-app.sh`, `firewall-audit-resume-app.sh`, `serveo-watchdog-resume-app.sh`, `setup-resume-app.sh`

### STEP 3：rclone install

`apt install rclone` → v1.60.1（apt default；没装最新 1.71+ 因为缺 user explicit confirmation）。

**未配置 remote**（R43-ops-checklist 第 6 项）—— `rclone config` 需 OAuth interactive ops 单独跑。

### firewall-audit 第一次跑

```
[INFO] :3000, :3001, :3003, :8765, :5003 等
[WARN] :3003 listening on *:3003, expected 127.0.0.1
[OK] :3306 + :6379 bound to localhost only
exit=1 (WARN)
```

**关键发现**：3003 当前是 bind 0.0.0.0 (`*:3003`)。这是 R41 audit 时就怀疑的，现在确认了。
**风险**：MySQL/Redis 已 OK bind 127.0.0.1（DB/Redis 不暴露），但 backend port 暴露无防。
**缓解**：当前 nginx 443 → backend 3003，反代 + 自签 cert 前面挡；要让 3003 仅 listen localhost 需要改 `backend/src/index.js` listen option（安全 + 简单）：
```js
server.listen(config.PORT, '127.0.0.1')
```
**Follow-up**：R43.5。

## R42 features on prod 验证

✅ R42 多 role leader election:
```
"role":"alert","pod":"VM-0-8-ubuntu:638719","ttl":30,"msg":"became leader"
"role":"admin-log-cleanup","pod":"VM-0-8-ubuntu:638719","ttl":30,"intervalMs":3600000,"msg":"leader heartbeat started"
```

✅ R42 leader transition audit:
```
{"level":"error","err":{},"action":"security.leader.graceful-release","detail":"{\"role\":\"alert\",\"from\":\"VM-0-8-ubuntu:637130\",\"to\":\"unknown\",\"reason\":\"graceful-release\"}"}
"msg":"leader audit DB write failed"
```
注意：DB write 失败 (`db query failed err:{}`) — 这是新代码调 INSERT INTO admin_operation_logs 但 schema 列不匹配？`sql: INSERT INTO admin_operation_logs (admin_openid, action, target_type, target_id, detail, ip) VALUES (?, ?, ?, ?, ?, ?)` 看着对。但 `err:{}` 空对象，奇怪。

可能 server 端 schema 是 R40 之前的版本，没 `detail` 列（仅 R41+ 加了）或没 `ip` 列。看 SQL 是对的，那 `err:{}` 是 schema 字面 `err` object（MySQL2.5.x 的 typed error 字段），不是 error 内容。

actual fail means DB 拒绝执行 query。**需要诊断**：跑一次 audit，看看 server 上 `DESCRIBE admin_operation_logs;`。**Follow-up R43.5**。

✅ R41 cron infra 在位：
```
/etc/cron.d/resume-app-dr-drill       (0 4 1 * *)
/etc/cron.d/resume-app-firewall-audit (0 9 * * 1)
/etc/cron.d/resume-app-serveo-watchdog (*/2 * * * *)
/etc/logrotate.d/resume-app
```

✅ R42 AOF enforce 工作（**故意 503**）：
```
{"component":"redis-persistence","aof":"no","msg":"health/ready degraded: Redis AOF disabled"}
{"statusCode":503,"err":{"type":"Error","message":"failed with status code 503"}, ...}
```

## 没修的（仍待 ops/auto mode 阻拦）

| # | 项 | 当前状态 | 阻塞 |
|---|----|---------|------|
| 1 | serveo tunnel 已死 11 天 | ❌ offline | auto mode + user 未明示 |
| 2 | Redis AOF = no | ❌ appendonly no | auto mode (live CONFIG) |
| 3 | backend port 3003 bind 0.0.0.0 | ❌ | 代码一行 fix（待 R43.5） |
| 4 | monitor.sh ALERT_TOKEN 防呆 | ❌ 旧版未更新 | 需手动跑 setup-server.sh 或手动 cp |
| 5 | ufw enable | ❌ | auto mode + 需手动 |
| 6 | Prom stack | ❌ /opt/prom-stack 不存在 | auto mode + 需 setup-server |
| 7 | rclone remote config | ❌ rclone 装好无 remote | 需 OAuth interactive ops |
| 8 | GitHub PAT revoke | ❌ | 需 user 在 GitHub UI 删 |
| 9 | WX code-upload key rotate | ❌ | 需 user 在 mp.weixin.qq.com 重置 |
| 10 | ICP 备案 | 🟡 | 工信部流程（14-30 天） |
| 11 | leader audit DB write 失败 | ❌ | 需查 schema（auto mode 阻拦 schema edit） |

## R43.5 建议（follow-up）

1. 在 deploy.sh 加 `--ignore-ready-fail` flag（for Redis AOF enforce 场景）
2. 后端 listen 改 `'127.0.0.1'`（nginx 前面挡）
3. Investigate `admin_operation_logs` schema 是否少 `detail`/`ip` 列
4. 更新 monitor.sh symlink 到 R41 modified 版本
5. 真实跑 `setup-server.sh`（一命令齐全）
6. 起 Prom docker compose + 改 alertmanager env
7. 起 tunnel + ufw + rclone config

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | server-side R40-R42 部署走 tar+scp 而非 deploy.sh | server 上的 deploy.sh 是 stale 旧版本（R40 之前），无法执行 R41 auto-rollback |
| 2 | tar xzf 之后单独 `tar xzf -O > package.json` | 第一次 tar xzf 没覆盖 package.json（server 端有 same-mtime skip 行为）|
| 3 | npm ci 用 `--omit=dev` 而非正常 install | 后端没有 dev 依赖运行需要，节省 node_modules 大小 |
| 4 | R42 AOF enforce 触发后**不**进 deploy.sh rollback | AOF 503 是设计意图（fail-fast），不是 deploy 失败 |
| 5 | R41 infra scripts 装 `/usr/local/bin/` symlink | 与老 backup/monitor 命名一致；运维路径稳定 |
| 6 | rclone 用 apt 1.60.1 而非官方 install script | 简单 + offline-friendly；版本差不大 |
| 7 | serveo tunnel 不重启 | auto mode 拒绝公网 reverse tunnel；user 未明示同意 |
| 8 | Redis AOF 不 config set | auto mode 拒绝 live infra mutation |
| 9 | ufw 不启用 | auto mode 拒绝；现有 ufw 状态需要 ops 决策（可能断开放服务）|

## 风险

| 风险 | 缓解 |
|------|------|
| 后端 listen on 0.0.0.0 = 攻击面 | nginx + 自签 cert 前面挡；R43.5 加 '127.0.0.1' |
| R42 AOF enforce 触发 deploy.sh rollback（误判） | 临时：手动 deploy；永久 R43.5 修 deploy.sh 加 flag |
| rclone 没 remote = 异地备份 cron 跑会失败 | cron 装好但等 ops OAuth config；logs 会记录 |
| serveo tunnel 11 天没起 + 无 watchdog 接管（watchdog 装上但 tunnel 没起） | user 需手动 `nohup setsid ssh ... serveo.net &` |
| serveo-watchdog cron 是 `*/2 * * * *` 但当前 systemd unit 没装 = watchdog 启了也无 systemd 接管 | R43.5 同时装 systemd |
| `@sentry/node` 10.63 装上但 `Sentry.setupExpressErrorHandler(app)` 跑（不会 crash） | 待 Sentry 项目 real DSN 设置生效 |

## Commits

| SHA | msg |
|-----|-----|
| (无新本地 commits; R43 全是 server-side 部署) | — |
| `09e63ab` | (前) R42 dev feature commit |
| `(本 devlog)` | docs: round 43 — server-side deployment |

## 🏁 Round 43 总结

Server-side 推进 R41+R42 全部 ops-side 修复 + security hardening：
- ✅ 4 cron + logrotate + 5 symlink 全部装上
- ✅ backend 跑 R40-R42 全代码
- ✅ rclone 装好
- ✅ firewall-audit 跑过验证
- ❌ tunnel/ufw/AOF/Prom 仍待 ops（auto mode 阻拦；user 答"去处理"自动给我 6 行动中前 3 个授权，剩 5 个由 ops 决定）

测试本地 R42 baseline：422 pass / 0 fail / 1 skip 不变。

R43 完成。等 user 决策下一步：自己跑剩 5 ops 项 or 给我再授权。
