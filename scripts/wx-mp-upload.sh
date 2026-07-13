#!/usr/bin/env bash
# scripts/wx-mp-upload.sh
# 手动把 mini-program 上传为微信体验版 (developer / admin 在本机跑)
#
# 用法:
#   bash scripts/wx-mp-upload.sh                    # 自动用 1.0.<秒数> + "manual upload"
#   bash scripts/wx-mp-upload.sh 1.0.7 "fix login"  # 自定义 version + desc
#
# 密钥: D:\小程序密钥.key (RSA PRIVATE KEY, 不入仓)
# 依赖: miniprogram-ci (mini-program/package.json devDep)
#
# 注: 此脚本不会自动 提交审核 — 仍需开发者去 mp.weixin.qq.com 后台手动点 提交审核

set -euo pipefail

# --- 参数解析 ---
VERSION="${1:-1.0.$(date +%s)}"
DESC="${2:-manual upload via local script}"

# --- 路径 ---
# 工作目录 (脚本相对项目根)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MP_DIR="$ROOT_DIR/mini-program"
KEY_PATH="D:/小程序密钥.key"
APPID="wx3c0c93a02f5d2356"

# --- 前置检查 ---
if [ ! -d "$MP_DIR" ]; then
  echo "[ERR] mini-program 目录不存在: $MP_DIR" >&2
  exit 1
fi

if [ ! -f "$KEY_PATH" ]; then
  echo "[ERR] 密钥文件不存在: $KEY_PATH" >&2
  echo "      请把微信公众平台下载的 代码上传密钥 放到该路径" >&2
  exit 1
fi

# --- 跑 ---
echo "[INFO] upload: appid=$APPID version=$VERSION desc='$DESC'"
cd "$MP_DIR"

# 用本地 node_modules 里的 miniprogram-ci (如果有); 否则 npx 拉
if [ -x "./node_modules/.bin/miniprogram-ci" ]; then
  CI_BIN="./node_modules/.bin/miniprogram-ci"
else
  CI_BIN="npx --yes miniprogram-ci"
fi

$CI_BIN upload \
  --pp ./ \
  --pkp "$KEY_PATH" \
  --appid "$APPID" \
  --uv "$VERSION" \
  --udata "$DESC"

echo "[OK] upload done. 去 mp.weixin.qq.com 后台 → 版本管理 → 体验版 / 提交审核"