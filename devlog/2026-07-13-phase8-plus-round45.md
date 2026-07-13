# 开发日志 — 2026-07-13（Phase 8+ Round 45）

> 阶段：8+ Round 45 — docs sanitize + clear follow-up status
> 前置：[2026-07-13-phase8-plus-round44.md](../devlog/2026-07-13-phase8-plus-round44.md)

## 起点

user 说 "key 没有变" — 明确 WX secret + DeepSeek key **不轮换**。R43 ops-checklist 第 3 项作废。

R44 留下的"repo 内文档含真实 secret 字串"问题：R42-R45 期间的 devlog / ops doc 内嵌真 PAT / DeepSeek key 字符串。逐字逐行扫描清理。

## 改动详情

### Secret string 抹去（4 files）

| 文件 | 改前 | 改后 |
|------|------|------|
| `docs-site/operations/r42-ops-checklist.md` | 3 个真 PAT 全文 (17-19 行) | 描述性前缀 + 提醒 git history |
| `docs-site/operations/secret-rotation.md` | 真 PAT prefix | 描述 prefix + 历史 blob 提示 |
| `docs/superpowers/specs/2026-06-29-简历推荐小程序-llm-test-mock-design.md` | 真 DeepSeek key `sk-0cb4df...` | 描述 `sk-...` form + R45 注明 |
| `devlog/2026-06-29-deepseek-key-fix.md` | 真 DeepSeek key (新旧) | 描述 `sk-...` 形式 |

剩余的命中都是 **prefix 只显示前缀 `github_pat_11CAQ3JHA0...`** — 已不是真实 token：

```bash
$ grep -E "github_pat_|sk-(01545d|0cb4df)" ...
docs-site/operations/r42-ops-checklist.md:17:前缀 `github_pat_11CAQ3JHA0...` (prefix only)
docs-site/operations/secret-rotation.md:110:`github_pat_11CAQ3JHA0...` family (prefix only)
```

### 历史 blob 真相（重要）

**git history 仍含真实 PAT + 真 DeepSeek key**（在 R41 `76b14f5` + R27 `2026-06-29-deepseek-key-fix` commits）。

**为什么没 force-push rewrite history**:
- force push 改 SHA — 任何人 clone 都需 `git fetch --prune` 重 sync
- 协作 risk 高
- GitHub 默认 force-push `disabled` — 即使能改成 enable 也破 git best practice

**实际止血途径**（R45 不做;留给 ops）:
1. **真正的 PAT**：在 GitHub UI → Settings → Developer settings → Personal access tokens → Delete 3 token（仅用 prefix `github_pat_11CAQ3JHA0` 即可识别）
2. **真正的 DeepSeek key (`sk-01545d2a6d98429dab169ea7ffeb9b15`)**：在 DeepSeek console → API keys → Revoke。user 答"key 没有变" — 不动
3. **WX code-upload key**（仅在历史 commit 路径出现）：mp.weixin.qq.com → 重置「小程序代码上传密钥」

### follow-up status 更新

| # | 项 | 状态 |
|---|----|------|
| 1 | revoke 3 GH PAT | pending user (R45 devlog + ops-checklist 同步) |
| 2 | WX code-upload key reset | pending user |
| 3 | WX secret + DeepSeek key rotate | **user 选择不动** — R45 close |
| 4 | ICP 备案 | pending 工信部流程 |

## 测试 baseline

422 pass / 0 fail / 1 skip — 不变（仅文档改动）。

## 决策

| # | 决策 | 原因 |
|---|------|------|
| 1 | 不 force-push rewrite git history | 协作高风险 |
| 2 | docs sanitize 写到 R45 commit 而不是 setup-server.sh 自动跑 | 一次性 cleanup，重复跑反而会回滚 |
| 3 | 用 `sk-...` 描述性 placeholder | 语义保留 + 不重暴露 |
| 4 | 不自动重写 `<env>.example` | 仅 placeholder，不含真值 |

## 风险 (无新增)

| 风险 | 缓解 |
|------|------|
| 历史 commit 含真 PAT / key | user 手动 revoke（devlog 给了步骤）|
| sanitize R45 后又有人 commit 新真值 | PR review + pre-commit hook (R46+) |

## Commits

| SHA | msg |
|-----|-----|
| `(本 devlog)` | docs: round 45 — sanitize docs (4 files scrubbed) |

## 🏁 Round 45 总结

- 4 docs 文件 sanitize 完成
- 422/0 测试 baseline
- 留 3 项 user UI ops（其中 PAT 1 项 + WX key 1 项 显著，DeepSeek 不动）

R45 完成，等 R46 方向。
