# GH Actions Deploy E2E — 2026-07-02

## 目标

通过 GitHub Actions 触发 workflow → 跑 deploy.sh → 重启 server → smoke 验证。

## 流程

1. **本地 PATH 永久加**：`export PATH="/d/gh/bin:$PATH"` → `~/.bashrc`
2. **官方 gh CLI 验证**：`gh --version` → v2.60.0（之前是 node-gh 2.8.9 装错包）
3. **PAT 设上**：`export GH_TOKEN=...`（用户提供 fine-grained PAT）
4. **3 secrets 设上**：`SERVER_HOST` / `SERVER_USER` / `SERVER_SSH_KEY`
5. **强制 register workflow**：push deploy.yml 到 main（默认分支）
6. **trigger validate-only**：验证 secrets + SSH
7. **trigger 真 deploy**：跑 package + deploy + 重启 server

## 解决的坑

### 1. 装错 gh CLI（node-gh vs 官方）

`D:\npm-global\npm\gh` 是 `node-gh@2.8.9`，**不是** GitHub 官方 CLI。
`/d/gh/bin/gh.exe` 才是官方 `gh` v2.60.0。
→ `~/.bashrc` 加 `export PATH="/d/gh/bin:$PATH"`，新 Git Bash window 永久生效。

### 2. PAT 403 (HTTP 403: Resource not accessible)

Fine-grained PAT 默认权限不足，需要：
- Actions: Read and write
- Secrets: Read and write
- Workflows: Read and write

→ 用户在 GH UI 改 PAT 权限后，token 字符串不变，重试 200。

### 3. deploy.yml 未注册

GitHub Actions 只 register **default branch** (main) 上的 workflow。
Round 22 推的 deploy.yml 只在 develop，没 register。
→ 把 deploy.yml 也 push 到 main → id 305886792 active。

### 4. appleboy/ssh-action SSH key 解析失败

尝试 3 种姿势：
- ❌ `key: ${{ secrets.SERVER_SSH_KEY }}` — 一开始 secret 是空
- ❌ `key_path: ~/.ssh/id_rsa` — Docker 内 `~` 解析错
- ❌ `key_path: /root/.ssh/id_rsa` — Docker 容器内无权限读 `/root`
- ✅ `key: ${{ secrets.SERVER_SSH_KEY }}` — secrets 已 set 后重试成功

## 验证

### Validate-only run #28583428161

```
out: [validate] host=VM-0-8-***
out: [validate] uptime=up 7 weeks, 2 days, 5 hours, 40 minutes
✓ success 15s
```

### 真 deploy run #28583601164

```
out: [deploy] root=/opt/resume-app tarball=/tmp/resume-app-backend.tar.gz ts=1782988532
out: [deploy] files updated
out: [deploy] pm2 reloaded: resume-app-backend
out: [deploy] /api/health => 200
out: [deploy] done. backup=.deploy-backup/1782988532
✓ success 47s
```

### Server 状态变化

| 指标 | deploy 前 | deploy 后 |
|------|-----------|-----------|
| uptime | 11920s | **168s** |
| pid | 1021020 | **1069667** |
| dbPingMs | 3 | 113 (冷启后 warmup) |
| redisPingMs | 1 | 2 |

`/api/health/uptime` 重置到接近 0 = pm2 reload 真把进程换了；pid 变 = 新进程。

### 所有 endpoints post-deploy

```
GET  /api/health             200
GET  /api/health/live        200
GET  /api/health/ready       200
GET  /api/internal/metrics/summary  200
```

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | push deploy.yml 到 main | GH Actions 默认 register default branch workflow |
| 2 | `key:` 不用 `key_path:` | appleboy Docker container 内访问 `/root` 拒 |
| 3 | 不写 "Setup SSH key" step | secret 已含完整 key，direct pass 干净 |
| 4 | validate_only input 加在 workflow | secrets 改后能先验不重启 |

## 风险

| 风险 | 缓解 |
|------|------|
| PAT 暴露在对话 transcript | 建议 user 完事 revoke + 重生 |
| PAT 仍生效到 2026-09-30 | 3 月 TTL 够短期用 |
| Edge 浏览器不能上 github.com | curl 通；不影响 CLI |

## Commits

| SHA | msg |
|-----|-----|
| `535e40e` | ci: 强制 GH re-register deploy workflow |
| `67183a6` | ci: 加 deploy workflow 到 main 强制 register |
| `fe07566` | ci: SSH key 用 key_path + setup step 解决 multiline 解析 |
| `43b0459` | ci: key_path 用 ${HOME} 替换 ~ 解决 Docker 路径 |
| `1dfdec2` | ci: key_path 硬编码 /root/.ssh/id_rsa (ubuntu-latest) |
| `1aa22ef` | ci: 回 key: 直传 (appleboy 在 docker container 内可读 secret) |