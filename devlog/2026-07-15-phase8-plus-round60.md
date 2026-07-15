# 开发日志 — 2026-07-15（Phase 8+ Round 60）

> 阶段：8+ Round 60 — Server deploy R57-R59 + 2 fixes
> 前置：[2026-07-15-phase8-plus-round59.md](../devlog/2026-07-15-phase8-plus-round59.md)

## 起点

user 答"下一步" → 提议 A (部署 R57-R59 到 server), user 同意.
SSH 探索 4 个 key (github_aigc/tencent_mbti_new/tencent_mbti_rsa 都是 passphrase 或拒),
user 提示"查清楚点", 最终找到 `~/.ssh/openclaw.pem` 可用.

## 部署

### 1. SCP tarball (R58+R59 改动)

```bash
# R58: dashboard 全屏 + R59: openapi 动态 HN
git archive --format=tar.gz -o /tmp/r60-deploy.tar.gz HEAD -- \
  backend/src/routes/openapi.js backend/tests/openapi-serveo-hn.test.js \
  infra/serveo-hn-sync.cron infra/sync-tunnel-hn.sh \
  mini-program/admin/pages/dashboard/* \
  devlog/2026-07-15-phase8-plus-round5*.md
scp /tmp/r60-deploy.tar.gz ubuntu@43.139.176.199:/tmp/
```

### 2. Extract + install (with sudo)

```bash
cd /opt/resume-app && tar xzf /tmp/r60-deploy.tar.gz
sudo cp infra/sync-tunnel-hn.sh /usr/local/bin/sync-tunnel-hn.sh
sudo chmod +x /usr/local/bin/sync-tunnel-hn.sh
sudo cp infra/serveo-hn-sync.cron /etc/cron.d/serveo-hn-sync
sudo chmod 644 /etc/cron.d/serveo-hn-sync
sudo systemctl restart cron
```

### 3. pm2 reload

```
[PM2] Applying action reloadProcessId on app [resume-app-backend](ids: [ 6 ])
[PM2] [resume-app-backend](6) ✓
HEALTH=200
```

## 部署中发现 + 修的 2 个 bug

### Bug #1: sync script regex 过匹 + 老 state file 格式错

**症状**: 第一次跑 `sync-tunnel-hn.sh` 后, `/var/lib/resume-app/serveo.hostname` 里有完整 URL
`https://23a18edcbfa51a5e-43-139-176-199.serveousercontent.com`, 但 openapi.js 的 `HN_REGEX` 只接 prefix.

**Root cause**:
1. 老的 state file 是 R56 之前某个 tool 写的, 格式不同 (含 `https://`)
2. R59 sync script 的正则 `[a-f0-9]{16}-43-139-176-199\.serveousercontent\.com` 把整个 hostname 都匹配进去了

**修法**:
```diff
- HN_RAW=$(journalctl ... | grep -oE '[a-f0-9]{16}-43-139-176-199\.serveousercontent\.com' ...)
+ HN_RAW=$(journalctl ... | grep -oE '[a-f0-9]{16}-43-139-176-199' ...)
- if ! [[ "$HN_RAW" =~ ^[a-f0-9]{16}-43-139-176-199\.serveousercontent\.com$ ]]; then
+ if ! [[ "$HN_RAW" =~ ^[a-f0-9]{16}-43-139-176-199$ ]]; then
```

### Bug #2: CRLF line endings on shell scripts

**症状**: `bash: /usr/local/bin/sync-tunnel-hn.sh: cannot execute: required file not found`
(其实是 bash 看到 `\r` 当 separator, 第一个 line 后就 abort 了)

**Root cause**: Windows git autocrlf 把 `.sh` 写成 CRLF, scp 上 Linux 后 bash 不认识.

**修法**:
1. server 端 `tr -d '\r' < file > file.fixed` (一次性, 已 apply)
2. **永久 fix**: 加 `.gitattributes` 强制 `*.sh eol=lf`

```gitattributes
# .gitattributes (新增)
*.sh        eol=lf
*.cron      eol=lf
*.service   eol=lf
*.timer     eol=lf
```

### Verify

| 检查 | 结果 |
|---|---|
| `pm2 reload resume-app-backend` | ✅ active (6) |
| `/api/health/live` | ✅ 200 |
| `sync-tunnel-hn.sh` 手动跑 | ✅ `SERVEEO_HN_CHANGED: 55f64db184ac97bc-43-139-176-199` |
| `/var/lib/resume-app/serveo.hostname` 内容 | ✅ `55f64db184ac97bc-43-139-176-199` |
| `curl /api/docs/openapi.json` servers[0].url | ✅ `https://55f64db184ac97bc-43-139-176-199.serveousercontent.com` |
| Cron entry | ✅ `/etc/cron.d/serveo-hn-sync` 已装 |

## SSH key 历史 (文档化避免下次再试)

| key | 类型 | 结果 |
|---|---|---|
| `~/.ssh/id_r` | n/a | 不存在 |
| `~/.ssh/id_ed25519` | ed25519 | 不存在 / 拒 |
| `~/.ssh/github_aigc` | ed25519, 无 passphrase | ❌ publickey 拒 |
| `~/.ssh/tencent_mbti` | **passphrase 加密** | ❌ 无法在 batch mode 用 |
| `~/.ssh/tencent_mbti_new` | ed25519, 无 passphrase | ❌ publickey 拒 |
| `~/.ssh/tencent_mbti_rsa` | **passphrase 加密** | ❌ 无法在 batch mode 用 |
| `~/.ssh/openclaw.pem` | RSA, 无 passphrase | ✅ **唯一可用** |

> 下次 ops 直接用 `openclaw.pem`. 考虑把它 symlink 到更显眼的位置或写进 ssh config.

## 留 follow-up

| # | 项 | 谁 |
|---|---|----|
| 1 | 真 admin openid → UPDATE admins | user |
| 2 | 真机 preview dashboard 全屏 + 1920×1080 验证 | user |
| 3 | Tunnel 升级: serveo Pro / ngrok / cloudflared | user |
| 4 | revoke 3 GH PAT (UI) | user |
| 5 | rotate WX code-upload key (UI) | user |
| 6 | ICP 备案 | user (14-30 天) |

## baseline

- backend: 425 + 5 (R59 openapi-serveo-hn) = 430 / 0 fail / 1 skip
- mini-program: 47 / 0 fail
- 21 commits on develop (R40-R60)

## Commits (本 round)

| SHA | msg |
|-----|-----|
| 7a4b2f5 | fix: R59 sync script regex - extract HN prefix only |
| 4e6713f | fix: add .gitattributes to force LF for *.sh/*.cron |
| (本 devlog) | ops: R60 — deploy R57-R59 to server + 2 fixes (regex + CRLF) |

## Server 当前状态 (R60 后)

```
[deploy] resume-app-backend  active (id=6)  R59 openapi.js loaded ✅
[cron]   serveo-hn-sync       */5 * * * *   ✅ installed
[script] sync-tunnel-hn.sh    at /usr/local/bin  ✅ LF (CRLF stripped)
[file]   /var/lib/resume-app/serveo.hostname   ✅ 55f64db184ac97bc-43-139-176-199
[openapi] /api/docs/openapi.json servers[0]   ✅ live HN
```