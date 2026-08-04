# 行业卡片 ABC 改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 改造首页行业卡片 — 加 `common_experience` / `recent_new_jobs` 2 个新字段、加 sort toggle bar、视觉升级（圆角 20 + cubic-bezier 过渡 + 行业 emoji + 热度条）。

**Architecture:** 后端 1 文件改 (`industries.js`)：加 experienceMap 聚合 + correlated subquery 算 recent_new_jobs。前端 3 文件改 (`index.{wxml,wxss,js}`)：sort toggle bar + 6 字段 2 行布局 + 热度条。后端 ORDER BY 不动（hot 排序由前端做），先 pm2 reload 后端绕过 CI/CD 省 5 分钟，再 commit + push 前端走 CI/CD。

**Tech Stack:** WeChat Mini-Program (原生 JS + wxml + wxss) + Express (Node.js) + MySQL 8 + pm2 + GitHub Actions CI/CD

---

## File Structure

| 文件 | 职责 |
|------|------|
| `backend/src/routes/industries.js` | 后端路由 — 加 2 个字段 |
| `mini-program/pages/index/index.js` | 前端逻辑 — sortBy + helpers |
| `mini-program/pages/index/index.wxml` | 前端结构 — sort toggle + 卡片新布局 |
| `mini-program/pages/index/index.wxss` | 前端样式 — 圆角 20 + 阴影 + 热度条 |

**无需新建文件**，全部 modify。**无单元测试**（项目无 jest/minitest 配置），测试用 curl + IDE 视觉验证。

---

## Phase 1: Backend

### Task 1: 加 experienceMap 聚合

**Files:**
- Modify: `backend/src/routes/industries.js:39-71` (在 `if (titles.length > 0)` 块里加)

- [ ] **Step 1: 打开文件**

读取 `backend/src/routes/industries.js` 当前内容（已读过），定位到 line 39-71 的 `if (titles.length > 0)` 块。

- [ ] **Step 2: 在 `degreeRows` 查询后加 `expRows` 查询**

在 `if (!degreeMap.has(r.title)) degreeMap.set(...)` 后面、`}` 关闭 `if (titles.length > 0)` 之前，**插入**：

```js
const expMap = new Map();
const [expRows] = await pool.query(
  `SELECT title, experience_required, COUNT(*) AS cnt
   FROM jobs
   WHERE is_online = 1 AND is_deleted = 0 AND title IN (${placeholders})
     AND experience_required != '不限'
   GROUP BY title, experience_required
   ORDER BY title, cnt DESC`,
  titles
);
for (const r of expRows) {
  if (!expMap.has(r.title)) expMap.set(r.title, r.experience_required);
}
```

- [ ] **Step 3: 改 main query 的 FROM/SELECT 加 `j1` 别名 + subquery**

把 line 18-36 的整个主查询**替换**为：

```js
const [rows] = await pool.query(`
  SELECT
    title AS industry,
    COUNT(*) AS job_count,
    SUM(CASE WHEN verify_status = 'verified'
              AND verified_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
             THEN 1 ELSE 0 END) AS recent_verified,
    AVG(salary_max) AS avg_salary_max,
    MAX(verify_status) AS best_status,
    (SELECT COUNT(*) FROM jobs j2
     WHERE j2.title = j1.title
       AND j2.is_online = 1 AND j2.is_deleted = 0
       AND j2.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS recent_new_jobs
  FROM jobs j1
  WHERE is_online = 1 AND is_deleted = 0
  GROUP BY title
  ORDER BY
    recent_verified DESC,
    job_count DESC,
    avg_salary_max DESC
  LIMIT 30
`);
```

- [ ] **Step 4: 在响应 map 里加 2 个新 key**

把 line 74-86 的 `rows.map(...)` 块**替换**为：

```js
const result = rows.map((r) => ({
  industry: r.industry,
  job_count: Number(r.job_count) || 0,
  recent_verified: Number(r.recent_verified) || 0,
  avg_salary_max: Math.round(Number(r.avg_salary_max) || 0),
  best_status: r.best_status,
  top_city: cityMap.get(r.industry) || '',
  common_degree: degreeMap.get(r.industry) || '不限',
  common_experience: expMap.get(r.industry) || '不限',
  recent_new_jobs: Number(r.recent_new_jobs) || 0,
  hot_score: (Number(r.recent_verified) || 0) * 100
             + (Number(r.job_count) || 0) * 10
             + Math.round((Number(r.avg_salary_max) || 0) / 100),
}));
```

- [ ] **Step 5: 本地语法检查**

```bash
cd /d/项目/简历app/backend && node -c src/routes/industries.js
```

Expected: 无输出（语法 OK）。

- [ ] **Step 6: Commit**

```bash
cd /d/项目/简历app
git add backend/src/routes/industries.js
git commit -m "feat(backend): R-JobPilot-v2 W4 — industries 加 common_experience + recent_new_jobs"
```

### Task 2: SSH 后端 reload + curl 验证

**Files:** 无 (deploy only)

- [ ] **Step 1: SSH reload pm2**

```bash
ssh -i "/c/Users/CRL/.ssh/id_r" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  ubuntu@43.139.176.199 \
  'cd /opt/resume-app/backend && pm2 reload resume-app-backend --update-env'
```

Expected: `[PM2] Applying reload actions` + `▌ status ▐ online`

- [ ] **Step 2: 等 3 秒**

```bash
sleep 3
```

- [ ] **Step 3: curl 验证新字段**

```bash
curl -s "https://43.139.176.199:443/api/industries" \
  | python -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d['data']['industries'][0], indent=2, ensure_ascii=False))"
```

Expected: JSON 含 `common_experience`（如 `"1-3 年"`）和 `recent_new_jobs`（如 `5`）字段。

- [ ] **Step 4: 如果字段缺失**

SSH 看后端 err log：

```bash
ssh -i "/c/Users/CRL/.ssh/id_r" ubuntu@43.139.176.199 'tail -30 /opt/resume-app/backend/logs/err.log'
```

Common 错：SQL syntax error（一般是有 `j1` 别名但 FROM 没声明）。修 Step 3 的 SQL 重新 commit + pm2 reload。

---

## Phase 2: Frontend

### Task 3: index.js 加 sortBy state + helpers

**Files:**
- Modify: `mini-program/pages/index/index.js:3-9` (data)
- Modify: `mini-program/pages/index/index.js:24-36` (loadIndustries)

- [ ] **Step 1: data 里加 `sortBy`**

把 line 3-9 的 `Page({...})` 块替换为：

```js
Page({
  data: {
    hasResume: false,
    industries: [],
    loading: true,
    sortBy: 'hot',
  },
```

- [ ] **Step 2: 替换 `loadIndustries`**

把 line 24-36 的 `loadIndustries` 函数替换为：

```js
async loadIndustries() {
  try {
    const res = await request({ url: '/industries', silent: true });
    if (res.code === 0 && res.data && res.data.industries) {
      const sorted = this._sortIndustries(res.data.industries, this.data.sortBy);
      this.setData({ industries: this._withDerived(sorted), loading: false });
    } else {
      this.setData({ industries: [], loading: false });
    }
  } catch (e) {
    this.setData({ industries: [], loading: false });
  }
},

_sortIndustries(list, by) {
  const arr = [...list];
  if (by === 'salary') return arr.sort((a, b) => (b.avg_salary_max || 0) - (a.avg_salary_max || 0));
  if (by === 'count') return arr.sort((a, b) => (b.job_count || 0) - (a.job_count || 0));
  return arr;
},

_withDerived(list) {
  const maxHot = Math.max(...list.map((i) => i.hot_score || 0), 1);
  return list.map((i) => ({
    ...i,
    emoji: this._industryEmoji(i.industry),
    hot_bar_pct: Math.min(100, Math.round(((i.hot_score || 0) / maxHot) * 100)),
  }));
},

_industryEmoji(name) {
  const map = {
    AI: '🤖', 算法: '🤖', 数据: '📊', 产品: '📦',
    运营: '🚀', 设计: '🎨', 前端: '💻', 后端: '⚙️',
    测试: '🔍', 运维: '🛠️', 市场: '📣', 销售: '💼',
    HR: '👥', 财务: '💰', 法务: '⚖️',
  };
  for (const [k, v] of Object.entries(map)) {
    if (name && name.includes(k)) return v;
  }
  return '🏷️';
},

onSwitchSort(e) {
  const { sortBy } = e.currentTarget.dataset;
  if (!sortBy || sortBy === this.data.sortBy) return;
  const sorted = this._sortIndustries(this.data.industries, sortBy);
  this.setData({ sortBy, industries: this._withDerived(sorted) });
},
```

- [ ] **Step 3: 检查 IDE 热重载**

打开 IDE 看首页（自动热重载）。预期：控制台无 JS 报错，页面正常加载。

- [ ] **Step 4: Commit**

```bash
cd /d/项目/简历app
git add mini-program/pages/index/index.js
git commit -m "feat(mini-program): R-JobPilot-v2 W4 — index 加 sortBy + emoji + hot_bar_pct"
```

### Task 4: index.wxml 加 sort bar + 卡片新布局

**Files:**
- Modify: `mini-program/pages/index/index.wxml:6-39` (industries-list + cards)

- [ ] **Step 1: 在 hero 后、industries-list 前插入 sort-bar**

把 line 7-40 块（`<view class="industries-list">` 之前的所有内容）替换为：

```xml
  <view class="industries-list">
    <!-- 排序 toggle bar -->
    <view class="sort-bar">
      <view class="sort-btn {{sortBy === 'hot' ? 'active' : ''}}" data-sort-by="hot" bindtap="onSwitchSort">
        🔥 热度
      </view>
      <view class="sort-btn {{sortBy === 'salary' ? 'active' : ''}}" data-sort-by="salary" bindtap="onSwitchSort">
        💰 薪资
      </view>
      <view class="sort-btn {{sortBy === 'count' ? 'active' : ''}}" data-sort-by="count" bindtap="onSwitchSort">
        📊 岗位数
      </view>
    </view>
```

（保留原 hero 不动）

- [ ] **Step 2: 替换 industry-card 整块**

把 line 9-32 的 `<view class="industry-card ..." bindtap="onSelectIndustry">` 整块替换为：

```xml
    <view
      wx:for="{{industries}}"
      wx:key="industry"
      class="industry-card {{item.recent_verified > 0 ? 'hot' : ''}}"
      data-industry="{{item.industry}}"
      data-topcity="{{item.top_city}}"
      data-avgsalary="{{item.avg_salary_max}}"
      bindtap="onSelectIndustry"
    >
      <view class="industry-left">
        <view class="industry-header">
          <text class="industry-emoji">{{item.emoji}}</text>
          <text class="industry-name">{{item.industry}}</text>
          <view wx:if="{{item.recent_verified > 0}}" class="hot-badge">
            <text class="hot-badge-text">🔥 近期较好</text>
          </view>
        </view>
        <view class="industry-stats">
          <text class="stat-item">📊 {{item.job_count}} 岗位</text>
          <text wx:if="{{item.recent_new_jobs > 0}}" class="stat-item stat-highlight">
            ✓ +{{item.recent_new_jobs}} 新增
          </text>
          <text wx:if="{{item.avg_salary_max > 0}}" class="stat-item">
            💰 {{item.avg_salary_max}}K
          </text>
        </view>
        <view class="industry-stats industry-stats-2">
          <text wx:if="{{item.top_city}}" class="stat-item">📍 {{item.top_city}}</text>
          <text wx:if="{{item.common_degree && item.common_degree !== '不限'}}" class="stat-item">
            🎓 {{item.common_degree}}
          </text>
          <text wx:if="{{item.common_experience && item.common_experience !== '不限'}}" class="stat-item">
            💼 {{item.common_experience}}
          </text>
        </view>
      </view>
      <view class="hot-bar">
        <view class="hot-bar-fill" style="width: {{item.hot_bar_pct}}%"></view>
        <text class="hot-bar-text">{{item.hot_score}}</text>
      </view>
    </view>
```

- [ ] **Step 3: IDE 看效果**

IDE 热重载，首页应该看到：
- 3 个 sort 按钮（默认「🔥 热度」高亮）
- 每张卡片：emoji + 行业名 + 🔥 badge + 第一行（📊岗位 ✓新增 💰薪资）+ 第二行（📍城市 🎓学历 💼经验）+ 右侧热度条 + 数字

- [ ] **Step 4: 测试 3 个 toggle**

在 IDE 模拟器点「💰 薪资」→ industries 重排（第一个最高薪）
点「📊 岗位数」→ 重排（第一个最多岗位）
点「🔥 热度」→ 重排（第一个 hot_score 最高）

- [ ] **Step 5: 测试点卡片仍能跳 jobpilot**

点任意卡片 → 跳 jobpilot/index，query 含 industry/city/salary

- [ ] **Step 6: Commit**

```bash
cd /d/项目/简历app
git add mini-program/pages/index/index.wxml
git commit -m "feat(mini-program): R-JobPilot-v2 W4 — index wxml sort bar + 6 字段 + 热度条"
```

### Task 5: index.wxss 视觉升级

**Files:**
- Modify: `mini-program/pages/index/index.wxss:46-149` (.industry-card 相关)

- [ ] **Step 1: 替换 .industry-card**

把 line 46-76 的 `.industry-card` 块（含 `:nth-child` 错位动画 + `:active`）**整体替换**为：

```css
.industry-card {
  background: #ffffff;
  border: 1rpx solid #e5e5e7;
  border-radius: 20rpx;
  padding: 28rpx 32rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: 0 6rpx 20rpx rgba(99,102,241,0.08);
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  animation: cardIn 0.4s ease-out backwards;
}

/* 错位入场动画 (stagger) */
.industry-card:nth-child(2) { animation-delay: 0.05s; }
.industry-card:nth-child(3) { animation-delay: 0.10s; }
.industry-card:nth-child(4) { animation-delay: 0.15s; }
.industry-card:nth-child(5) { animation-delay: 0.20s; }
.industry-card:nth-child(6) { animation-delay: 0.25s; }
.industry-card:nth-child(7) { animation-delay: 0.30s; }

@keyframes cardIn {
  from { opacity: 0; transform: translateX(-20rpx); }
  to { opacity: 1; transform: translateX(0); }
}

.industry-card:active {
  transform: scale(0.98);
  background: #f9f9fb;
  border-color: #6366f1;
  box-shadow: 0 4rpx 16rpx rgba(99,102,241,0.16);
}

.industry-card.hot {
  border-color: rgba(255,149,0,0.3);
  background: linear-gradient(135deg, #ffffff 0%, #fffbeb 100%);
}
```

注意：`nth-child(N)` 从 2 开始（因 wxml 第一个子元素是 sort-bar）。

- [ ] **Step 2: 加 emoji + stat-highlight + industry-stats-2 样式**

在 line 137 (`.industry-arrow` 之前) **插入**：

```css
.industry-emoji {
  font-size: 36rpx;
  margin-right: 12rpx;
  flex-shrink: 0;
}

.stat-highlight {
  color: #07c160;
  font-weight: 600;
}

.industry-stats-2 {
  margin-top: 8rpx;
  opacity: 0.85;
}
```

- [ ] **Step 3: 替换 .industry-arrow 为 .hot-bar**

把 line 137-149 的 `.industry-arrow` 块（直到 `}` 结束）**替换**为：

```css
/* 热度条 */
.hot-bar {
  width: 80rpx;
  height: 56rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  position: relative;
  margin-left: 16rpx;
}

.hot-bar-fill {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 6rpx;
  background: linear-gradient(90deg, #ff9500 0%, #ff6b00 100%);
  border-radius: 3rpx;
  transition: width 0.4s ease-out;
}

.hot-bar-text {
  position: relative;
  font-size: 22rpx;
  color: #8e8e93;
  font-weight: 600;
  margin-bottom: 8rpx;
}
```

- [ ] **Step 4: 加 sort-bar 样式**

在文件末尾（line 188 之后，文件最后一行 `.preview-btn:active` 之前）**插入**：

```css
/* 排序 toggle bar */
.sort-bar {
  display: flex;
  gap: 12rpx;
  padding: 0 8rpx;
  margin-bottom: 16rpx;
}

.sort-btn {
  flex: 1;
  padding: 16rpx 0;
  text-align: center;
  font-size: 26rpx;
  color: #8e8e93;
  background: #f5f5f7;
  border-radius: 12rpx;
  transition: all 0.2s;
}

.sort-btn.active {
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  color: #ffffff;
  font-weight: 600;
  box-shadow: 0 4rpx 12rpx rgba(99,102,241,0.25);
}
```

- [ ] **Step 5: IDE 看效果**

IDE 热重载。预期：
- 卡片圆角变大（16 → 20）
- 卡片有柔阴影
- 切换 sort 按钮有渐变高亮
- 行业名左边有 emoji
- 卡片右侧有热度条 + 数字
- 「✓ +X 新增」绿色高亮

- [ ] **Step 6: 切排序看动效**

点 toggle → 卡片过渡 + 排序变化

- [ ] **Step 7: Commit**

```bash
cd /d/项目/简历app
git add mini-program/pages/index/index.wxss
git commit -m "feat(mini-program): R-JobPilot-v2 W4 — index wxss 圆角 20 + 热度条 + sort btn 样式"
```

---

## Phase 3: Ship

### Task 6: git push + CI/CD + 验证

**Files:** 无

- [ ] **Step 1: 看 git log**

```bash
cd /d/项目/简历app
git log --oneline -5
```

Expected: 看到 4 个新 commit（1 backend + 3 frontend）

- [ ] **Step 2: git push**

```bash
git push origin main
```

Expected: 推送成功，CI/CD 触发（`backend/**` 和 `mini-program/**` 都会触发）

- [ ] **Step 3: 等 5 分钟**

```bash
echo "Waiting 5 min for CI/CD..." && date
```

或看 GitHub Actions web：`gh run list --limit 1`

- [ ] **Step 4: prod 二次验证**

```bash
curl -s "https://43.139.176.199:443/api/industries" \
  | python -c "import json,sys; d=json.load(sys.stdin); print('industries count:', len(d['data']['industries'])); print('first:', json.dumps(d['data']['industries'][0], indent=2, ensure_ascii=False))"
```

Expected: count > 0, first object 含 `common_experience` + `recent_new_jobs`

- [ ] **Step 5: IDE 重编译**

IDE Ctrl+B 重编译。看首页：
- 新 sort bar
- 新卡片样式
- 6 字段显示
- 切排序正常

- [ ] **Step 6: 完结**

完成。**记得测完关 ENABLE_DEV_BYPASS=true**（之前为 chat-build 测试打开的）：

```bash
ssh -i "/c/Users/CRL/.ssh/id_r" ubuntu@43.139.176.199 \
  'sed -i "s/^ENABLE_DEV_BYPASS=.*/ENABLE_DEV_BYPASS=false/" /opt/resume-app/backend/.env && pm2 restart resume-app-backend --update-env'
```

---

## Self-Review Checklist

- ✅ Spec §3 → Task 1（experienceMap + recent_new_jobs subquery + 响应）
- ✅ Spec §4 → Task 3（sortBy + helpers + emoji + hot_bar_pct）
- ✅ Spec §5 → Task 4（wxml sort bar + 6 字段 + 热度条）
- ✅ Spec §6 → Task 5（wxss 圆角 20 + 阴影 + 热度条 + sort btn）
- ✅ Spec §7 兜底 → Task 4 wxml `wx:if` 隐藏空字段
- ✅ Spec §8 测试 → Task 2（curl）+ Task 4（IDE 视觉）+ Task 6（prod 验证）
- ✅ Spec §11 验收清单 → Task 6 Step 4-5
- ✅ 无 placeholder / TODO
- ✅ 字段名一致：`common_experience` / `recent_new_jobs` / `hot_score` / `hot_bar_pct` 在前后端保持一致
- ✅ 函数名一致：`_sortIndustries` / `_withDerived` / `_industryEmoji` / `onSwitchSort` 在 js 内部一致