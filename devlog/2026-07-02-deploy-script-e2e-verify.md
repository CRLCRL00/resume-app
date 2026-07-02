# Deploy Script E2E 验证 — 2026-07-02

## 背景

Round 22 加了 `backend/scripts/deploy.sh` + `.github/workflows/deploy.yml`。
GH Actions 需 secrets（`SERVER_HOST`/`SERVER_USER`/`SERVER_SSH_KEY`）才能跑。
本机 gh CLI 解析报错 + 无 GitHub PAT。
走本地等价流程手动跑一次 deploy.sh 验证。

## 流程（mirror GH workflow job2）

```bash
# 1. 构建 tarball（与 GH job1 package 一致）
tar --exclude='backend/node_modules' \
    --exclude='backend/.env' \
    --exclude='*.log' \
    --exclude='backend/coverage' \
    --exclude='backend/tests' \
    -czf /tmp/release-round22.tar.gz backend/
# → 78878 bytes

# 2. SCP 到 server（与 GH job2 step SCP 一致）
scp /tmp/release-round22.tar.gz ubuntu@43.139.176.199:/tmp/

# 3. SCP deploy.sh + chmod（首次 chicken-and-egg）
scp backend/scripts/deploy.sh ubuntu@43.139.176.199:/tmp/deploy.sh
ssh ubuntu@server "chmod +x /tmp/deploy.sh"

# 4. Run deploy.sh on server（与 GH job2 step SSH script 一致）
DEPLOY_TARBALL=/tmp/release-round22.tar.gz \
PM2_NAME=resume-app-backend \
bash /tmp/deploy.sh
```

## deploy.sh 输出

```
[deploy] root=/opt/resume-app tarball=/tmp/release-round22.tar.gz ts=1782976563
[deploy] files updated
Use --update-env to update environment variables
[PM2] Applying action reloadProcessId on app [resume-app-backend](ids: [ 6 ])
[PM2] [resume-app-backend](6) ✓
[deploy] pm2 reloaded: resume-app-backend
[deploy] /api/health => 200
[deploy] done. backup=.deploy-backup/1782976563
```

## Smoke 端点

| Endpoint | Status |
|----------|--------|
| GET `/api/health` | 200 |
| GET `/api/health/live` | 200 |
| GET `/api/health/ready` | 200 |
| GET `/api/legal/versions` | 200 |
| GET `/api/internal/metrics` | 200 |
| GET `/api/internal/metrics/summary` | 200 |
| POST `/api/auth/login` | 400 (缺 code) |
| POST `/api/auth/refresh` | 400 (缺 refreshToken) |
| POST `/api/auth/logout` | 200 (Round 21 endpoint) |

## /api/health body (production sample)

```json
{
  "code": 0,
  "data": {
    "status": "ok",
    "env": "production",
    "version": "0.1.0",
    "uptime": 58,
    "nodeVersion": "v22.22.3",
    "pid": 1021020,
    "hostname": "VM-0-8-ubuntu",
    "dbPingMs": 1,
    "redisPingMs": 1,
    "db": { "ok": true, "latencyMs": 1 },
    "redis": { "ok": true, "latencyMs": 1 }
  }
}
```

Round 22 endpoint 全上：uptime / version / nodeVersion / db+redis ping。

## 决策

| # | 决策 | 原因 |
|---|------|------|
| 1 | 本地等价 deploy 流程 | 避开 GH secrets 缺失；验证 deploy.sh 本身 |
| 2 | chicken-and-egg 解决：先 SCP deploy.sh 到 /tmp 再 bash | deploy.sh 不在 server；tarball 解压后才到 backend/scripts/，但 bash 调用需先存在 |
| 3 | 用 `bash /tmp/deploy.sh` 而非 `bash backend/scripts/deploy.sh` | 第一跑 server 上没此路径；之后 deploy.sh 自身已落盘 backend/scripts/ |

## 风险

| 风险 | 缓解 |
|------|------|
| 本地手动 ≠ GH workflow | deploy.sh 同脚本；GH 仅多 tarball build + secrets 注入 |
| backup 目录累积 | deploy.sh 末尾 `ls -dt .deploy-backup/* | tail -n +6 | xargs rm -rf` 保留 5 个 |

## Commits

无（本次仅运行已存在脚本，未改代码）