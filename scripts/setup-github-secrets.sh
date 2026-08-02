#!/usr/bin/env bash
# R-JobPilot-v2: 一键配 GitHub Actions Secrets (SERVER_HOST / SERVER_USER / SERVER_SSH_KEY)
#
# 用法: bash scripts/setup-github-secrets.sh
# 前置: gh CLI 已认证 (gh auth login)
#
# ⚠️ 安全: SSH private key 用 gh secret set < ~/.ssh/id_ed25519 读文件, 不显示在终端
#   private key 绝不能贴到对话/chat/任何 prompt

set -e

REPO="CRLCRL00/resume-app"

echo "=== R-JobPilot-v2 GitHub Secrets 配置 ==="
echo "目标 repo: $REPO"
echo ""

# 检查 gh 认证
if ! gh auth status &>/dev/null; then
  echo "❌ gh CLI 未认证. 跑 'gh auth login' 后重试"
  exit 1
fi

# 1. SERVER_HOST
echo ">>> [1/3] 配置 SERVER_HOST = 43.139.176.199"
gh secret set SERVER_HOST \
  --repo "$REPO" \
  --body "43.139.176.199"
echo "✓ SERVER_HOST 配置完成"

# 2. SERVER_USER
echo ""
echo ">>> [2/3] 配置 SERVER_USER = ubuntu"
echo "    (默认 ubuntu. 如果你 prod server 用了别的 user, Ctrl+C 退出后改)"
read -p "    用 ubuntu 继续? [Y/n] " CONTINUE
CONTINUE=${CONTINUE:-Y}
if [[ "$CONTINUE" =~ ^[Yy]$ ]]; then
  gh secret set SERVER_USER \
    --repo "$REPO" \
    --body "ubuntu"
  echo "✓ SERVER_USER 配置完成"
else
  echo "⏭️  跳过 SERVER_USER. 手动跑 gh secret set SERVER_USER --body <your-user>"
fi

# 3. SERVER_SSH_KEY
echo ""
echo ">>> [3/3] 配置 SERVER_SSH_KEY"
echo "    从 ~/.ssh/id_ed25519 / id_rsa / 阿里云 SSH key 读"
echo ""
echo "    选项:"
echo "      a) 默认路径: ~/.ssh/id_ed25519"
echo "      b) 默认路径: ~/.ssh/id_rsa"
echo "      c) 自定义路径"
echo ""

# 自动找 SSH key
SSH_KEY=""
for path in "$HOME/.ssh/id_ed25519" "$HOME/.ssh/id_rsa" "$HOME/.ssh/github_key"; do
  if [ -f "$path" ]; then
    SSH_KEY="$path"
    break
  fi
done

if [ -z "$SSH_KEY" ]; then
  read -p "    输入 SSH private key 路径 (例如 ~/.ssh/id_ed25519): " SSH_KEY
fi

if [ ! -f "$SSH_KEY" ]; then
  echo "❌ 文件不存在: $SSH_KEY"
  exit 1
fi

# 验证是 private key
if ! head -1 "$SSH_KEY" | grep -qE "PRIVATE KEY|RSA"; then
  echo "❌ 文件不是 SSH private key (开头不是 PRIVATE KEY / RSA)"
  echo "    你确认要配这个文件吗? [y/N]"
  read -p "    y 确认: " CONFIRM
  if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

echo "    配 $SSH_KEY"
gh secret set SERVER_SSH_KEY \
  --repo "$REPO" \
  < "$SSH_KEY"
echo "✓ SERVER_SSH_KEY 配置完成"

# 验证
echo ""
echo "=== 验证配置 ==="
gh secret list --repo "$REPO" | grep -E "SERVER_(HOST|USER|SSH_KEY)" || echo "(查不到 secrets, 但 gh secret set 应该成功了)"

echo ""
echo "=== 下一步 ==="
echo "1. 跑 validate_only 验证连通性:"
echo "   bash scripts/trigger-deploy-validate.sh"
echo ""
echo "2. 如果 validate job SSH 连通, push 触发真 deploy:"
echo "   git commit --allow-empty -m 'chore: trigger deploy after secrets config'"
echo "   git push origin main"
echo ""
echo "3. 完整 RUNBOOK 在 RUNBOOK.md '一·五、GitHub Actions Secrets 配置' 章节"