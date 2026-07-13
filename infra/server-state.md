# Resume App Server State

> **目标**: 任何 ops 接手无需 ssh 就能知道 server 装了什么 / 怎么配的 / 在跑什么。
>
> **更新规则**: 任何手动对 server (`43.139.176.199`) 的状态改变 24h 内必须同步更新本文档,否则视为漂移。
>
> **不替代**: GitOps / Ansible / Terraform。本文档是 zero-IaC 阶段的替代品,L2 (Ansible) 落地后此文档迁移为 `ansible-vars.yml` 注释。

## 当前 Servers

| Server | IP / hostname | Role | OS | 公网 / 内网 | Created |
|--------|--------------|------|-----|-----------|---------|
| prod-01 | `43.139.176.199` | production | Ubuntu 22.04 (assumed) | 公网 | 2025-Q4（手动搭）|
| tunnel-host | 同上,通过 serveo.net 反向 | dev / preview | n/a | 公网 | 持续 |

**staging / DR**: 当前未起。R41-Gap-1 已加 deploy.yml env 分流,起一台 staging VM 即可。

## 安装的服务

### Node.js + PM2

- **路径**: `nvm` (`/usr/local/nvm`),全局 `pm2`,Node 22.x
- **项目**: `ecosystem.config.js`(working dir `/opt/resume-app/backend`)
- **pm2 进程**:
  - `resume-app-backend` — 主后端 (instances:1, fork mode, max_memory_restart: 500M)
  - `resume-app-tunnel` — systemd 单元(非 pm2),service mode, Restart=always
- **日志**: `/home/ubuntu/.pm2/logs/resume-app-backend-{out,err}.log`

### MySQL 8

- **端口**: 3306,bind `127.0.0.1`(Gap-20 audit 强制项)
- **用户**: `resume_app_user`(业务账号,仅 SELECT/INSERT/UPDATE/DELETE)
- **Root**: 仅 unix socket auth,不允许远程 root
- **数据库**: `resume_app`(prod)
- **慢查询阈值**: `DB_SLOW_QUERY_MS=1000`(1s,可在 .env 改)
- **MySQL 配置**: `/etc/mysql/mysql.conf.d/mysqld.cnf`(只 bind-address 一项是手动改的)

### Redis 7

- **端口**: 6379,bind `127.0.0.1`,requirepass
- **持久化** (Gap-14): `appendonly yes`, `appendfsync everysec`
- **配置分片**: `/etc/redis/redis-resume-app.conf`(`include` 关系)
- **重启策略**: `appendonly=yes` + everysec 意味着最多丢 1s 数据。
- **强制**: `/api/health/ready` 在生产环境检测 aof != yes 时返 503

### nginx

- **Server block**: `/etc/nginx/sites-enabled/resume-app.conf` (来自 `deploy/nginx/`)
- **端口**: 80 (→ 301 HTTPS) + 443
- **TLS**: 当前自签 (`/etc/nginx/ssl/resume-app.{crt,key}`);Gap-18 计划换 Let's Encrypt
- **关键 location**:
  - `/api/internal/*` — 仅 127.0.0.1 + RFC1918 (Gap-11 限)
  - `/api/*` — 反代 `127.0.0.1:3003`,35s timeout
- **cert 计划过期**: 自签证书 365 天 (2025-XX-XX)
- **Reload 触发**: 编辑 nginx conf 后 `nginx -t && systemctl reload nginx`,不得 restart

### systemd 服务

| Unit | Type | Restart | 备注 |
|------|------|---------|------|
| `nginx.service` | n/a | n/a | 系统默认 |
| `mysql.service` | n/a | n/a | 系统默认 |
| `redis-server.service` | n/a | n/a | 系统默认 |
| `resume-app-backend.service` | oneshot | on-failure | 调 `pm2 startOrReload ecosystem.config.js` |
| `resume-app-tunnel.service` | simple | always | serveo ssh 隧道,StartLimitBurst=10/300s 防 socket leak |
| `fail2ban.service` | n/a | n/a | sshd jail only |

### cron jobs

| 时间 | 脚本 | Log |
|------|------|-----|
| `0 3 * * *` | `backend/scripts/backup.sh` | `/var/log/resume-app-backup.log` |
| `*/5 * * * *` | `backend/scripts/monitor.sh` | `/var/log/resume-app-monitor.log` |
| `0 4 1 * *` | `backend/scripts/dr-drill.sh` | `/var/log/resume-app-dr-drill.log` |
| `0 9 * * 1` | `infra/firewall-audit.sh` | `/var/log/resume-app-firewall-audit.log` |
| `*/2 * * * *` | `infra/serveo-watchdog.sh` | `/var/log/resume-app-serveo-watchdog.log` |

## 配置文件

| 文件 | 维护者 | 备份 | 说明 |
|------|--------|------|------|
| `/opt/resume-app/backend/.env` | 单一来源 | 手维护 | **绝不** git 覆盖 |
| `/opt/resume-app/backend/.env.example` | 仓库 | git | 模板;`.env` 改完必 diff |
| `/etc/mysql/...` | 系统默认 | apt | 仅 `bind-address` 手动 |
| `/etc/redis/redis-resume-app.conf` | 仓库 infra/ | n/a | include 进 redis.conf |
| `/etc/nginx/sites-enabled/resume-app.conf` | 仓库 deploy/nginx | git | 改完 reload,不大改 |
| `/etc/systemd/system/resume-app-*.service` | 仓库 infra/setup-server.sh | n/a | 装时一次 |

## Firewall (ufw)

```
22/tcp  ALLOW       # SSH
80/tcp  ALLOW       # HTTP → 301 HTTPS
443/tcp ALLOW       # HTTPS
```

DB / Redis / backend port **不应** 在 ufw allow — 因为它们只 bind 127.0.0.1,ufw 默认 deny incoming 已生效。

每 `/opt/resume-app/infra/firewall-audit.sh` 自动检查(每周一 09:00)。

## Backup

- **本地**: `/var/backups/resume-app/resume-app-YYYYMMDD-HHMMSS.sql.gz`
- **保留**: 7 天本地 + 30 天异地(rclone)
- **异地**: rclone 远端(可选 S3 / OneDrive),`infra/backup-remote.sh`
- **校验**: 备份后跑 `infra/../verify-backup.sh`(CREATE TABLE ≥5 + ≥1KB + zcat OK)
- **DR drill**: 每月 1 号 04:00 (`dr-drill.sh`) — 真灌 backup 到 `resume_app_test_dr_*` 库验证可恢复

## 已知手动项

> 这些是「没 IaC 时仍存在的手动功夫」;迁到 L2 Ansible 后应逐条消除。

- [ ] `~/.ssh/authorized_keys` 每季度清一次离职 key
- [ ] MySQL bin log retention (28 天) 是否充足？默认 7 天可能被合规质疑
- [ ] Redis RDB 备份?当前只 AOF,RDB snapshot 未开;若 AOF 文件损坏无法回放 (Gap-14 加 RDB 是 follow-up)
- [ ] serveo tunnel hostname 一旦换 IP 需要更新 mp.weixin.qq.com 合法域名 + GH Secrets
- [ ] /home/ubuntu/.pm2/logs rotate?已被 logrotate.d/resume-app 处理,但 pm2 自己也开 merge_logs=true,要注意兼容性

## IaC 升级路径 (L2 → L3)

| Level | 状态 | 文档 |
|-------|------|------|
| L0 手动 | ✅ 当前 | 本文档 |
| L1 setup-server.sh | ✅ R41 | `infra/setup-server.sh` |
| L2 Ansible | ⏸ 计划 | 待写 `infra/ansible/` |
| L3 Terraform | ⏸ 计划 | 待写 `infra/tf/` |

每级需替换对应 L 的"人工 habit"为 declarative。L2 工作量 ~2 天。
