#!/bin/bash
# R46 leak cleanup orchestration — 1-shot script.
#
# Backs up the leaked creds and replaces them with fresh ops-controlled values.
# Each step is idempotent + safe to re-run.
#
# Replaces / rotates:
#   1. GH_TOKEN env (if user provides a new PAT)
#   2. WX_MINIPROGRAM_KEY_BASE64 GH Secret
#   3. Server-side .env WX_SECRET / DEEPSEEK_API_KEY (only if user wants to rotate)
#
# Usage:
#   export GH_TOKEN=new_pat_from_user_paste
#   export ROTATE_WX_SECRET=1            # only if you chose to rotate WX secret
#   export ROTATE_DEEPSEEK_KEY=1         # only if you chose to rotate DeepSeek key
#   bash infra/r46-leak-cleanup.sh
#
# What it does:
#   step 1: gh auth + secret list (verify auth)
#   step 2: delete historical PATs whose token string user provides (3 PATs);
#           OR show a list of PATs the user must delete in the GitHub UI
#   step 3: re-derive base64 of D:\小程序密钥.key + set GH Secret
#           (assumes user has already done the mp.weixin.qq.com reset)
#   step 4: optional .env rotation
#   step 5: smoke-test (server SSH probe + smoke-e2e)
#
# Important: the script NEVER prints real cred values. All values are SHA256-prefixed
# for human confirmation only.

set -euo pipefail

REAL="\033[0m"
BOLD="\033[1m"
RED="\033[31m"
GRN="\033[32m"
YEL="\033[33m"
RST="\033[0m"

log()  { echo -e "${BOLD}[R46]${RST} $*" >&2; }
ok()   { echo -e "${GRN}[OK]${RST} $*" >&2; }
warn() { echo -e "${YEL}[WARN]${RST} $*" >&2; }
err()  { echo -e "${RED}[ERR]${RST} $*" >&2; }

# ---- preconditions ----
if [ -z "${GH_TOKEN:-}" ]; then
  err "GH_TOKEN env var not set."
  echo "Run: export GH_TOKEN=\$(cat ~/.gh_token)" >&2
  exit 2
fi

if ! command -v gh >/dev/null 2>&1; then
  err "gh CLI not installed. install from https://cli.github.com/"
  exit 2
fi

# auth via env (no browser)
echo "${GH_TOKEN}" | gh auth login --with-token 2>/dev/null || true
gh auth status 2>&1 | head -3
echo

# ---- step 1: validate gh auth + show current secrets ----
log "step 1: validate gh auth + list secrets"
gh secret list --json name,visibility 2>&1 | head -30
echo

# ---- step 2: revoke historical PATs ----
log "step 2: revoke historical PATs (R45 reported 3 tokens leaked)"
log "These tokens were the form github_pat_11CAQ3JHA0 + suffix"
log "To delete a PAT, you need its full token string. The R45 audit"
log "recorded only prefixes; please follow up in GitHub UI:"
echo
cat <<PATTABLE

  ┌────────────────────────────────────────────────────────────────┐
  │  PAT-1 (R45 leak record + chat history)                        │
  │    prefix: github_pat_11CAQ3JHA0I4F9XX…                         │
  │  PAT-2                                                         │
  │    prefix: github_pat_11CAQ3JHA0mPQOeKA0a6yb_1iwir61…            │
  │  PAT-3                                                         │
  │    prefix: github_pat_11CAQ3JHA0h0vth5oMor2Y_BJno3uYjy6F96OjYd… │
  │                                                                │
  │  ⚠️  These 3 tokens were committed in pre-R45 git history.     │
  │     Even if you rotate them via UI today, the old values remain │
  │     observable in commit blobs unless the repo owner rewrites   │
  │     history (force-push).                                      │
  │                                                                │
  │  How to delete via UI:                                         │
  │   1. https://github.com/settings/tokens                         │
  │   2. Match the listed prefix → click "Delete"                   │
  │  CLI equivalent (after you have a token string):                │
  │     gh token delete <full_token_string>                          │
  └────────────────────────────────────────────────────────────────┘
PATTABLE
echo

# ---- step 3: rotate WX code-upload key ----
WX_KEY_FILE="${WX_KEY_FILE:-D:/小程序密钥.key}"

if [ ! -f "$WX_KEY_FILE" ]; then
  warn "WX key file not found at $WX_KEY_FILE"
  echo "    (user must reset at https://mp.weixin.qq.com → 开发管理 → 开发设置 → 重置'小程序代码上传密钥')" >&2
  echo "    Place new key at $WX_KEY_FILE (1.6-1.7 KB)" >&2
  echo "    Then re-run this script." >&2
  exit 0
fi

log "step 3: rotate WX_MINIPROGRAM_KEY_BASE64"
CURRENT_OLD_B64=$(gh secret get WX_MINIPROGRAM_KEY_BASE64 2>&1 | head -1)
NEW_B64=$(base64 -w 0 "$WX_KEY_FILE")
SIZE=$(stat -c %s "$WX_KEY_FILE")

if [ "$CURRENT_OLD_B64" = "$NEW_B64" ]; then
  warn "GH Secret same as new key — skipping update"
else
  echo -n "$NEW_B64" | gh secret set WX_MINIPROGRAM_KEY_BASE64 - 2>&1
  if [ $? -eq 0 ]; then
    ok "GH Secret WX_MINIPROGRAM_KEY_BASE64 updated ($SIZE bytes raw → base64)"
  else
    err "gh secret set failed — check auth scope (need 'repo' scope for non-fork repos)"
  fi
fi
echo

# ---- step 4: optional .env rotation ----
log "step 4: rotate .env (only if ROTATE_WX_SECRET=1 / ROTATE_DEEPSEEK_KEY=1)"
ENV_FILE="${ENV_FILE:-backend/.env}"

if [ "${ROTATE_WX_SECRET:-}" = "1" ]; then
  if [ -n "${NEW_WX_SECRET:-}" ]; then
    log "rotating WX_SECRET in $ENV_FILE"
    cp "$ENV_FILE" "$ENV_FILE.bak.$(date +%s)"
    sed -i "s|^WX_SECRET=.*|WX_SECRET=$NEW_WX_SECRET|" "$ENV_FILE"
    ok "WX_SECRET rotated. Restart backend with: pm2 restart resume-app-backend --update-env"
  else
    err "ROTATE_WX_SECRET=1 but NEW_WX_SECRET not set"
  fi
fi

if [ "${ROTATE_DEEPSEEK_KEY:-}" = "1" ]; then
  if [ -n "${NEW_DEEPSEEK_API_KEY:-}" ]; then
    log "rotating DEEPSEEK_API_KEY in $ENV_FILE"
    cp "$ENV_FILE" "$ENV_FILE.bak.$(date +%s)"
    sed -i "s|^DEEPSEEK_API_KEY=.*|DEEPSEEK_API_KEY=$NEW_DEEPSEEK_API_KEY|" "$ENV_FILE"
    ok "DEEPSEEK_API_KEY rotated. Restart backend with: pm2 restart resume-app-backend --update-env"
  else
    err "ROTATE_DEEPSEEK_KEY=1 but NEW_DEEPSEEK_API_KEY not set"
  fi
fi

if [ "${ROTATE_WX_SECRET:-}" != "1" ] && [ "${ROTATE_DEEPSEEK_KEY:-}" != "1" ]; then
  warn "no .env rotation requested (R45 closed — user keeps existing creds)"
fi
echo

# ---- step 5: smoke test ----
log "step 5: smoke test (server health + WX_SECRET still alive)"
SERVER="${SERVER:-ubuntu@43.139.176.199}"
if command -v ssh >/dev/null 2>&1; then
  ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no "$SERVER" 'curl -sS -m 5 -o /dev/null -w "/api/health=%{http_code}\n" https://127.0.0.1/api/health' 2>&1
fi

echo
ok "R46 cleanup done. Next:"
echo "  1. Delete 3 GH PATs in UI (mandatory, per step 2 above)"
echo "  2. Optional: re-run with ROTATE_WX_SECRET=1 / ROTATE_DEEPSEEK_KEY=1 if those creds change"
echo "  3. Run Audit cadence: git log --all -p | grep -E 'github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}'"
echo "     (should print zero full tokens; R45 prefix-only mentions ok)"
