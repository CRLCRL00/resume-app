#!/usr/bin/env bash
# setup-branch-protection.sh — R132 GitHub Flow
# 设置 main branch protection: require PR + 1 approval + pr-check status
#
# 用法:
#   1. 生成 GH PAT: https://github.com/settings/tokens/new
#      - Scopes: repo (full) + admin:repo_hook (optional)
#   2. export GH_TOKEN=<your-pat>
#   3. bash scripts/setup-branch-protection.sh
#
# Verify 后:
#   gh api repos/:owner/:repo/branches/main/protection

set -euo pipefail

OWNER="${GH_OWNER:-CRLCRL00}"
REPO="${GH_REPO:-resume-app}"
BRANCH="${GH_BRANCH:-main}"

if [ -z "${GH_TOKEN:-}" ]; then
  echo "❌ GH_TOKEN 未设置"
  echo "   export GH_TOKEN=<your-personal-access-token>"
  echo "   生成: https://github.com/settings/tokens/new (scopes: repo)"
  exit 1
fi

API="https://api.github.com/repos/${OWNER}/${REPO}/branches/${BRANCH}/protection"

echo "=== R132 设置 ${OWNER}/${REPO}@${BRANCH} branch protection ==="

# 先看现有 protection
echo ""
echo "[1/3] 当前 protection 状态:"
curl -sS -H "Authorization: token ${GH_TOKEN}" \
     -H "Accept: application/vnd.github+json" \
     "${API}" \
  | head -c 200 || echo "  (无现有 protection)"

# 设置新 protection
echo ""
echo ""
echo "[2/3] 设置新 protection (PR + 1 approval + pr-check status)..."

curl -sS -X PUT \
     -H "Authorization: token ${GH_TOKEN}" \
     -H "Accept: application/vnd.github+json" \
     -H "Content-Type: application/json" \
     "${API}" \
  -d '{
    "required_status_checks": {
      "strict": true,
      "contexts": [
        "pr-check",
        "backend-test",
        "frontend-syntax",
        "docs-check",
        "prod-deploy"
      ]
    },
    "enforce_admins": false,
    "required_pull_request_reviews": {
      "dismissal_restrictions": {},
      "dismiss_stale_reviews": false,
      "require_code_owner_reviews": true,
      "required_approving_review_count": 1
    },
    "restrictions": null,
    "required_linear_history": true,
    "allow_force_pushes": false,
    "allow_deletions": false,
    "required_conversation_resolution": true,
    "lock_branch": false,
    "allow_fork_syncing": false
  }' | head -c 300

echo ""
echo ""
echo "[3/3] Verify 成功?"

curl -sS -H "Authorization: token ${GH_TOKEN}" \
     -H "Accept: application/vnd.github+json" \
     "${API}" \
  | grep -oE '"(required_status_checks|required_pull_request_reviews|enforce_admins|required_linear_history)":[^,]+' \
  | head -10

echo ""
echo ""
echo "=== 完成 ==="
echo "下一步:"
echo "  1. 跑个测试 PR 验证 pr-check 是否必须绿"
echo "  2. push 直接到 main 会被 GH 拒绝"
echo "  3. 检查 CODEOWNERS 自动 review 分配"
echo ""
echo "Verify 命令:"
echo "  gh api repos/${OWNER}/${REPO}/branches/${BRANCH}/protection"