# 开发日志 — 2026-07-14（Phase 8+ Round 53）

> 阶段：8+ Round 53 — server-side public IP drift detector
> 前置：[2026-07-14-phase8-plus-round52.md](../devlog/2026-07-14-phase8-plus-round52.md)

## 起点

R52 诊断 wechat IP whitelist 漂移是根因 (R27 加 `14.154.95.254`, R49 server IP = `43.139.176.199`)。 user 已加 IP, **但**问题没根治 — 任何时间 server NAT IP 再变, 又要走 mp.weixin.qq.com UI。

**user 答"你推荐": 我推荐 R53 自动 IP detect script, 因为 R52 暴露的根因仍是手动 ops。**

## 改动

### 1. `infra/public-ip-watchdog.sh` (新, 95 行 bash)

双源 quorum probe (curl 2 个 IP service 比较) + alert + state file:

```bash
IP_A=$(curl ifconfig.me)
IP_B=$(curl api.ipify.org)
# agree → 真, 不一致 → 选 A (更可靠, fail-open)
# 与 STATE_FILE 比, 变了:
#   - 写新值 + chmod 644
#   - stderr 告警
#   - log 详细 ACTION REQUIRED 步骤 (含 mp.weixin.qq.com URL)
```

**不** auto push mp.weixin.qq.com API (那是 UI), 只 auto-detect + log 步骤。

### 2. `infra/public-ip-watchdog.cron` (新)

```cron
@reboot root sleep 60 && /usr/local/bin/public-ip-watchdog.sh ...
0 */6 * * * root /usr/local/bin/public-ip-watchdog.sh ...
```

启动 + 每 6h 一次 (避免 server 退 / 重启后立即发现)。

### 3. `infra/tests/public-ip-watchdog.test.js` (新, 5 tests)

| 测试 | 验证 |
|------|------|
| bash -n syntax |  |
| unreachable probes exit 1 | probe fail → exit code 1 |
| STATE_FILE survives fail | 不覆盖旧 IP |
| log records reason | "probe failed" 写进 log |
| env hooks expose | IP_STATE_FILE/PROBE_URL/is_valid_ipv4 等字段存在 |

**5/5 pass.**

## baseline

| suite | tests | pass | fail | skip |
|-------|-------|------|------|------|
| backend | 422 | 421 | 0 | 1 |
| mini-program | 42 | 42 | 0 | 0 |
| **infra (R53 new)** | **5** | 5 | 0 | 0 |
| **总** | **469** | **468** | **0** | **1** |

R42 起 zero fail maintained.

## 决策

| # | 决策 | 原因 |
|---|------|------|
| 1 | 双 quorum source | 防 ifconfig.me 单点 retry 抖动 |
| 2 | fail-open 选 A | A 通常更可靠; quorum strict 会偶发误报 |
| 3 | 不 auto push mp.weixin.qq.com | UI step; 强制 user 知晓变更 |
| 4 | 6h 间隔 | drift 通常周/月级别; 6h 平衡 log 噪声 + 响应速度 |
| 5 | boot 后 60s delay | network 才起来时 probe 易 fail |

## 留 ops 步骤 (你跑)

```bash
ssh ubuntu@43.139.176.199
# 1. 装脚本
chmod +x /opt/resume-app/infra/public-ip-watchdog.sh
sudo cp /opt/resume-app/infra/public-ip-watchdog.sh /usr/local/bin/

# 2. 装 cron
sudo cp /opt/resume-app/infra/public-ip-watchdog.cron /etc/cron.d/

# 3. 启动一次 (写基线)
sudo /usr/local/bin/public-ip-watchdog.sh
cat /var/lib/resume-app/public_ip.txt  # 应是 43.139.176.199

# 4. 看 log
sudo tail /var/log/resume-app-public-ip.log
```

## follow-up

| # | 项 | 谁 |
|---|----|------|
| 1 | R53 装到 server (上面 ops 步骤) | user 1 行命令 |
| 2 | R53 + ENABLE_DEV_BYPASS still off | 不影响 |
| 3 | 跑剩余 5 R41/R42 follow-up (慢query leader role, leader transition 已做, OpenAPI header 已做, Redlock lib — 都不阻塞) | R54+ |

## Commits

| SHA | msg |
|-----|-----|
| (本 devlog + 3 files) | ops: R53 — server-side public IP drift detector (cron + script + tests) |
