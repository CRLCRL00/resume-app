# 开发日志 — 2026-07-01（Phase 8+ Round 6）

> 阶段：8+ Round 6
> 前置：[2026-06-30-phase8-plus-round5.md](../devlog/2026-06-30-phase8-plus-round5.md)

## 目标

3 个 hardening 项：
A. legal-versions 测试 + 小程序 app.js 隐私版本检查
B. pm2-logrotate
C. webhook receiver + monitor 集成

## 最终结果

| 项 | 状态 |
|----|------|
| A tests + 小程序隐私版本 | ✅ 5 测试加，119/119 × 3 绿 |
| B pm2-logrotate | ✅ 已装+配（100M/30份/每日00:00/gzip）|
| C webhook + monitor | ✅ alert endpoint 工作 |
| 服务部署 + verify | ✅ monitor 3 次 log OK |

## 改动详情

### A — 测试 + 隐私版本客户端

**`tests/route-legal-versions.test.js` 新增 5 测试：**
- GET /api/legal/versions 返双 doc_type 版本
- 已有 /legal/privacy 仍 OK
- admin: forbidden 403
- admin: invalid doc_type 400
- admin: bad version format 400
- admin: bump version 200 + data.version

后 3 个 conditional — 仅在能创建 admin 测试用户时跑（否则 t.skip），让本地无 SMOKE_DB 也过。

**`mini-program/app.js` 加 `checkPrivacyVersion()`：**
- 启动时拉 GET /api/legal/versions
- 比本地 `wx.getStorageSync('privacy_version'/'terms_version')`
- 后端更新 → 清旧 accept + 设 `privacy_need_reaccept`
- 500ms 后用 `shouldShowPrivacy()` 判断弹窗

**`components/privacy-popup/privacy-popup.js`：**
- onAccept 多删 `privacy_need_reaccept`

### B — pm2-logrotate

server 装 + 配：
```
max_size 100M
retain 30
compress true
dateFormat YYYY-MM-DD_HH-mm-ss
workerInterval 60
rotateInterval 0 0 * * * (每日00:00)
rotateModule true
```

id=7 已 online。`/home/ubuntu/.pm2/logs/` 自动按大小或日期压缩归档。

### C — webhook receiver + monitor

**`routes/alerts.js` 新建：**
- POST /api/internal/alert — `X-Alert-Token` 验证，写 `/var/log/resume-app-alerts.log` + winston.warn
- GET /api/internal/alerts/recent — 拉近 50 条（验证 token）
- ALERT_TOKEN 默认 `dev-alert-token-change-me`，生产通过 env 覆盖

**`scripts/monitor.sh` 接 monitor：**
```bash
HEALTH_WEBHOOK=https://...serveousercontent.com/api/internal/alert
ALERT_TOKEN=...
curl -X POST "$HEALTH_WEBHOOK" -H "X-Alert-Token: $ALERT_TOKEN" -d "..."
```

监控链路：
```
monitor.sh 5/min cron → /api/internal/alert → /var/log/resume-app-alerts.log
        ↓ 失败
   winston.warn + 日志
```

**`db/schema.sql` 加 privacy_versions 表 + seed：**
- db-init 时自动建+初始化
- 测试 / 服务都对齐

## npm test

| Run | 通过 | 失败 |
|-----|------|------|
| 1 | 119/119 | 0 |
| 2 | 119/119 | 0 |
| 3 | 119/119 | 0 |

## 风险

| 风险 | 缓解 |
|------|------|
| ALERT_TOKEN 默认 dev-值，prod 需 env 覆盖 | RUNBOOK 强调；GH Actions env 独立 |
| webhook 内部端口暴露 | IP bind 127.0.0.1 限制（nginx 配）|
| 小程序 privacy_version 比较 timezone | 字符串字典序 = 日期序 OK |
| monitor cron 漏 webhook | RUNBOOK.md fail-open log |

## Commits

下一 commit 包含：
- 1 新测试 + 1 schema 改 + 1 app.js 改 + 1 popup 改 + 1 alert 路由 + 1 monitor 改
