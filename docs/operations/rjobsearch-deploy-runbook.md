# R-JobSearch 部署 runbook (2026-07-30)

> 本文件覆盖 R-JobSearch 重构（5 步流 + jobpilot 服务）部署涉及的服务器侧动作。
> 配套参考：[deploy.md](./deploy.md)（基础 server 手册）、[RUNBOOK.md](../../RUNBOOK.md)（运维总览）。

## 背景

R-JobSearch 重构新增了三类数据库 schema 变化 + 三个后端 service：

| 改动 | 文件 | 必须执行 |
|------|------|----------|
| `jobs` 表加 `verify_status` / `verified_at` / `score_10` / `interview_focus` 列 | `backend/db/migrations/jobpilot.sql` | ✅ |
| `resumes` 表加 `story_points` JSON 列 | 同上 | ✅ |
| 新表 `jobpilot_applications` | 同上 | ✅ |
| `backend/src/services/matchService.js` 加 verify_status 输出 | — | 自动生效 |
| `backend/src/services/jobpilotAi.js` (新) — diagnoseProfile + scoreProject | — | 自动生效 |
| `backend/src/services/resumeGenerator.js` (refactor) — 输出 story_points | — | 自动生效 |
| `backend/src/routes/match.js` 加 `/api/match/apply`、`/api/match/applications*` | — | 自动生效 |
| `backend/src/routes/jobpilot.js` (新) — `/api/jobpilot/profile-diagnose`、`/project-score` | — | 自动生效 |

> **不跑 migration 的后果**: backend 启动会 500 (`Unknown column 'story_points'`)，jobpilot API 全 404 (route 不加载)。

## 部署流水线（自动化）

我们已迁到 GH Actions 触发 + SSH 自动 deploy：

1. **代码 push 到 main** (开发推到 develop, ready → merge to main)
   ```bash
   git checkout main
   git merge --no-ff develop
   git push origin main
   ```
2. **GitHub Actions `Deploy` workflow 自动触发**:
   - resolve-target job：main → prod → `43.139.176.199`
   - package job：tar backend (exclude node_modules/.env/logs/tests)
   - deploy job：SCP → 跑 `scripts/deploy.sh` → pm2 reload
   - 末尾 health probe，连续 5 次 503 自动回滚到上一版

3. **Mini-Program upload workflow 同时触发**（如果 push 涉及 `mini-program/**`）:
   - `Inject runtime config` 步骤注入 `src/config.js` (含 prod URL)
   - `miniprogram-ci upload` 把体验版推到微信后台
   - `Cleanup injected config` 清理（即使 gitignored 也保险起见）

## 服务端必须跑的步骤 (一次性)

`db/migrations/jobpilot.sql` 不会自动跑 — 需要服务器侧手动执行一次。

### Step 1: SSH 登录

```bash
ssh ubuntu@43.139.176.199
```

> 用的是 [deploy.md](./deploy.md) 第 11 行提到的私钥：`C:\Users\CRL\.ssh\id_r`

### Step 2: 验证 deploy 已完成

deploy.sh 默认会健康探测 `/api/health`，但**不会**碰 schema。
先确认 backend 在新代码下能起来（即使是 migration 失败也应该有错误日志）：

```bash
pm2 logs resume-app-backend --lines 20 --nostream
```

期望看到：
- ✅ 正常：`Server listening on :3000` (或 systemd 风格的 ready 行)
- ⚠️ `Unknown column 'resumes.story_points'` → 还没跑 migration，**继续 Step 3**
- ❌ 启动脚本 exit code != 0 → 看 deploy 日志，**先 abort 跑 deploy 而不是 migration**

### Step 3: 跑 migration (核心阻塞项)

```bash
# 1. 进 backend 目录
cd /opt/resume-app/backend

# 2. 备份当前 db (防 migration 失败回滚)
mysqldump -h 127.0.0.1 -u root -p'$MYSQL_ROOT_PASSWORD' resume_app \
  > /tmp/before-jobpilot-migration-$(date +%Y%m%d-%H%M%S).sql
# (上面 MYSQL_ROOT_PASSWORD 在 deploy.md line 26)

# 3. 跑 migration
mysql -h 127.0.0.1 -u root -p'$MYSQL_ROOT_PASSWORD' resume_app \
  < db/migrations/jobpilot.sql

# 4. 验证 schema 已更新
mysql -h 127.0.0.1 -u root -p'$MYSQL_ROOT_PASSWORD' resume_app \
  -e "SHOW COLUMNS FROM resumes LIKE 'story_points';
      SHOW COLUMNS FROM jobs LIKE 'verify_status';
      SHOW COLUMNS FROM jobs LIKE 'score_10';
      SHOW COLUMNS FROM jobs LIKE 'interview_focus';
      SHOW TABLES LIKE 'jobpilot_applications';"

# 期望：
# - resumes.story_points: JSON 列
# - jobs.verify_status: enum('verified','stale','unverified')
# - jobs.score_10: int 列
# - jobs.interview_focus: varchar 列
# - jobpilot_applications: 表存在
```

### Step 4: pm2 reload 触发 backend reload 新 schema

```bash
pm2 reload resume-app-backend --update-env
# 或: pm2 restart resume-app-backend --update-env (reload 不行时)
sleep 3
curl -k https://43.139.176.199/api/health
# 期望 200 OK
```

### Step 5: 测 jobpilot API（确认 route 加载）

```bash
# 用 admin token 测 (从现有 .env 的 ADMIN_TOKEN 取，或用 admin-panel/login 登录拿)

# 1. profile-diagnose
curl -k -X POST https://43.139.176.199/api/jobpilot/profile-diagnose \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"education":"本科","aiAbility":"AI 协作","projects":"简历 app + DeepSeek","target":"实习","timeline":"立刻"}'
# 期望: code:0 + image + confidence + recommendedJobs

# 2. project-score
curl -k -X POST https://43.139.176.199/api/jobpilot/project-score \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name":"简历推荐小程序","techStack":"Express + MySQL + DeepSeek","aiCollaboration":"Claude 协作 + 我 review","myRole":"项目负责人","url":"https://github.com/CRLCRL00/resume-app"}'
# 期望: code:0 + score:7.x + breakdown + storyPoints

# 3. match-apply (从已有简历 + 真实 job id)
curl -k -X POST https://43.139.176.199/api/match/apply \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"job_id": 1}'
# 期望: code:0 + status:'applied' 或 'already_applied'
```

## 真机验证 (用户必做)

### 1. 等 GH Actions 跑完

GH Actions 网页: <https://github.com/CRLCRL00/resume-app/actions>
- `Deploy` run → 绿勾
- `Upload Mini-Program` run → 绿勾
- 看 Deploy Summary 的 host + commit 对得上 c23861b

### 2. 重启 IDE / 清缓存

```bash
# 微信开发者工具 → 详情 → 清缓存 → 重新编译
# 或：删除项目重新导入
```

### 3. 体验版扫码

- mp.weixin.qq.com → 版本管理 → 找到最新体验版
- 扫码 → 进首页 → 点 "🚀 找岗位 (AI 智能匹配)"
- 走完 5 步流程：
  | Step | 期望 |
  |------|------|
  | 1 画像 | 填 5 题 → AI 输出 image + 推荐岗位芯片 |
  | 2 项目 | 填项目 → AI 评分 7.x + 5 项 breakdown + STAR 故事点预览 |
  | 3 匹配 | resume_id 自动填 → 匹配 → 看到 ✓ verified / ⚠ stale + 1-10 分 |
  | 4 生成 | resume_id 自动填 → 生成 → 看到 3-5 个 STAR 卡 + 简历文本 |
  | 5 追踪 | 自动加载 applications 列表 + 状态按钮组 |

### 4. 截图 & 记录

8 个关键截图位见 `docs/作品集/screenshots-needed.md`。
Jobpilot 5 步流程至少要 5 张（每个 step 一张）+ AI 输出结果。

## 回滚 (deploy.yml 内置)

如果 health probe 5 次连续 503：

1. workflow 自动回滚到 `.deploy-backup/<prev-ts>/`
2. 或手动：
   ```bash
   ssh ubuntu@43.139.176.199
   cd /opt/resume-app/backend
   ls .deploy-backup/
   cp -pR .deploy-backup/<prev-ts>/src .
   pm2 reload resume-app-backend
   ```

> ⚠️ migration 已经跑了，回滚不会自动 revert schema。要还原：
> ```bash
> mysql -h 127.0.0.1 -u root -p'$MYSQL_ROOT_PASSWORD' resume_app \
>   < /tmp/before-jobpilot-migration-<ts>.sql
> ```

## TL;DR 给用户

最关键的 3 步（其他都是 nice-to-have）：

1. **等 GH Actions 跑完** → Deploy 绿 + Upload 绿
2. **ssh 跑 migration**（Step 3 那一段，~10s）
3. **真机扫码走 5 步流程**

如果第 3 步失败，先看 `pm2 logs` 和 `docs/operations/monitoring.md`。

---

_Generated by Claude · 2026-07-30 · 配套 commit c23861b_
