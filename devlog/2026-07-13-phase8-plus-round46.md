# 开发日志 — 2026-07-13（Phase 8+ Round 46）

> 阶段：8+ Round 46 — leak cleanup orchestration + ops-side automation
> 前置：[2026-07-13-phase8-plus-round45-5.md](../devlog/2026-07-13-phase8-plus-round45-5.md)

## 起点

user 答"你去尝试处理" — 我尝试处理 user 侧 3 ops 行动。

**自查**:
- `gh auth status` — not logged in, needs new PAT or interactive
- WX key file `D:\小程序密钥.key` 存在 (1675 bytes, mtime Jul 5)
- 我能不能**自动**删 3 历史 GH PAT: **不能** — 需你登录 gh / 给我新 token
- 我能不能**自动**重置 WX code-upload key: **不能** — 需 mp.weixin.qq.com UI 扫码
- 我能不能**自动**改 server `.env`: **不能** — 你说 key 不变

**能做**:
1. 写 1-shot orchestration script (`infra/r46-leak-cleanup.sh`) — 等你给新 PAT 后一键跑完
2. 写当前 status devlog (this file)

## 改动

### `infra/r46-leak-cleanup.sh` (新, 110 行)

1-shot automation for cleanup windows:

**Step 1**: `gh auth login` via env `GH_TOKEN` (no browser)
**Step 2**: 显示 R45 的 3 个 PAT prefix，提醒 GitHub UI 手动删（不能 auto-delete）
**Step 3**: 如果 `D:/小程序密钥.key` 存在，base64 后 `gh secret set WX_MINIPROGRAM_KEY_BASE64 -`
**Step 4**: 可选 `.env` 轮换（`ROTATE_WX_SECRET=1 NEW_WX_SECRET=...`）
**Step 5**: server smoke + audit cadence reminder

**安全设计**:
- 永远不印任何 secret 真值
- 所有 print 都用 prefix / SHA256 prefix
- `ENV_FILE.bak.<ts>` 自动备份
- `set -euo pipefail` 严格错误

**Usage**:
```bash
export GH_TOKEN=<your_new_pat>
bash infra/r46-leak-cleanup.sh
# Or with .env rotation:
export GH_TOKEN=<new_pat> NEW_WX_SECRET=<new> ROTATE_WX_SECRET=1
bash infra/r46-leak-cleanup.sh
```

## user 侧仍需 3 步

1. **GitHub UI 删 3 历史 PAT** (按 R45 prefix `github_pat_11CAQ3JHA0...`)
2. **mp.weixin.qq.com UI 重置 WX code-upload key** (然后到 `D:\小程序密钥.key`)
3. **ICP 备案** (14-30 天)

如果前 2 完成后，optional 我跑：
```bash
export GH_TOKEN=<your_new_pat>
bash infra/r46-leak-cleanup.sh
```
一键 base64 + GH secret set + audit。

## npm test baseline

422 pass / 0 fail / 1 skip — 不变 (纯 bash script，没 JS 改动)。

## 决策

| # | 决策 | 原因 |
|---|------|------|
| 1 | 不 auto-login gh CLI | 触发 browser 阻塞流程，user 需单独登录 |
| 2 | user 侧 ops 手动为主 (UI-driven) | 不能 script 这些外部服务 |
| 3 | 提供 orchestration script 而非 runbook | runbook 太繁琐；脚本 1-shot + 校验 |
| 4 | 不打印真值 | 即使 hash 也不安全；只显示 prefix + 形态 |

## 风险

| 风险 | 缓解 |
|------|------|
| user 跳过此脚本手动做 | devlog 写出明确步骤 |
| `gh secret set` 在 fork repo 可能 lock | 提示 ERR "scope 'repo'" |
| base64 文件错 | 校验 size + diff vs 前值 |
| user 误填 ROTATE_WX_SECRET=1 NEW_WX_SECRET=空 | 加错处 fail，不静默 |

## Commits

| SHA | msg |
|-----|-----|
| `(本 devlog)` | docs: round 46 — leak cleanup orchestration |

## 🏁 Round 46 总结

试处理 user 侧 ops 项:
- 自动 part: orchestration script (`infra/r46-leak-cleanup.sh`)
- 手动 part: 3 steps (UI 删 PAT + 重置 WX + ICP 备案)

R46 完成。等 user 答:
A. 给我新 GH PAT + 跑脚本一键 step 1+3 (PAT 删 + GH secret set)
B. 仅用现 WX key (现状) — 不动 key
C. 跳过 auto 部分, 我自己 UI 跑
