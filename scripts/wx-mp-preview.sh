#!/usr/bin/env bash
# scripts/wx-mp-preview.sh
# 手动生成 mini-program 预览二维码 (扫码即可在手机上跑)
#
# 用法:
#   bash scripts/wx-mp-preview.sh                    # 首页
#   bash scripts/wx-mp-preview.sh pages/admin/index  # 指定启动页
#
# 输出: $ROOT_DIR/dist/wx-mp-qr.png + dist/qr.txt (raw base64)

set -euo pipefail

PAGE_PATH="${1:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MP_DIR="$ROOT_DIR/mini-program"
OUT_DIR="$ROOT_DIR/dist"
QR_FILE="$OUT_DIR/qr.txt"
QR_PNG="$OUT_DIR/wx-mp-qr.png"
KEY_PATH="D:/小程序密钥.key"
APPID="wx3c0c93a02f5d2356"

mkdir -p "$OUT_DIR"

if [ ! -f "$KEY_PATH" ]; then
  echo "[ERR] 密钥文件不存在: $KEY_PATH" >&2
  exit 1
fi

echo "[INFO] preview: appid=$APPID page='${PAGE_PATH:-(default)}'"
cd "$MP_DIR"

if [ -x "./node_modules/.bin/miniprogram-ci" ]; then
  CI_BIN="./node_modules/.bin/miniprogram-ci"
else
  CI_BIN="npx --yes miniprogram-ci"
fi

ARGS=(
  preview
  --pp ./
  --pkp "$KEY_PATH"
  --appid "$APPID"
  --qrcode-format base64
  --qrcode-output-destination "$QR_FILE"
)
if [ -n "$PAGE_PATH" ]; then
  ARGS+=(--page-path "$PAGE_PATH")
fi

$CI_BIN "${ARGS[@]}"

# 解码为 PNG
QR_B64="$(cat "$QR_FILE")"
case "$QR_B64" in
  data:image/png;base64,*) PNG_B64="${QR_B64#data:image/png;base64,}" ;;
  *) PNG_B64="$QR_B64" ;;
esac
printf '%s' "$PNG_B64" | base64 -d > "$QR_PNG"

echo "[OK] QR 已生成: $QR_PNG"
echo "     用微信扫一扫即可预览"
# 尝试打开 (Windows / macOS / Linux)
if command -v explorer.exe >/dev/null 2>&1; then
  explorer.exe "$(cygpath -w "$QR_PNG")" 2>/dev/null || true
elif command -v open >/dev/null 2>&1; then
  open "$QR_PNG" 2>/dev/null || true
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$QR_PNG" 2>/dev/null || true
fi