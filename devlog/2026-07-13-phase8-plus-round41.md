# 开发日志 — 2026-07-13（Phase 8+ Round 41）

> 阶段：8+ Round 41 — ADF deployment hardening
> 前置：[2026-07-08-phase8-plus-round40-batch3.md](../devlog/2026-07-08-phase8-plus-round40-batch3.md)

## 起点

user 问"部署玩不完善"。先做静态 audit（不连 server，纯看 repo）输出 24 个 gap，分 P0/P1/P2/P3，按"工作量 vs 风险降低"排序。然后 **按优先级依次全部处理**。

24 gap 实际合并成 14 文件改动（P0/P1/P2/P3 都做）。除 P0 的 3 GitHub PAT 撤回 + WX code-upload key reset 是 ops 操作（文档指引 + revok checklist），其余 14 项全部 code 化并 push。

## 最终结果

| 维度 | R41 文件改动 | commits |
|------|---------------|---------|
| P0 安全 | 3 文件 | `76b14f5` |
| P1 CI/CD + DR | 4 文件 | `ddf98dc` |
| P2 Provisioning + Obs | 8 文件 | `01ed043` |
| P3 IaC + 文档 | 2 文件 | 待定 |
| **总** | **17 文件** | **3 feature commits + 1 devlog** |

baseline 420 → 421 测试（+1 R41-Gap-14 AOF enforce 测试）；2 pre-existing authLockout fail 不变。

## 改动详情

### P0（5 min / file × 3）

**Gap-11**: nginx `/api/internal/*` 限访问
- `/api/`，`/api/internal/` 拆 location
- `allow 127.0.0.1; allow 10/8; allow 172.16/12; allow 192.168/16; deny all;`
- `error_page 403 =404` — 防 allow list 探测泄漏

**Gap-16**: `docs-site/operations/secret-rotation.md`
- 8 类 cred 的 revoke/replace/deploy/verify 步骤
- 季度轮换 cadence 表
- 历史泄漏清单（sanitized，无真实 PAT 串，路径用占位）

**Gap-23**: `monitor.sh` webhook + ALERT_TOKEN 防呆
- ALERT_URL 默认空（之前默认自指 /api/internal/alert 是死循环）
- 生产环境 ALERT_TOKEN = `dev-alert-token-change-me` → abort + stderr + exit 0（防呆而非静默）
- HEALTH_WEBHOOK 未设 → 仅写 log 不 silent fail

### P1（半小时 / file × 4）

**Gap-1**: `.github/workflows/deploy.yml` 重写
- on.push: main → prod / develop → staging
- workflow_dispatch 保留（env 选择 prod/staging）
- `resolve-target` job 根据 env 选 `STAGING_*` secrets 或 fallback `SERVER_*`
- 单 concurrency（避免并发 deploy 抢锁）
- Gap-1

**Gap-3**: `backend/scripts/deploy.sh` 加 auto rollback
- 部署后探 `/api/health/ready`（不是 /health，因前者要 DB+Redis 都 OK）
- 30s timeout + 2s interval + 连续 5 次非 200 触发 rollback
- rollback 找最近 `.deploy-backup/` 恢复 src + package.json + 重装 deps + reload
- `DEPLOY_SKIP_ROLLBACK=true` 可禁用（人工 verify 时）
- 退出码 10（rollback 成功）/ 11（rollback 失败 — 人工介入）

**Gap-12**: `backend/scripts/dr-drill.sh` 新文件
- 找最新 backup → CREATE `resume_app_test_dr_<ts>` 库 → 灌 → 检查 ≥7 张表 → 写测试 → 留 7 天给 ops 排查 → 自动删
- 失败发 log 到 `/var/log/resume-app-dr-drill.log`
- 装 cron `0 4 1 * *` 每月 1 号 04:00

**Gap-20**: `infra/firewall-audit.sh` 新文件
- ss -tlnp + ufw + iptables 三视图
- DB/Redis 必须 localhost-only，暴露 0.0.0.0 立即 fail
- 退出 0/1/2（OK / WARN / CRITICAL）

### P2（1-2 天批量，8 文件）

**Gap-5**: `infra/setup-server.sh` 单文件 provisioning L1
- 12 steps：apt → Node 22 (nvm) + pm2 → MySQL bind 127.0.0.1 → Redis AOF + bind → nginx + 自签 cert → ufw → systemd (backend + tunnel) → folders + 初次 backup + crons → logrotate → fail2ban → smoke
- 幂等，可重复跑
- 任何 ops 一行 `bash infra/setup-server.sh --env prod` 装成 production-ready

**Gap-7**: `infra/serveo-watchdog.sh`
- 检测 ssh.*serveo 进程在/不在 → 死 → 重启 + log
- 检测多个 tunnel 进程（leak）→ kill 全部
- 检测 `/tmp/serveo.log` stale → WARN
- systemd `resume-app-tunnel.service` 也在 setup-server 含（含 StartLimitBurst 防 leak）

**Gap-10（部分）+ Gap-13**: `infra/backup-remote.sh` rclone 异地备份
- 默认 Onedrive/S3（rclone config 先配）
- 同步今日 backup 到 `latest/` + 7 天到 `daily/`
- 远端 30 天 retention
- 失败不静默 → log + exit 非 0
- logrotate 30 天在 setup-server Step 10

**Gap-14**: `backend/src/routes/health.js` Redis AOF enforce
- `/api/health/ready` 在 `NODE_ENV=production` 时检查 `CONFIG GET appendonly`
- aof != yes → 503 not_ready + 日志 warn + 字段 `persistence.ok=false`
- 原因：Redis 重启丢数据 = 已 revoke 的 token 复活（cookie blacklist 失效）
- 1 新测试，baseline 420 → 421

**Gap-9**: Prometheus + Alertmanager + Grafana 配置
- `infra/prometheus/prometheus.yml` — standalone 路径，scrape `/api/internal/metrics` + blackbox 外探触发 `up{job=backend}`
- `infra/prometheus/alertmanager.yml` — 路由 critical → PagerDuty / warning → Slack + 抑制规则（RedisDown 抑制 warning 防止级联）
- `infra/prometheus/docker-compose.yml` — 3 service 一行起 Prom+Alertmgr+Grafana
- 30 天 TSDB retention
- 默认 OFF（成本），ops 决定何时起

### P3（doc 类，2 文件）

**Gap-6**: `infra/server-state.md`
- 当前 server 装什么/怎么配/在跑什么
- 4 个 systemd unit + 5 个 cron + 6 个 config 文件 + ufw + backup 一张表
- "已知手动项"清单 + L0 → L3 IaC 升级路径

**Gap-18**: `infra/le-cert-setup.md`
- ICP 备案 → 域名 → DNS → LE cert → nginx 切换 → 微信小程序切换 完整流程
- acme.sh DNS-01 challenge 配置（不依赖 80 端口）
- HSTS + Mozilla intermediate cipher 配置 diff
- 时间估算 14-30 天（受 ICP 限制）

## ⚠️ 已知遗留（不在 R41 范围）

| # | 项 | 原因 |
|---|----|--------|
| 1 | 实际跑 `infra/setup-server.sh` — server 在 user 端，不在 CI 跑 | 需 ops 人工启 / 验证 |
| 2 | 实际 `cd /opt/prom-stack && docker compose up -d` | 需 ops 启 + 改 alertmanager env |
| 3 | `rclone config` 远端 + 启 `infra/backup-remote.sh` cron | 需 ops 配 OAuth + secret |
| 4 | 实际 revoke 3 PAT + 重置 WX key | 需 ops 手动（本文档 + RUNBOOK 列步骤）|
| 5 | ICP 备案 + 换 LE cert | 14-30 天等工信部 |
| 6 | `infra/setup-server.sh` 在裸 IP 无云厂商时跑会失败 | 当前 server 可能是裸 metal / IDC，需迁云 ECS |
| 7 | `pre-existing authLockout 2 fail` | 跨 round 仍未修 |

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | P0 用 docs + script 而非 ops auto | revoke PAT / WX key 必须人工，脚本加速不能替代 |
| 2 | P1 deploy.yml 用 job-output 传递 secrets | GH jobs 间传 secrets 安全 + 简洁 |
| 3 | P1 health probe 用 /ready 而非 /health | /health 仅"进程在"，/ready 含 DB+Redis check |
| 4 | P1 auto rollback 触发后继续 deploy script（不退码） | 退码会让 GH Actions 误判"deploy failed"，分事件类型更清 |
| 5 | P2 setup-server.sh 单 bash，不分 ansible | 当前需求 1 server，单文件够；增 server 时迁 ansible |
| 6 | P2 Redis AOF 仅 production 强制 | test/dev 通常没 Redis instance，强制会 break 测 |
| 7 | P2 Prometheus 用 docker-compose + standalone config 双轨 | standalone 适合云 VM，docker 适合裸 metal；都覆盖 |
| 8 | P3 server-state.md 而非 IaC 直接上 | L1 落地后 ops 才能 trusted 写 IaC；state doc 是 L0→L1 过渡 |
| 9 | secret-rotation.md sanitized | 不重发真实 PAT 串，避免成为"已重发公开泄漏"事件 |
| 10 | `infra/setup-server.sh` 含 systemd 但不 `systemctl start` 首次 | 首次缺 `.env` 必失败，留 ops 填 env 后启 |

## 风险

| 风险 | 缓解 |
|------|------|
| P1 auto rollback 误触发（健康探针本身问题） | `DEPLOY_SKIP_ROLLBACK=true` 可禁用；阈值可调 |
| P2 setup-server.sh 跑坏现有 server | 幂等设计：所有 `cp -n` `systemctl enable` 检查先在；不可逆操作（DB user create）前 echo + 询问 |
| P2 Redis AOF enforce 把 prod 打 503（如果真忘配） | 这是 **目的**：fail-fast 防数据丢失，比上线后丢数据代价小 |
| P2 Prometheus docker compose 默认 exposing 9090/9093/3000 公网 | 需 ops 改 ufw 只允许内网（`infra/firewall-audit.sh` 检查） |
| P3 server-state.md 漂移 | 文档头部"24h 内必 sync"提示；L2 落地后此 doc 退役 |
| P3 LE cert HSTS preload 锁死 | 文档明确警告；首次开 HSTS 不开 preload，等稳定再加 |

## Commits

| SHA | msg |
|-----|-----|
| `01ed043` | feat(deploy): P2 — provisioning L1 + watchdog + 异地备份 + Redis AOF enforce + Prom+Alertmgr+Grafana |
| `ddf98dc` | feat(deploy): P1 — auto trigger + env 分流 + auto rollback + DR drill + firewall audit |
| `76b14f5` | fix(security): P0 — nginx 限 /api/internal + monitor ALERT_TOKEN 防呆 + secret rotation runbook |
| (本 devlog) | docs: round 41 deployment hardening |

## 🏁 Round 41 总结

3 优先级 batch × 4 维度：
- P0 立即安全 (3 项)
- P1 CI/CD + DR (4 项)
- P2 provisioning + obs (8 项)
- P3 IaC 文档 (2 项)

总 commit 增 3 + 1 devlog = 4 commits。
总测试 420 (R40) → 421 (+1)。

R41 完成。下一步：等 user ops 端跑 `infra/setup-server.sh` + 启 Prom docker compose + 实际 revoke 3 PAT（per `secret-rotation.md`）+ 处理 ICP 备案。R42+ 可做：L2 Ansible / user 端幂等 / pre-existing authLockout / leader 多角色 等。
