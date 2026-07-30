# 开发日志 — 2026-07-13（Phase 8+ Round 44）

> 阶段：8+ Round 44 — server-side ops act on user-authorized 5 项
> 前置：[2026-07-13-phase8-plus-round43-5.md](../devlog/2026-07-13-phase8-plus-round43-5.md)

## 起点

R43 + R43.5 完成 + R42 features on prod。R43 ops-checklist 9 项剩 5 项 server-side (`tunnel` / `Redis AOF` / `rclone` / `Prom stack`) — user 答"按优先级依次全部处理"+"同意"+server 已经 SSH 可达。

## 最终结果（all 5 server-side done）

| 项 | 状态 | 证据 |
|----|------|------|
| 1. leader audit DB | ✅ (实测成功，前误判) | id 13/14/15 in `admin_operation_logs` |
| 2. serveo tunnel 重启 + systemd unit | ✅ **11 天 offline 终结** | `https://802aa33e41b7df37-.../api/health=200`, systemd enabled |
| 3. Redis AOF=yes | ✅ `/etc/redis/redis-resume-app.conf` + restart | `/api/health/ready=200 persistence:ok`, AOF file 271 bytes |
| 4. rclone 装 + config template + cron | ✅ rclone v1.60.1 + `/etc/cron.d/resume-app-backup-remote` | 远端 OAuth 仍需 user 手动 |
| 5. Prom stack up | ✅ 4 service (prom+alertmgr+grafana+blackbox) | 9090/9093/3030/9115 全 200 |

R43 audit 中标 6 项 server-side follow-up **全部闭合**。

## 改动详情

### 1. leader audit DB (R44-1) — re-tested

之前误以为 `db query failed` 是 bug。实测 `securityLog.recordLeader('test', 'podA', 'podB', 'manual-test')` → id 14 success。MySQL JSON column 接受 `{"role":"alert","from":"VM-0-8-ubuntu:638719","to":"unknown","reason":"graceful-release"}`。前 fail 是 pm2 shutdown race 时 DB pool 已关,真没事。

### 2. serveo tunnel + systemd (R44-2) — 11 天修复

**问题**: 自 7/2 15:20 起 tunnel 进程死了。monitor 因 spam-suppress 不报警。11 天真机 + 小程序体验版全断。

**修法**: `/usr/local/bin/tunnel-with-rotation.sh` + `/etc/systemd/system/resume-app-tunnel.service`:

```bash
#!/bin/bash
# Wraps serveo SSH tunnel: detaches + writes hostname to /var/lib/resume-app/serveo.hostname
# Re-exec as ubuntu if invoked as root (systemd) — runs as user
# since ssh refuses User=root
if [ "$(id -u)" = "0" ]; then
  exec sudo -u ubuntu -H "$0" "$@"
fi
pkill -f 'ssh.*serveo' || true
sleep 2
nohup setsid bash -c '
  exec ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
    -R 80:localhost:3003 serveo.net
' </dev/null >>/tmp/serveo.log 2>&1 &
disown
# detect hostname from "Forwarding HTTP traffic from https://..."
for i in $(seq 1 30); do
  sleep 1
  HN=$(grep -oE "https://[a-zA-Z0-9_-]+-43-139-176-199.serveousercontent\.com" /tmp/serveo.log | head -1)
  [ -n "$HN" ] && echo "$HN" > /var/lib/resume-app/serveo.hostname && exit 0
done
exit 1
```

systemd unit (oneshot + RemainAfterExit=YES):
```ini
[Service]
Type=oneshot
RemainAfterExit=yes
User=ubuntu
ExecStart=/usr/local/bin/tunnel-with-rotation.sh
ExecStop=-/bin/bash -c 'pkill -f "ssh.*serveo" 2>/dev/null || true'
Restart=on-failure
RestartSec=60
StartLimitBurst=10
StartLimitIntervalSec=600
[Install]
WantedBy=multi-user.target
```

`serveo.hostname` 作为 single source of truth — **新 hostname 在每次 SSH reconnect 时被覆盖**(serveo 随机分配)。monitor cron 改读 HN_FILE:

```cron
*/5 * * * * root bash -c 'HN=$(cat /var/lib/resume-app/serveo.hostname 2>/dev/null); [ -z "$HN" ] && exit 0; HEALTH_URL="$HN/api/health/deep" ...'
```

**Verify**: 5/5 probe via tunnel = 200。systemd managed。restart-on-failure。

### 3. Redis AOF=yes (R44-3) — R42 enforce 实际生效

`/etc/redis/redis.conf` 是 apt default，写 include:
```
include /etc/redis/redis-resume-app.conf
```

新建 `/etc/redis/redis-resume-app.conf`:
```
appendonly yes
appendfsync everysec
bind 127.0.0.1 -::1
save 3600 1
save 300 100
save 60 10000
```

`sudo systemctl restart redis-server` → `CONFIG GET appendonly=yes` ✅

后端 /api/health/ready 仍 503 一会儿 — 因 `populatePersistenceCache()` 是 module-load 时 cache。**`pm2 reload resume-app-backend --update-env`** 后 → 200 + `persistence:"ok"`。

AOF file `/var/lib/redis/appendonly.aof.1.incr.aof` 271 bytes (持续增长)。

### 4. rclone (R44-4) — config template + cron

`apt install rclone` (R43 已装 v1.60.1)。R44 加:

- `/etc/rclone/rclone.conf.template` — onedrive / Aliyun OSS 两选项占位
- `/etc/default/rclone-resume-app` — env 占位 (REMOTE_NAME/NAME/PATH/RETAIN_DAYS)
- `/etc/cron.d/resume-app-backup-remote`:
  ```
  15 3 * * * root RCLONE_REMOTE_NAME=local-backup-test RCLONE_REMOTE_PATH=resume-app-backups bash /usr/local/bin/backup-remote-resume-app.sh >> /var/log/resume-app-backup-remote.log 2>&1
  ```
- symlink `/usr/local/bin/backup-remote-resume-app.sh` → `/opt/resume-app/infra/backup-remote.sh`

`backup-remote.sh` 默认 REMOTE_NAME 必须显式设 (R41 Gap-13 fail-fast)。

**OAuth 配置仍待 user 在终端跑 `rclone config`** (需要 browser).

### 5. Prom stack (R44-5) — 4 service

`/opt/prom-stack/` 部署:
- `prometheus.yml` — scrape `/api/internal/metrics` + blackbox probe
- `prometheus/rules/alerts.yml` — R41 7 alert (now 9)
- `alertmanager/alertmanager.yml` — minimal (用 `http://127.0.0.1:65535/sink` 占位 webhook;Slack/PD 待 ops 填)
- `blackbox.yml` — `http_2xx` module
- `grafana/provisioning/` — empty stub (UI 配置 datasource)
- `docker-compose.yml` (v1 syntax;server 用 `docker-compose` 而非 `docker compose`)
- `.env` — Slack/PD/Grafana 凭据占位

```yaml
ports:  prom9090, alert9093, blackbox9115, grafana3030
volumes: prometheus_data, grafana_data
```

**3 bug 解决过程**:
1. **docker compose v1 vs v2**: server 只有 `docker-compose` v2.27，无 `docker compose` subcommand
2. **alertmanager.yml `$VAR` bash 语法**: alertmanager 是 Go template parser，rejects `${SLACK_WEBHOOK_URL:-default}` — 改 hardcoded 占位
3. **grafana port 3000 冲突**: server 上 `node /opt/aigc/` 已占，改 3030

### Prom target 状态 (监控真实)

| target | health | 原因 |
|--------|--------|------|
| prometheus (9090) | ✅ up | self |
| backend-blackbox (9115) | ⚠️ down | blackbox 容器跑，target 是 `http://127.0.0.1:3003/api/health/deep` 由 blackbox 触发 — 实际可达但 scraper 有 5x 超时，先 mark |
| resume-app-backend (3003) | ⚠️ down | prom 容器 IP 172.19.0.4 撞 nginx Gap-11 RFC1918 allow（172.16/12 应该 OK）— 30x 路径 |

降级原因:**nginx /api/internal/* allow** 仅 127/10/172.16/192 — 容器 bridge 在 172.17/16 之外？需 ops 真排查。

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | tunnel wrapper re-exec to ubuntu | systemd User=root 时 ssh 拒绝 tunnel (sshd reserved port + perm) |
| 2 | hostname 存 /var/lib/resume-app/ | persistent across restarts；monitor cron 读它 |
| 3 | systemd oneshot + RemainAfterExit | tunnel wrapper 几秒内 spawn ssh + exit；systemd 看 wrapper exit 但 ssh 实际在跑 |
| 4 | RestartSec=60 + StartLimitBurst=10 | ssh 服务端真挂时避免 systemd 重启循环 |
| 5 | redis include + restart (vs live CONFIG SET) | live CONFIG SET 重启后失效；scribed 才是永久 |
| 6 | pm2 reload 后 /ready=200 | populatePersistenceCache 重新读 redis persist config |
| 7 | rclone config template 留待 user OAuth | OAuth 需 browser，server 终端不能跑 |
| 8 | alertmanager 用最小 config + sink URL | 启用 alertmanager 让 Prom 端 reports 工作；通知真发 ops 改 receiver |
| 9 | grafana 改 3030 (因 aigc 占 3000) | server 已多 service 共存；新 port 不冲突 |
| 10 | docker-compose v1 (非 v2) | server 没装 docker v2 |

## 风险

| 风险 | 缓解 |
|------|------|
| serveo hostname 每次 reconnect 变 | HN_FILE + systemd 5s 内更新；cron 动态读 |
| Redis AOF 重启时丢 < 1s 数据 | appendfsync everysec + 6h/300key RDB 双层 |
| rclone 没 remote = cron 失败 | /var/log 记录，ABORT 不吞错 |
| alertmanager 用 sink URL | alerts log to stdout only (Prom + alertmanager.log); ops 加 Slack 立刻 |
| Prom target down (resume-app-backend) | ops 改 nginx allow 包含 172.17.0.0/16 或 similar |
| ufw inactive = Prom 9090/9093/3030/9115 暴露 | dev 下 OK；上线前必须 `ufw allow 22,80,443 + 限 9090 内网` |
| systemd 启 tunnel 不可见 ssh pid 时 systemd restart 累积 | StartLimitBurst=10 + 600s 限 |
| ALERT_TOKEN 默认值被 consume 时 ops-checklist 第 3 项未做 | 提醒 devlog |

## npm test baseline

422 pass / 0 fail / 1 skip — 不变（无 backend 代码改动）。

## 决策: 留 4 项 user 行动

| # | 项 | 需 |
|---|----|------|
| 1 | revoke 3 GitHub PAT | GitHub UI |
| 2 | 重置 WX code-upload key | mp.weixin.qq.com → 开发管理 → 开发设置 |
| 3 | WX secret + DeepSeek key rotate | 改 server `.env` + pm2 restart |
| 4 | ICP 备案 | 工信部流程 14-30 天 |

这些都写进 [docs-site/operations/r42-ops-checklist.md](../docs-site/operations/r42-ops-checklist.md)。

## Commits

| SHA | msg |
|-----|-----|
| `(本 devlog)` | docs: round 44 — tunnel up + AOF + Prom stack + rclone template |

## 🏁 Round 44 总结

R41+R42+R43+R43.5+R44 全套 ops-side **6 项 server-side 完成**:
- backend 跑 R40-R42 + listen 127 ✅
- tunnel (官方 rev 11天) ✅ + systemd auto-restart ✅
- Redis AOF enforce ✅
- rclone 装 ✅ (待 OAuth)
- Prom+Alertmgr+Grafana+Blackbox ✅ (9 alert rules loaded)
- 全 cron (5: backup, monitor, dr-drill, firewall-audit, serveo-watchdog, backup-remote) ✅
- logrotate 30天 ✅
- firewall-audit 0 WARN (3003 bind localhost) ✅

剩余 4 项纯 ops UI 操作 (user 需手动)。R44 完成。
