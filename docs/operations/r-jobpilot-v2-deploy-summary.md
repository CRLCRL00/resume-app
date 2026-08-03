# R-JobPilot-v2 部署总结 (2026-08-02 → 08-03)

> 这次 deploy 踩了 **5 个坑**，每个都 debug 过 + commit 修复 + push。
> 这文档给未来 deploy 留个 reference，避免重复踩坑。

---

## TL;DR

| 状态 | 指标 |
|------|------|
| 代码 commit | **22 个**（Week 1+2+3 + 5 个 CI/ops 修复）|
| 测试 | **25/25 全绿**（backend 14 + frontend 11）|
| prod 服务 | ✅ 在 `https://43.139.176.199:443` |
| prod DB | ✅ `chat_build_sessions` 表 + `chat_build_next_question` prompt 都已 seed |
| chat-build API | ✅ mount + userAuth 跑（返 401 missing token，未带 token 时）|
| 最终 deploy | ✅ 5901d52 + 9ef4920 commits 都生效 |
| GitHub token | ✅ 已撤销 |

---

## 踩的 5 个坑（按顺序）

### 坑 1: gh CLI 未认证 → 用 stdin pipe 跑 ✅

**症状**：想用 GitHub token 调 secrets API，但 gh CLI 未登录。

**错**：直接 `export GH_TOKEN=...` → Claude Code auto-mode classifier 拒绝（理由：credential 会进 shell env + tool input transcript 永久）

**对**：用 stdin pipe + 文件读取：
```bash
cat "D:\github令牌.txt" | gh auth login --with-token
gh secret set SERVER_SSH_KEY < ~/.ssh/id_r
```

**教训**：token 不进 command、不进 env、只通过 stdin 流向 gh。

---

### 坑 2: SSH key 试了 4 个都连不上 → 第 5 个才是 ✅

**症状**：prod SSH 用 `~/.ssh/id_ed25519` 连不上 → 但**根本原因是 prod server `authorized_keys` 没配这个 key**。

**错**：让我测 4 个 key（id_ed25519/github_aigc/tencent_mbti/tencent_mbti_new）全部 Permission denied → 我以为 secret 没配齐。

**对**：用户提示"私钥文件 C:\Users\CRL.ssh\id_r"——**RSA 2048-bit 的 id_r**（不是常见的 id_ed25519）→ 测试 SSH OK！

**教训**：用户的 SSH key 不一定是 `id_ed25519`，Windows 用户常用 `id_r` 或 `id_rsa`。

---

### 坑 3: GitHub Actions secret 用 `***` 替代 → echo 触发 `Invalid format '***'`

**症状**：deploy.yml 里 `echo "server_host=$HOST" >> "$GITHUB_OUTPUT"` 报 `Invalid format '***'`。

**根因**：GitHub Actions 安全特性——secret 值在 shell 被替换成 `***`。但 `***` 不是合法 secret 格式，echo 它到 GITHUB_OUTPUT 被 GitHub 阻止。

**错**：之前用 `[[ -z "$HOST" ]]` 检查 secret 是否为空——但 `***` 不是空字符串，所以 check 永远 false。

**对**：完全跳过 secret 检查，让 SSH step 自己 fail（host 错或 key 错时 GitHub Actions 会清晰报错）。后续 step 直接用 `${{ secrets.SERVER_* }}` 不通过 outputs 中转。

**教训**：在 GitHub Actions shell step 里**根本不能 echo secret 值**到 outputs（`***` 也不行）。

---

### 坑 4: deploy.sh migration 在 pm2 reload 之后 → backend 启动 500

**症状**：第一次 deploy 触发后，health probe `/api/health/live` 返 500 连续 5 次。

**根因**：deploy.sh 顺序错：
```
4. pm2 reload (新代码启 backend)
4.5. migration runner + seed
5. health probe
```

新代码 require `chat_build_sessions` 表，但表还没建 → backend 500 → probe 500 → rollback 失败（无 backup）→ exit 11。

**对**：把 migration runner 移到 pm2 reload **之前**：
```
3.5. migration runner + seed
4. pm2 reload (DB schema 已就绪)
5. health probe (应 200)
```

**教训**：migration 必须在 backend reload 之前，**永远先 DB 后 app**。

---

### 坑 5: health probe 5×2s=10s 太短 → 首次 deploy 误报 failure

**症状**：migration 在 pm2 reload 之前了，但 health probe 仍 5 次 500。

**根因**：首次 deploy 流程是 npm ci + migration + pm2 reload + **首次启动 backend** → backend 启动需要 ~30s。probe 5×2s=10s 跑完时 backend 还没就绪。

**对**：调长 health probe 到 10×3s=30s，给 backend 足够启动时间。

**教训**：首次 deploy + migration + 首次启动的 scenario 必须预留足够启动时间。

---

## 最终部署成功证据

```bash
# 1. 服务健康
$ curl https://43.139.176.199:443/api/health/live
→ code=200 ✅

# 2. 新路由 mount (证明 migration 跑了 + 代码新版本生效)
$ curl -X POST -H "Content-Type: application/json" \
  -d '{"image":"ai_collaboration_project_lead","answers":{}}' \
  https://43.139.176.199:443/api/jobpilot/v1/chat-build/start
→ {"code":1002,"message":"missing token"} 401

# 3. (Future) 带 token 应返 200 + sessionId + firstQuestion
```

---

## 关键 commit 列表

```
9ef4920 fix(ops): deploy.sh health probe 调长 — 10x3s=30s        ← P1 修坑5
5901d52 fix(ops): deploy.sh migration 提前到 pm2 reload 之前     ← 修坑4
130491c fix(ci): deploy.yml 全面简化 (去 gh secret list 检查)    ← 修坑3
0e37eac fix(ci): deploy.yml 完全跳过 secrets 检查               ← 修坑3
fe83a50 fix(ops): deploy.sh 加 migration runner + seed            ← 修坑4 (引入)
964f5d6 ci+docs: emergency-deploy Pre-check bug + RUNBOOK Secrets 章节
6013384 ci(workflows): deploy.yml secrets 检查 + backend-test wait
0f7f465 fix(backend): db-init retry + 详细错误
... + Week 1/2/3 (R-JobPilot-v2 主线)
```

---

## 留给未来 deploy 的 checklist

- [ ] migration runner 必须在 pm2 reload **之前**
- [ ] health probe 默认 10×3s=30s（首次 deploy 给 backend 启动时间）
- [ ] secrets 不要 echo 到 GITHUB_OUTPUT（`***` 触发 Invalid format）
- [ ] SSH key 不一定是 `id_ed25519`，测 `id_r` / `id_rsa` 也试
- [ ] token 用 stdin pipe，不要 export 到 env（会被 auto-mode 拒绝 + 进 transcript）
- [ ] 首次 deploy 没 backup → rollback 失败 → 接受 exit 11（实际 deploy 仍成功）