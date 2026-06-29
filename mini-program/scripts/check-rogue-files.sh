#!/bin/bash
# check-rogue-files.sh — scan miniprogram pages for misnamed files at wrong path level
# Use case: WeChat may use either flat or nested page structure, but not both.
# If pages/X/{X.js,X.wxml} exists, there must NOT be pages/X.js or pages/X.wxml
# alongside the dir. Such "rogue" duplicates confuse the wx loader (returns wx://not-found).
#
# Run:  bash scripts/check-rogue-files.sh

set -e
cd "$(dirname "$0")/.."

FAIL=0
for d in pages/*/; do
  name=$(basename "$d")
  if [ -d "$d" ] && [ "$name" != "index" ]; then
    for ext in js wxml json wxss; do
      if [ -f "$d/$name.$ext" ]; then
        sibling="$(dirname $d)/$name.$ext"
        if [ -f "$sibling" ]; then
          echo "ROGUE: $sibling AND $d/$name.$ext (WeChat will be confused)"
          FAIL=1
        fi
      fi
    done
  fi
done

if [ $FAIL -eq 0 ]; then
  echo "OK: no rogue files found"
fi
exit $FAIL
