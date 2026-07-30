#!/bin/bash
# R45.5: install pre-commit hook on this repo
# Usage: bash infra/install-secret-precommit.sh
# Idempotent: re-running overwrites existing hook.

set -uo pipefail
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
HOOK="$ROOT/.git/hooks/pre-commit"
SRC="$ROOT/infra/pre-commit-secret-check.sh"

if [ ! -f "$SRC" ]; then
  echo "[install] FATAL: source not found: $SRC" >&2
  exit 1
fi

if [ ! -d "$ROOT/.git" ]; then
  echo "[install] FATAL: not a git repo: $ROOT" >&2
  exit 1
fi

cp -f "$SRC" "$HOOK"
chmod +x "$HOOK"
echo "[install] pre-commit hook installed at $HOOK" >&2

# Self-test: ensure hook runs in test mode and refuses a fake token.
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

cd "$TMPDIR"
git init -q .
git -c user.email=test@example.com -c user.name=test commit --allow-empty -m init -q
cp "$SRC" ".git/hooks/pre-commit"
chmod +x ".git/hooks/pre-commit"

echo "secret_good" > file.txt
git add file.txt
git -c user.email=t@e.com -c user.name=t commit -m good -q && echo "[install] sanity: clean commit passes ✓" >&2

echo "github_pat_FAKEfakefakeFAKEfakefakefakefakefake" > file.txt
git add file.txt
if git -c user.email=t@e.com -c user.name=t commit -m bad 2>&1 | grep -q "BLOCKED: staged diff contains PAT"; then
  echo "[install] sanity: hook blocks PAT ✓" >&2
else
  echo "[install] WARN: hook DID NOT block PAT (regex may need tuning)" >&2
fi

echo "[install] done" >&2
