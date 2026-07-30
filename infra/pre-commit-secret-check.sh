#!/bin/bash
# R45.5: pre-commit hook — refuses to commit if staged diff contains:
#   1. A full GitHub PAT (prefix `github_pat_` followed by ≥ 30 alphanumeric / underscores)
#   2. A DeepSeek / OpenAI style API key (`sk-` followed by ≥ 20 alphanumeric)
#   3. A literal WeChat code-upload key file path: `D:\小程序密钥.key`
#
# Why this hook:
#   R45 sanitize removed leaked creds from docs/devlog but the same values still
#   exist in git history (force-push rewrite was rejected for collaboration
#   reasons). This hook ensures they are not duplicated in future commits.
#
# Configuration (overridable via env):
#   SKIP_SECRET_CHECK=1   — bypass (for one-off commits; logs explicit bypass)
#   BLOCK_PAT_PREFIXES    — extra prefixes (default: github_pat_)
#   BLOCK_KEY_PREFIXES    — extra key prefixes (default: sk-)
#
# Install:
#   local:  cp infra/pre-commit-secret-check.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
#   server: setup-server.sh runs this hook installer at step 11

set -uo pipefail
HOOK_NAME="secret-check"

# Skip on explicit override
if [ "${SKIP_SECRET_CHECK:-}" = "1" ]; then
  echo "[$HOOK_NAME] SKIP_SECRET_CHECK=1 — bypass" >&2
  exit 0
fi

PAT_PREFIXES="${BLOCK_PAT_PREFIXES:-github_pat_}"
KEY_PREFIXES="${BLOCK_KEY_PREFIXES:-sk-}"

# Find staged content (added/copied/modified; excludes deleted)
STAGED=$(git diff --cached --diff-filter=ACMR --unified=0 | grep -E '^\+[^+]' || true)
if [ -z "$STAGED" ]; then
  exit 0
fi

FAIL=0
for prefix in $PAT_PREFIXES; do
  if echo "$STAGED" | grep -qE "\+${prefix}[A-Za-z0-9_]{20,}"; then
    echo "[$HOOK_NAME] BLOCKED: staged diff contains PAT-shaped value with prefix '$prefix'" >&2
    echo "[$HOOK_NAME] To bypass: SKIP_SECRET_CHECK=1 git commit ..." >&2
    FAIL=1
  fi
done

for prefix in $KEY_PREFIXES; do
  if echo "$STAGED" | grep -qE "\+${prefix}[A-Za-z0-9]{20,}"; then
    echo "[$HOOK_NAME] BLOCKED: staged diff contains API-key-shaped value with prefix '$prefix'" >&2
    echo "[$HOOK_NAME] To bypass: SKIP_SECRET_CHECK=1 git commit ..." >&2
    FAIL=1
  fi
done

# WX code-upload key file path — strict literal match
if echo "$STAGED" | grep -qF '小程序密钥.key'; then
  echo "[$HOOK_NAME] BLOCKED: staged diff mentions Windows path D:\\小程序密钥.key" >&2
  echo "[$HOOK_NAME] To bypass: SKIP_SECRET_CHECK=1 git commit ..." >&2
  FAIL=1
fi

if [ $FAIL -ne 0 ]; then
  echo "" >&2
  echo "Hint: redact to a placeholder like <WX_KEY_PATH>, then commit." >&2
  exit 1
fi

exit 0
