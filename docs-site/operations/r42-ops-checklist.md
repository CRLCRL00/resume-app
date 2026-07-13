---
title: R42 Ops Checklist
description: 一页式 ops 行动清单（revoke + ICP + 部署 + 监控）。
---

# R42 Ops Checklist

> 全部 R41 audit 暴露 + R42 已 code 化的剩余 ops 行动。
> 每项给出**何时做 / 怎么做 / 验证标准**。可拷贝到 issue / Linear ticket 跟踪。

## 紧急（24h 内）

### 1. Revoke 3 GitHub PAT（前 session 已暴露）

```bash
# GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
# 找到以下 3 个前缀的 PAT 全部 Revoke:
github_pat_11CAQ3JHA0I4F9XX...
github_pat_11CAQ3JHA0mPQOeKA0a6yb_1iwir61...
github_pat_11CAQ3JHA0h0vth5oMor2Y_BJno3uYjy6F96OjYdRceSThSDy...
```

**校验**:
```bash
gh auth status  # 确认 gh CLI 用的不是被 revoke 的
gh auth login --with-token  # 如用则重发
```

### 2. Rotate WeChat mini-program code-upload key

```bash
# mp.weixin.qq.com → 开发管理 → 开发设置 → 重置"小程序代码上传密钥"
# 下载新 .key 到 D:\小程序密钥.key
# 重新 base64 + 替换 GH Secret:
base64 -w 0 "D:/小程序密钥.key" | gh secret set WX_MINIPROGRAM_KEY_BASE64 -
# 旧路径同步更新到 docs（README / RUNBOOK）
```

**校验**: Actions → Upload Mini-Program → Run workflow → 验证 summary 含 200/Success。

### 3. Rotate WX app secret + DeepSeek key

```bash
# mp.weixin.qq.com → 重置 AppSecret
# platform.deepseek.com/api_keys → Revoke 旧 + Reissue

# 更新 server .env (ssh 到 43.139.176.199):
ssh ubuntu@43.139.176.199
nano /opt/resume-app/backend/.env  # 改 WX_SECRET + DEEPSEEK_API_KEY
pm2 restart resume-app-backend --update-env
```

**校验**: `curl /api/health` 仍 200；`/api/auth/login` 返 401（invalid code）而非 500。

## 24-72h 内

### 4. 真实跑 `infra/setup-server.sh`

R41 写完但未跑。一行命令装/重装 server：

```bash
# 推荐：在新建 staging VM 上先试,稳定后再 prod
# server 上：
curl -sSfL https://raw.githubusercontent.com/CRLCRL00/resume-app/develop/infra/setup-server.sh | bash -s -- --env prod
```

**校验**：
- `systemctl status resume-app-backend` → active
- `systemctl status resume-app-tunnel` → active
- `/api/health` → 200
- `/api/health/ready` → 200（依赖 Redis AOF 已配）
- `crontab -l | grep resume-app` → 5 个 cron 行

### 5. 启 Prom + Alertmanager + Grafana

```bash
# server (或独立监控 VM)
mkdir -p /opt/prom-stack && cd /opt/prom-stack
# 从仓库拷配置：
git clone --depth 1 https://github.com/CRLCRL00/resume-app.git /tmp/prom-source
cp /tmp/prom-source/infra/prometheus/docker-compose.yml .
mkdir -p prometheus rules alertmanager grafana/provisioning
cp /tmp/prom-source/infra/prometheus/prometheus.yml prometheus/
cp /tmp/prom-source/infra/prometheus/alerts.yml prometheus/rules/
cp /tmp/prom-source/infra/prometheus/alertmanager.yml alertmanager/
# 改 alertmanager.yml env: SLACK_WEBHOOK_URL + PAGERDUTY_SERVICE_KEY
# 在 .env:
echo 'SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...' > .env
echo 'PAGERDUTY_SERVICE_KEY=...' >> .env
# 起：
docker compose up -d
```

**校验**：
- `http://prometheus:9090/api/v1/rules | jq '.data.groups[].rules[].name'` → 含 7+ alerts
- `http://grafana:3000` 可登录 (admin / admin)
- Add datasource → Prometheus → `http://prometheus:9090` → test → OK
- 模拟 fire: `curl 'http://prometheus:9090/api/v1/rules?mock=HighErrorRate'` 之类

### 6. 配 rclone + 启异地备份

```bash
# server
apt install rclone
rclone config  # OAuth flow 配 onedrive / s3 / google drive
# 测：
RCLONE_REMOTE_NAME=onedrive RCLONE_REMOTE_PATH=resume-app-backups \
  bash /opt/resume-app/infra/backup-remote.sh
# 看 /var/log/resume-app-backup-remote.log
# 加 cron（已含 03:15 backup 后的 5min,setup-server 已配）
```

**校验**: 远端目录有今日 latest/ + daily/ 子目录。

## 1-4 周内

### 7. ICP 备案 + 换 LE cert

完整流程：见 `infra/le-cert-setup.md`。**主要时间花在工信部审核** (14-30 天平均)。

并行动作：
- 注册域名（.com）
- 申请云 ECS（如 server 仍裸 metal；备案强制要求云厂商）
- 填 ICP 资料

通过后：
- DNS 切到 ECS IP
- acme.sh --issue --dns dns_ali
- nginx reload + HSTS
- 微信小程序改 server 域名

## 验证标准（每次改 server 后跑）

```bash
bash infra/firewall-audit.sh  # exit 0 = 合规
bash backend/scripts/dr-drill.sh  # exit 0 = backup 可恢复
ls /var/log/resume-app-*.log  # 应有 5+ log 文件
```

## 跟踪

把这份清单复制到 Linear / GitHub Project ticket：

```
[ ] #1 Revoke 3 GH PAT                  (Day 0)
[ ] #2 Rotate WX MP code-upload key    (Day 0)
[ ] #3 Rotate WX secret + DeepSeek key (Day 0)
[ ] #4 Run setup-server.sh on prod     (Day 1)
[ ] #5 Spin up Prom + Alertmgr stack   (Day 2)
[ ] #6 Configure rclone + remote cron  (Day 2)
[ ] #7 ICP filing + LE cert            (Week 1-4)
[ ] #8 Verify firewall / DR / logs     (after each)
```

完成每项更新本文档勾选状态 + 写 devlog。
