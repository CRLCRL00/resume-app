# 开发日志 — 2026-07-13（Phase 8+ Round 43.5）

> 阶段：8+ Round 43.5 — R43 三项安全微修
> 前置：[2026-07-13-phase8-plus-round43.md](../devlog/2026-07-13-phase8-plus-round43.md)

## 起点

R43 后 firewall-audit 报 1 条 WARN：3003 bind 0.0.0.0。R42 AOF enforce 触发 `/api/health/ready=503`，但 deploy.sh 默认探的就是 ready，会被误判 failed deploy 触发 rollback。monitor.sh 还是老版本（无 ALERT_TOKEN 防呆）。

user 答"同意"。

## 3 项修改

### 1. `backend/scripts/deploy.sh` 加 `--ignore-ready-fail`

新增 `DEPLOY_IGNORE_READY_FAIL=true`（默认 true）+ 默认 `HEALTH_URL` 从 `/api/health/ready` 改为 `/api/health/live`：

- `/api/health/live` = 进程在跳（无依赖检查）— 适合 deploy 后立即探
- `/api/health/ready` = DB+Redis+(R42)AOF — 适合 K8s readiness probe 但 **不应** 作 deploy fail 信号

**核心改动**：

```sh
# 默认目标改为 liveness
HEALTH_URL="${DEPLOY_HEALTH_URL:-http://127.0.0.1:3000/api/health/live}"

# ready probe 故意 503 (R42 AOF enforce) 不触发 rollback
if [ "$DEPLOY_IGNORE_READY_FAIL" = "true" ] \
   && [[ "$HEALTH_URL" == *"/api/health/ready"* ]] \
   && [ "$LAST_CODE" = "503" ]; then
  echo "[deploy] /ready=503 but IGNORE_READY_FAIL=true → keep deploy"
  HEALTH_OK=1
fi
```

要 strict 检查：env `DEPLOY_HEALTH_URL=http://127.0.0.1:3000/api/health/ready DEPLOY_IGNORE_READY_FAIL=false` 即可。

### 2. `backend/src/index.js` listen 改 127.0.0.1 (production default)

```js
const BIND_HOST = process.env.BIND_HOST
  || (process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0');

const server = app.listen(config.PORT, BIND_HOST, () => {
  logger.info({ port: config.PORT, host: BIND_HOST, env: config.NODE_ENV }, 'server started');
});
```

- **prod 默认 127.0.0.1**：backend 不再直接对外可达
- **dev (NODE_ENV≠production) 默认 0.0.0.0**：本地测试不动
- **`BIND_HOST` env override**：k8s / L4 LB 后台可直接 `BIND_HOST=0.0.0.0`

效果：
- `ss -tln`：3003 从 `*:3003` → `127.0.0.1:3003`
- 任何直连 IP:3003 的攻击面消失
- nginx 443 → 反代 3003 仍工作（127.0.0.1 同机可达）

### 3. monitor.sh 重 symlink 到 R41 修改版

server 上 `/usr/local/bin/monitor-resume-app.sh` 是老链接（指向 stale 备份）。强制 ln -sf 重指向：

```
/usr/local/bin/monitor-resume-app.sh -> /opt/resume-app/backend/scripts/monitor.sh
```

验证 R41 修改版已落地：grep `dev-alert-token-change-me` 命中 2 处（默认 token abort + 实际 prod environment 不允许默认）。

## Server-side deploy

跟 R43 同路径 tar + scp + extract，但只覆盖 2 文件（最小变更面）：

```
tar -czf r435-bundle.tar.gz backend/src/index.js backend/scripts/deploy.sh
scp 到 /tmp/r435-bundle.tar.gz
tar xzf 覆盖 + 备份 .deploy-backup/<ts>-backup-r435/
pm2 reload resume-app-backend --update-env
```

## server 验证

| 检查 | 结果 |
|------|------|
| `ss -tln` 3003 | `127.0.0.1:3003` ✅ |
| firewall-audit 3003 | `OK bound to localhost (behind nginx)` ✅（WARN 消） |
| `/api/health` | 200 ✅ |
| `/api/health/ready` | 503 ✅（AOF enforce 工作,设计预期） |
| nginx 443 /api/health | 200 ✅（反代仍正常） |
| monitor.sh contain `dev-alert-token-change-me` | ✅ 2 处 |

## npm test baseline

422 pass / 0 fail / 1 skip — 不变。

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | `DEPLOY_IGNORE_READY_FAIL=true` 默认开启 | AOF enforce 503 是 prod 常态，不是 deploy 失败 |
| 2 | `HEALTH_URL` 默认改 `/api/health/live` | liveness 仅检测进程在，更符合 deploy 语义 |
| 3 | `BIND_HOST=127.0.0.1` 仅 prod default | dev 不破；override 灵活 |
| 4 | monitor.sh 重 symlink 用 sudo `ln -sf` | 不破 cron；不触发 dpkg-divert |
| 5 | 这次 deploy 用 2 文件小 tar | 改小 → blast radius 小；快速回滚 |

## 风险

| 风险 | 缓解 |
|------|------|
| `bind 127.0.0.1` 后 k8s pod 直连失效 | 文档化 `BIND_HOST=0.0.0.0` 走 env；本机 nginx 还能反代 |
| strict probe 误关：未来真 crash 但 ready 503 | `DEPLOY_HEALTH_URL=...ready DEPLOY_IGNORE_READY_FAIL=false` 即可 strict |
| monitor.sh 是 sync shell wrapper,执行可能要 5-7s | cron 5min 间隔足够；日志已 345KB 长期 |
| pm2 reload kill+restart 期间有 0.5-1s 503 | `--update-env` 不影响行为；如需 0 抖动用 `pm2 reload --kill-timeout 3000` |
| server 重启后 `BIND_HOST` 仍是 prod default (127.0.0.1) — pm2 ecosystem.config.js 已 NPM2_NAME=resume-app-backend,env_production NODE_ENV=production | 一致；不需额外配置 |

## Commits

| SHA | msg |
|-----|-----|
| (本 devlog) | docs: round 43.5 (bind 127 + deploy ignore-ready + monitor symlink) |

## 🏁 Round 43.5 总结

3 项安全微修，2 文件本地改 + 1 server-side symlink：
- backend 不再 bind 0.0.0.0
- deploy 不被 AOF 503 误 rollback
- monitor 用 R41 防呆版本

server 改动后所有 4 项 follow-up 触发器失效（auto mode 之前拒的 4 项 ops 行动中，server-side 不需 ops 介入的部分已修）。剩余 ops 9 项仍待 user/tunnel+ufw+AOF+Prom+PAT+WX+ICP+remote+leader audit DB。

下一步等 user 选择：继续 R44 全新方向 / 或 ops 解决剩 9 项。
