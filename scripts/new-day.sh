#!/usr/bin/env bash
# 创建今日开发日志
# 用法：bash scripts/new-day.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DEVLOG_DIR="$PROJECT_ROOT/devlog"
TODAY="$(date +%Y-%m-%d)"
TARGET="$DEVLOG_DIR/$TODAY.md"

mkdir -p "$DEVLOG_DIR"

if [ -f "$TARGET" ]; then
    echo "日志已存在：$TARGET"
    exit 0
fi

cp "$DEVLOG_DIR/template.md" "$TARGET"
echo "已创建：$TARGET"