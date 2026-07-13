---
title: Secret Rotation Runbook
description: When and how to rotate leaked / aged credentials.
---

# Secret Rotation Runbook

> When to use: any of the following.
> 1. A credential appears in chat / commit / log / screenshot
> 2. Employee leaves the project
> 3. Scheduled quarterly rotation
> 4. Suspected compromise (brute-force alert, anomalous API usage)

## Quick triage — what was leaked?

| Type | Exposure cost | Action |
|------|--------------|--------|
| GitHub PAT | repo read/write, secrets read, packages write | Revoke immediately + audit `git log` |
| SSH private key | server root | Revoke + replace key + audit `~/.ssh/authorized_keys` |
| WeChat mini-program code-upload key | arbitrary code to MP backend | Reset + rotate base64 in GH Secrets |
| DeepSeek API key | bill fraud, rate abuse | Revoke + reissue + update `.env` |
| DB password | data exfil | Rotate + update `.env` + restart |
| JWT secret | forge any user/admin session | Rotate → ALL sessions invalidated (broadcast logout) |
| `ALERT_TOKEN` | spoof health alerts | Rotate + re-deploy monitor cron |
| `WX_SECRET` (code2session) | impersonate any WX user | Rotate via mp.weixin.qq.com |

## Step-by-step

### 1. Revoke

| Cred | Where |
|------|-------|
| GitHub PAT | https://github.com/settings/tokens → Delete |
| WeChat code-upload key | mp.weixin.qq.com → 开发管理 → 开发设置 → 重置"小程序代码上传密钥" → 下载新 `.key` 文件 |
| WeChat app secret | mp.weixin.qq.com → 开发管理 → 开发设置 → 重置 "AppSecret" |
| DeepSeek key | https://platform.deepseek.com/api_keys → Revoke |
| SSH key | `ssh-keygen -lf ~/.ssh/id_r` to find fingerprint; on server `~/.ssh/authorized_keys` remove matching line |

### 2. Replace

| Cred | Where it lives |
|------|---------------|
| WX code-upload key | local `D:\小程序密钥.key` + GH Secret `WX_MINIPROGRAM_KEY_BASE64` (base64 of `.key` file) |
| WX app secret | server `/opt/resume-app/backend/.env` (`WX_SECRET=`) |
| DeepSeek key | server `.env` (`DEEPSEEK_API_KEY=`) |
| DB password | server `.env` (`DB_PASSWORD=`) + MySQL `ALTER USER` |
| JWT secret | server `.env` (`JWT_SECRET=`) |
| `ALERT_TOKEN` | server `.env` + `/etc/cron.d/resume-app-monitor` |

### 3. Deploy

```bash
# server
ssh ubuntu@43.139.176.199
# edit .env
nano /opt/resume-app/backend/.env
# restart to pick up env
pm2 restart resume-app-backend --update-env
# verify
curl -sS http://127.0.0.1:3003/api/health | jq .
```

For DB password: also `mysql -u root -p -e "ALTER USER 'resume_app_user'@'localhost' IDENTIFIED BY 'new-pw';"` BEFORE editing `.env`.

### 4. GH Secrets

For credentials used by GH Actions (e.g. `WX_MINIPROGRAM_KEY_BASE64`):

```bash
gh secret set WX_MINIPROGRAM_KEY_BASE64 < <(base64 -w 0 "D:/小程序密钥.key")
# verify
gh secret list | grep WX_MINIPROGRAM
```

### 5. Verify

| Cred | Verify by |
|------|-----------|
| WX code-upload key | Actions → "Upload Mini-Program" → Run workflow (manual) → check summary |
| WX app secret | `curl /api/auth/login` with test code (200/401, not 500) |
| DeepSeek key | `node -e "fetch('https://api.deepseek.com/v1/models', { headers: { Authorization: 'Bearer '+process.env.DEEPSEEK_API_KEY } }).then(r => console.log(r.status))"` |
| DB password | `mysql -u resume_app_user -p"new-pw" -e "SELECT 1"` |
| JWT secret | logout everywhere; existing tokens still validate until expiry (set shorter `JWT_EXPIRES_IN` next) |

## Audit trail after rotation

1. Commit devlog entry: `rotated <cred> on YYYY-MM-DD, reason: <one-line>`
2. If leaked publicly: search GitHub for the secret hash (`gf` or `truffleHog`) to confirm takedown
3. Notify team via the project channel
4. Update this runbook if process gap uncovered

## Quarter rotation cadence

| Cred | Frequency |
|------|-----------|
| GitHub PAT | 90 days |
| WX code-upload key | 180 days (manual process — annoying) |
| WX app secret | 180 days |
| DeepSeek key | 180 days |
| DB password | 365 days |
| JWT secret | 365 days (forces mass re-login) |
| `ALERT_TOKEN` | 365 days |
| SSH key | 365 days |

## Known historical leaks (rotate-first checklist)

> Listed as a reminder for ops to audit and rotate these creds;
> do NOT reproduce the secret value in any public doc.

- GitHub PAT set: 3 PATs of the form `github_pat_11CAQ3JHA0...` are recorded as exposed in prior session history. Revoke ALL of them regardless of current revocation status.
- WeChat code-upload key file: a Windows path like `D:\小程序密钥.key` was named in repo docs. Re-rotate the key in mp.weixin.qq.com → 开发设置 → "小程序代码上传密钥".
- Server tunnel hostname: the default `*.serveousercontent.com` URL is published in source. Re-create the tunnel if you don't control the old hostname.