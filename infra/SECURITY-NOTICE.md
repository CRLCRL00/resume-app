# Security Notice — Leaked Credentials (Historical)

> **CONTEXT**: This notice is on display for `43.139.176.199` ops + any new collaborator.
> The leaked credentials described here are **read-only safety reminders**. Actual
> remediation requires the relevant service's UI (see "Remediation" links below).

## Why this file exists

R45 audit (Round 45, 2026-07-13) discovered that prior session history in chat +
git commit blobs contains sensitive credential strings that have been pushed to
the public GitHub repo. Sanitizing future commits is straightforward (R45 already
did this for new docs); however, **historical commit blobs on origin still
expose the values**. This file documents which credentials were leaked and
how to clean them up — it does NOT print the values.

## Leaked credentials — remediation queue

### 1. GitHub PAT (3 tokens, prefix `github_pat_11CAQ3JHA0...`)

- **Where (historical commits)**:
  - `76b14f5` (`docs-site/operations/secret-rotation.md`) — original paste
  - The values appeared in chat history before R45
- **Why leaked**: Discussed in plain text in earlier chat sessions; the values
  were pasted into markdown files and committed.
- **Remediation** (must be done in GitHub UI):
  1. Go to https://github.com/settings/tokens
  2. Find any PATs starting with `github_pat_11CAQ3JHA0` (3 expected)
  3. Click "Delete" for each
  4. Audit `git log --all -p` going forward to verify no new PAT-shaped strings
     are introduced
- **Script to detect** (run locally):
  ```bash
  git log --all -p --diff-filter=A | grep -E 'github_pat_11CAQ3JHA0[0-9a-zA-Z_]+'
  # Should print zero full tokens after R45 commit; prefixes ok
  ```

### 2. DeepSeek API key (1 value, format `sk-...`)

- **Where (historical commits)**:
  - `devlog/2026-06-29-deepseek-key-fix.md` (R27)
- **Why leaked**: Discussed + pasted in a Phase 8 setup session.
- **Remediation** (DeepSeek console):
  1. Go to https://platform.deepseek.com/api_keys
  2. Find the value (user keeps current — "key 没有变" per R45 conversation)
  3. If you choose to rotate: regenerate + write to `/opt/resume-app/backend/.env`
     on server, then `pm2 restart resume-app-backend --update-env`
- **Note**: Although the precise value was sanitized in R45 (`b8cab54`), the old
  value is still in commit `2...` git history. Force-push rewrite is intentionally
  NOT performed (would break collaborator clones).

### 3. WX code-upload key file path

- **Where (historical commits)**:
  - README.md (R27-R30 era)
  - RUNBOOK.md (R27-R30 era)
  - `.github/workflows/upload-miniprogram.yml` (R40)
  - `.github/workflows/wx-mp-preview.yml` (R40)
  - `.github/workflows/sentry-mp.yml` (R40)
  - `scripts/wx-mp-upload.sh` (R40)
  - `scripts/wx-mp-preview.sh` (R40)
- **Why leaked**: Path `D:\小程序密钥.key` was named in multiple files; the
  actual file content was never in git but the path itself signals "WX upload
  private key on this disk" to anyone with repo read.
- **Remediation** (mp.weixin.qq.com):
  1. Login to https://mp.weixin.qq.com → 开发管理 → 开发设置
  2. 重置"小程序代码上传密钥"
  3. Re-download new `.key` file (overwrite `D:\小程序密钥.key`)
  4. Re-encode base64: `base64 -w 0 D:/小程序密钥.key | gh secret set WX_MINIPROGRAM_KEY_BASE64 -`

### 4. Other credentials (not yet investigated)

- `WX_SECRET` (AppSecret) — server `.env` only, not in git
- `JWT_SECRET` — server `.env` only, not in git
- `DB_PASSWORD` — server `.env` only, not in git
- `REDIS_PASSWORD` — server `.env` only, not in git
- These were not in scope for R45 audit; rotation is per [secret-rotation.md](./secret-rotation.md).

## Prevention — pre-commit hook (R45.5 follow-up)

After R45, future commits are sanitized. To enforce:

- **Local**: install a pre-commit hook (see [`../infra/setup-server.sh`](../infra/setup-server.sh) for the hook script template — round R45.5 adds `pre-commit-secret-check.sh`).
- **Server**: deploy-time hook runs in `setup-server.sh` step 11.

## Quick visual card (paste to team channel)

```
🚨 SECURITY: 3 GH PAT + 1 DeepSeek key leaked in commit history prior to R45.
🚨 WX code-upload key path published in README + scripts.
🚨 Remediation: see infra/SECURITY-NOTICE.md
✅ R45 sanitized future commits; new pre-commit hook blocks future leaks.
```

## Audit cadence

| Frequency | Action |
|-----------|--------|
| Quarterly | Run `git log -p | grep -E 'sk-[a-z0-9]{20,}|github_pat_11'`; expect zero matches |
| Quarterly | Confirm GH token list reflects 3 PATs deleted |
| Per release | Verify `.env` example files contain only `your_` placeholders, no live creds |
| Per release | Confirm `*.key`, `*.pem`, `credentials.json` still in `.gitignore` |
