# R-JobSearch 重构 - 验证 Runbook

> 推翻重做完成后,你本地需要做的验证步骤。

## 🚀 一、跑 SQL Migration

```bash
cd d:\项目\简历app\backend
mysql resume_app < db/migrations/jobpilot.sql
```

**预期结果**:
- ✓ ALTER TABLE resumes ADD COLUMN story_points → 成功
- ✓ ALTER TABLE jobs ADD COLUMN verify_status → 成功 (DEFAULT 'unverified')
- ✓ ALTER TABLE jobs ADD COLUMN verified_at → 成功
- ✓ CREATE INDEX idx_jobs_verify → 成功
- ✓ CREATE TABLE jobpilot_applications → 成功

**如果失败**:
- "Duplicate column name 'verify_status'" → 已跑过,跳过 (无副作用)
- "Table 'jobpilot_applications' already exists" → 已跑过,跳过
- "Key column 'verify_status' doesn't exist in table" → jobs 表结构不一样,检查 schema.sql

## ✅ 二、验证 Schema

```sql
mysql resume_app -e "
DESC jobpilot_applications;
SHOW COLUMNS FROM jobs WHERE Field IN ('verify_status', 'verified_at');
SHOW COLUMNS FROM resumes WHERE Field = 'story_points';
"
```

**预期看到**:
```
jobpilot_applications: id, user_id, job_id, status, note, hr_contact,
                       applied_at, status_updated_at, follow_up_at,
                       interview_at, created_at, deleted_at
jobs: verify_status (varchar(20)), verified_at (datetime)
resumes: story_points (json)
```

## 🧪 三、跑测试

### 3.1 跑现有 114 测试 (确认没破坏基线)
```bash
cd d:\项目\简历app\backend
npm test 2>&1 | tail -30
```

**预期**: 114 pass, 0 fail
**如果失败**: 大概率是 matchService.match() 的 verify_status / score_10 字段影响了现有断言 (字段顺序变了)

### 3.2 跑新加的 16 个测试
```bash
node --test tests/service-jobpilot-applications.test.js 2>&1 | tail -20
node --test tests/route-jobpilot.test.js 2>&1 | tail -20
```

**预期**: 16 pass, 0 fail
**常见失败原因**:
- "Table 'jobpilot_applications' doesn't exist" → SQL migration 没跑
- "follow_up_at 时间已过" → 测试需要清表后再跑
- "Foreign key constraint" → users 表需要 seed 用户 123 (mock userId)

## 🔧 四、手动 curl 测试 (HTTP 验证)

### 4.1 准备: 拿一个真实 token
打开小程序,登录后从控制台抓 `Authorization: Bearer xxx` 的 token。

或者用 mock token (开发环境):
```bash
TOKEN="dev_token_skip"
```

### 4.2 测试 match 加新字段
```bash
curl -X POST http://localhost:3003/api/match/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"resume_id": 1}'
```

**预期看到** (`results` 数组每个元素):
```json
{
  "job_id": 5,
  "title": "...",
  "verify_status": "unverified",   // 🆕 新增
  "verified_at": null,             // 🆕 新增
  "score": 75,
  "score_10": 8,                   // 🆕 新增 (1-10)
  "reason": "...",
  "interview_focus": [...]         // 🆕 新增
}
```

### 4.3 测试 apply (投递标记)
```bash
curl -X POST http://localhost:3003/api/match/apply \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"job_id": 5, "note": "first apply"}'
```

**预期**:
```json
{"code": 0, "data": {"application_id": 1, "status": "submitted"}}
```

### 4.4 测试 applications (投递列表)
```bash
curl -X GET http://localhost:3003/api/match/applications \
  -H "Authorization: Bearer $TOKEN"
```

**预期**: 看到刚才投递的 application,含 `job`, `status`, `applied_at`, `needs_follow_up` 等字段

### 4.5 测试 PATCH (更新状态)
```bash
curl -X PATCH http://localhost:3003/api/match/applications/1 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "viewed", "note": "HR 看了"}'
```

**预期**: `{"code": 0, "data": {"ok": true}}`

### 4.6 测试 PATCH 拒绝无效状态
```bash
curl -X PATCH http://localhost:3003/api/match/applications/1 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "invalid_xyz"}'
```

**预期**: 400 + `invalid status: invalid_xyz`

### 4.7 测试 story-points (简历生成)
```bash
curl -X POST http://localhost:3003/api/resume/generate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"resume_id": 1}'
```

**预期**:
```json
{
  "code": 0,
  "data": {
    "resume_id": 1,
    "content_md": "...",
    "story_points": [              // 🆕 新增
      {"title": "...", "situation": "...", "task": "...", "action": "...", "result": "..."}
    ],
    "mode": "structured"             // 🆕 新增 (structured / plaintext)
  }
}
```

### 4.8 测试 GET /story-points/:id (单独获取)
```bash
curl -X GET http://localhost:3003/api/resume/story-points/1 \
  -H "Authorization: Bearer $TOKEN"
```

**预期**:
```json
{"code": 0, "data": {"resume_id": 1, "story_points": [...]}}
```

## 📱 五、小程序手动测试

### 5.1 启动后端
```bash
cd d:\项目\简历app\backend
npm start  # 或 pm2 restart resume-app-backend --update-env
```

### 5.2 微信开发者工具打开 mini-program
- 添加项目: `d:\项目\简历app\mini-program\`
- AppID: `wx3c0c93a02f5d2356`
- 编译 + 预览

### 5.3 测试新页面
- 在 app.json 已经加的 `pages/jobpilot/index/index` 应该出现在页面列表
- 编译后,Tab Bar 可能不显示 (新页面不在 tabBar 里)
- 用 wx.navigateTo 跳过去: `wx.navigateTo({ url: '/pages/jobpilot/index/index' })`
- 5 个 Tab 应该都能切换
- Step 3 (岗位匹配) 需要先填简历 ID — 用 /pages/me/me 里的"我的简历" 拿 ID
- Step 5 (投递追踪) 需要先在 Step 3 标记投递

## 📝 六、清理测试数据

测试结束后,清理测试创建的数据:
```sql
mysql resume_app -e "
DELETE FROM jobpilot_applications WHERE note LIKE '%test%';
DELETE FROM jobs WHERE title LIKE '%test%';
DELETE FROM users WHERE openid LIKE '%test%';
"
```

## ⚠️ 常见问题排查

### Q1: 跑测试报 "ECONNREFUSED 127.0.0.1:3306"
**原因**: MySQL 没跑或端口不对  
**解决**: `net start mysql` 或 `systemctl start mysql`

### Q2: 跑测试报 "Access denied for user 'root'"
**原因**: .env 里的 DB_PASSWORD 不对  
**解决**: 检查 `backend/.env` 的 `DB_PASSWORD=Gv8wS8E366@@.`

### Q3: 测试 hang 在 test.before
**原因**: pool.connect() 等待超时,但 timeout 没配  
**解决**: 看 `backend/src/config/db.js` 加 `connectTimeout: 10000`

### Q4: ALTER TABLE 报 "Unknown column 'is_online' in 'jobs'"
**原因**: jobs 表 schema 跟你预期不一样  
**解决**: 跑 `mysql resume_app -e "DESC jobs"` 看实际字段

### Q5: 小程序跳到 jobpilot 页面报错
**原因**: 后端没启动或 .env 没配好  
**解决**: 检查 app.globalData.apiBase 是否指向 localhost:3003

### Q6: LLM 调用报 401
**原因**: DEEPSEEK_API_KEY 过期  
**解决**: 更新 .env 的 DEEPSEEK_API_KEY

## 🎯 验收清单

跑完所有步骤,确认:

- [ ] SQL migration 成功
- [ ] Schema 验证通过 (verify_status + story_points + jobpilot_applications 都存在)
- [ ] 114 现有测试全绿
- [ ] 16 个新测试全绿
- [ ] curl /api/match/ 返回 verify_status + score_10 + interview_focus
- [ ] curl /api/match/apply 创建 application
- [ ] curl /api/match/applications 返回投递列表
- [ ] curl /api/match/applications/1 PATCH 更新状态
- [ ] curl /api/resume/generate 返回 story_points
- [ ] curl /api/resume/story-points/1 返回 STAR 模板
- [ ] 小程序 jobpilot 页面 5 个 Tab 都能切
- [ ] Step 3 标记投递按钮工作
- [ ] Step 5 显示投递列表

**全部 ✅ = 推翻重做成功** 🎉

---

## 📞 卡住怎么办

如果跑测试卡死超过 30 秒:
1. 看 `backend/.env` 是不是正确的 dev DB 配置
2. 看 MySQL/Redis 服务在不在跑
3. 看 `backend/scripts/check-env.js` 输出 (启动前 fail-fast 检查)
4. 用 `mysql resume_app -e "SELECT 1"` 单独测 DB 通不通

如果 curl 报 401:
1. 检查 `req.user` 是否被 mock 注入 (route-jobpilot.test.js 已处理)
2. 检查 auth middleware 是否正确读取 token

如果前端跳到 jobpilot 页面是空白:
1. 检查 `app.json` 是否有 `pages/jobpilot/index/index`
2. 检查 `pages/jobpilot/index/index.json` 的路径配置
3. 看微信开发者工具控制台报错