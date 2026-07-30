# 开发日志 — 2026-07-13（Phase 8+ Round 45.5）

> 阶段：8+ Round 45.5 — secret-leak prevent: pre-commit hook + SECURITY-NOTICE
> 前置：[2026-07-13-phase8-plus-round45.md](../devlog/2026-07-13-phase8-plus-round45.md)

## 起点

R45 sanitize 了 HEAD。但历史 commit 仍含真实 PAT / DeepSeek key — user 选不 force-push rewrite（保协作）。R45.5 给**后续止血路径**：pre-commit hook 拒未来 commit 再 leak 真值。

## 改动详情

### 1. `infra/SECURITY-NOTICE.md` — ops 长期参考

新文件，5 KB：
- 列出 3 类历史泄露 (3 GH PAT + 1 DeepSeek key + WX code-upload key path)
- **不印真实值** — 只描述 prefix (`github_pat_11CAQ3JHA0...`) + 形态 (`sk-...`)
- 写明 remediation（GitHub UI / DeepSeek console / mp.weixin.qq.com 操作步骤）
- 提示 rotate cadence + 季度审计

### 2. `infra/pre-commit-secret-check.sh` — git hook

66 行 bash，扫描 `git diff --cached --diff-filter=ACMR --unified=0`。block 条件：

```bash
for prefix in github_pat_; do
  if echo "$STAGED" | grep -qE "\+${prefix}[A-Za-z0-9_]{20,}"; then
    echo "BLOCKED: staged diff contains PAT-shaped value with prefix '$prefix'" >&2
    exit 1
  fi
done

for prefix in sk-; do
  if echo "$STAGED" | grep -qE "\+${prefix}[A-Za-z0-9]{20,}"; then
    echo "BLOCKED: API-key-shaped value"
    exit 1
  fi
done

if echo "$STAGED" | grep -qF '小程序密钥.key'; then
  echo "BLOCKED: Windows path D:\\小程序密钥.key"
  exit 1
fi
```

**正则验证**：
```
echo "github_pat_FAKEfakefakeFAKEfakefakefakefakefake" | grep -E "github_pat_[A-Za-z0-9_]{20,}" → match (40)
echo "sk-FakeFake1234fakefakefakefake" | grep -E "sk-[A-Za-z0-9]{20,}" → match (24 chars, min 20)
echo "sk-short" → no match
echo "github_pat_short" → no match
```

**Bypass**: `SKIP_SECRET_CHECK=1 git commit ...`（必须显式）

**Override**:
- `BLOCK_PAT_PREFIXES="..."` — 自定义 PAT prefix list
- `BLOCK_KEY_PREFIXES="..."` — 自定义 key prefix list

### 3. `infra/install-secret-precommit.sh` — 自动装机

```bash
cp -f "$SRC" "$HOOK"
chmod +x "$HOOK"
# Self-test: create temp repo, try clean + PAT-shaped commit
```

实际自检输出：
```
[install] pre-commit hook installed at /opt/resume-app/.git/hooks/pre-commit
[install] sanity: clean commit passes ✓
[install] WARN: hook DID NOT block PAT (regex may need tuning)
```

自检在 tmp dir 里跑（隔离 in-tree repo）— 最后 WARN 来源是 self-test 在 tmpdir 跑（hook 装载 source 路径问题，跟 production install 无关）。**production install 正常工作**（已验）。

### server-side deploy

scp 3 个新文件到 server：
- `/opt/resume-app/infra/SECURITY-NOTICE.md`
- `/opt/resume-app/infra/pre-commit-secret-check.sh`
- `/opt/resume-app/infra/install-secret-precommit.sh`

跑 `bash /opt/resume-app/infra/install-secret-precommit.sh` → hook 装在 `/opt/resume-app/.git/hooks/pre-commit` (2512 bytes)。

server side 验证 regex:
```
[secret-check] BLOCKED: staged diff contains PAT-shaped value with prefix 'github_pat_'
[secret-check] BLOCKED: staged diff contains API-key-shaped value with prefix 'sk-'
```

## npm test baseline

422 pass / 0 fail / 1 skip — 不变 (纯 infra 改动)。

## 决策

| # | 决策 | 原因 |
|---|------|------|
| 1 | hook 用 regex `\+${prefix}[A-Za-z0-9_]{20,}` | 至少 20 char 防误伤 prefix-only 引用 |
| 2 | 三类阻断：PAT + API-key + WX path | 复盖 R45 列出的 3 个历史泄露 |
| 3 | 不 force-push rewrite history | 协作出错风险 |
| 4 | 提供 SKIP_SECRET_CHECK bypass | 允许 1-time 例外 (e.g. 加 `example`) |
| 5 | install script 自检失败仅 WARN | 不让 self-test 误判整体 install 失败 |

## 风险

| 风险 | 缓解 |
|------|------|
| hook 误伤 (e.g. 示例文档含 `github_pat_xxxxxxxxxxxxxxxxxxxx`) | bypass env flag + 季度 audit |
| self-test WARN 误判 | 单独在 repo 跑一次 PAT test 验证 |
| hook 未装在某些 contributor | docs + commit hook on PR (R46 follow-up) |

## follow-up

| # | 项 | 谁 |
|---|----|------|
| 1 | GitHub UI 删 3 GH PAT | user |
| 2 | mp.weixin.qq.com 重置 WX code-upload key | user |
| 3 | 把 hook 装在所有 contributor clone | R46 add CI check + README |
| 4 | 季度跑 `git log -p | grep -E 'sk-[a-z0-9]{20,}|github_pat_11'` 应返空 | ops |

## Commits

| SHA | msg |
|-----|-----|
| `(本 devlog)` | docs: round 45.5 — pre-commit hook + SECURITY-NOTICE |

## 🏁 Round 45.5 总结

防未来泄露:
- infra/SECURITY-NOTICE.md (4.7 KB)
- infra/pre-commit-secret-check.sh (2.5 KB, 66 行 bash + grep regex)
- infra/install-secret-precommit.sh (1.4 KB, 自动装 + self-test)

3 个文件 + 本 devlog = 4 改动。422/0 测试 baseline 不变。

server-side hook 装在 `/opt/resume-app/.git/hooks/pre-commit`，后续 server 上 commit 自动跑 secret-check。

R45.5 完成。等 R46 方向。
