# 行业卡片 ABC 改造 — 设计 Spec

**日期**: 2026-08-04
**作者**: Claude (with CRL)
**状态**: Approved by user (option A — all 4 sections accepted)
**范围**: 单页改 — `mini-program/pages/index/index` + `backend/src/routes/industries.js`

---

## 1. 目标 (Goal)

改造首页"行业卡片"的 3 个维度：

| 维度 | 现状 | 目标 |
|------|------|------|
| **A 视觉** | 圆角 16 + 静态阴影 + 简单 stagger 入场 | 圆角 20 + 柔阴影 + cubic-bezier 过渡 + 行业 emoji 自动映射 + 热度条 |
| **B 信息密度** | 4 字段（岗位 / verify / 薪资 / 城市） | 6 字段（+ 新增 / 学历 / 经验），2 行布局 |
| **C 排序** | 单排序，按后端 ORDER BY | 用户可切 3 种排序（热度 / 薪资 / 岗位数） |

---

## 2. 范围 (Scope)

### 改动文件

| 文件 | 改动 |
|------|------|
| `backend/src/routes/industries.js` | 加 `experienceMap` 聚合 + 加 `recent_new_jobs` 子查询 + 响应里加 2 个新 key |
| `mini-program/pages/index/index.js` | `loadIndustries` 加 sortBy state + sortBy 切换函数 + industries 渲染时按 sortBy 重排 |
| `mini-program/pages/index/index.wxml` | 加 sort toggle bar + 卡片 stat 改 2 行布局 + 右侧热度条 + industry emoji |
| `mini-program/pages/index/index.wxss` | 圆角 20 + 阴影 `0 6rpx 20rpx rgba(99,102,241,0.08)` + cubic-bezier 过渡 + 热度条样式 |

### 不动

- 后端 API URL `/api/industries` 不变
- 响应外层结构 `{code, data: {industries: [...]}}` 不变
- 后端 SQL `ORDER BY` 不变（hot_score 排序由前端做，避免多 ORDER BY 切换）
- 任何路由路径 / 中间件 / auth 流程

### 部署策略

- **后端**：`pm2 reload resume-app-backend --update-env` 直接 SSH（绕过 CI/CD，省 5 分钟）
- **前端**：commit + push → CI/CD 自动部署 → IDE 重编译

---

## 3. 后端改动 — `industries.js`

### 3.1 新增 `experienceMap` 聚合（仿 `degreeMap`）

在现有 `if (titles.length > 0)` 块里加：

```js
const [expRows] = await pool.query(
  `SELECT title, experience_required, COUNT(*) AS cnt
   FROM jobs
   WHERE is_online = 1 AND is_deleted = 0 AND title IN (${placeholders})
     AND experience_required != '不限'
   GROUP BY title, experience_required
   ORDER BY title, cnt DESC`,
  titles
);
const expMap = new Map();
for (const r of expRows) {
  if (!expMap.has(r.title)) expMap.set(r.title, r.experience_required);
}
```

### 3.2 加 `recent_new_jobs`（主查询改子查询）

原主查询 `GROUP BY title` 不能直接 JOIN 自身。**最简实现**：在主查询 SELECT 里加 correlated subquery：

```sql
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
```

**性能影响**：30 行每行 1 个子查询 → 30 次 `COUNT(*)`，因有 `(title, is_online, is_deleted, created_at)` 复合索引（若没有则需补 migration），每次 < 5ms。可接受。

**若性能不达标**：迁移成 2 次 query：先 GROUP BY 拿 title，再 IN (...) 一次性查 created_at 聚合。spec 优先采用 correlated subquery 方案，简单。

### 3.3 响应里加 2 个 key

在 `result` map 里加：

```js
const result = rows.map((r) => ({
  industry: r.industry,
  job_count: Number(r.job_count) || 0,
  recent_verified: Number(r.recent_verified) || 0,
  avg_salary_max: Math.round(Number(r.avg_salary_max) || 0),
  best_status: r.best_status,
  top_city: cityMap.get(r.industry) || '',
  common_degree: degreeMap.get(r.industry) || '不限',
  common_experience: expMap.get(r.industry) || '不限',  // NEW
  recent_new_jobs: Number(r.recent_new_jobs) || 0,       // NEW
  hot_score: (Number(r.recent_verified) || 0) * 100
             + (Number(r.job_count) || 0) * 10
             + Math.round((Number(r.avg_salary_max) || 0) / 100),
}));
```

### 3.4 ORDER BY 不动

当前 `ORDER BY recent_verified DESC, job_count DESC, avg_salary_max DESC` **已等价**于 `hot_score DESC`（hot_score = recent_verified×100 + job_count×10 + avg_salary_max/100，三者权重顺序一致）。所以**前端直接用 backend 返回顺序就是 hot 排序**，无需切换 SQL ORDER BY。

---

## 4. 前端改动 — `index.js`

### 4.1 加 `sortBy` state

```js
data: {
  hasResume: false,
  industries: [],
  loading: true,
  sortBy: 'hot',  // 'hot' | 'salary' | 'count'
},
```

### 4.2 `loadIndustries` 加排序逻辑

```js
async loadIndustries() {
  try {
    const res = await request({ url: '/industries', silent: true });
    if (res.code === 0 && res.data && res.data.industries) {
      let industries = res.data.industries;
      // backend 默认按 hot_score 等价序返回；按用户选择重排
      industries = this._sortIndustries(industries, this.data.sortBy);
      this.setData({ industries, loading: false });
    } else {
      this.setData({ industries: [], loading: false });
    }
  } catch (e) {
    this.setData({ industries: [], loading: false });
  }
},

_sortIndustries(list, by) {
  const arr = [...list];
  if (by === 'salary') return arr.sort((a, b) => b.avg_salary_max - a.avg_salary_max);
  if (by === 'count') return arr.sort((a, b) => b.job_count - a.job_count);
  // 'hot' — backend 默认序，不变
  return arr;
},

onSwitchSort(e) {
  const { sortBy } = e.currentTarget.dataset;
  if (sortBy === this.data.sortBy) return;
  const sorted = this._sortIndustries(this.data.industries, sortBy);
  this.setData({ sortBy, industries: sorted });
},
```

### 4.3 industry emoji 自动映射

```js
_industryEmoji(name) {
  const map = {
    'AI': '🤖', '算法': '🤖', '数据': '📊', '产品': '📦',
    '运营': '🚀', '设计': '🎨', '前端': '💻', '后端': '⚙️',
    '测试': '🔍', '运维': '🛠️', '市场': '📣', '销售': '💼',
    'HR': '👥', '财务': '💰', '法务': '⚖️',
  };
  for (const [k, v] of Object.entries(map)) {
    if (name.includes(k)) return v;
  }
  return '🏷️';  // 默认
},
```

在 `data` 里加 `industryEmojis: []` 数组，跟 `industries` 一一对应。或在 wxml 里用 `wx:for-item` 直接调 `_industryEmoji`。

**实现选择**：wxml 里用 `<text>{{_industryEmoji(item.industry)}}</text>` — wxml 不支持函数调用，所以**预计算到 data 数组**：

```js
// loadIndustries 末尾：
const maxHot = Math.max(...sorted.map((i) => i.hot_score || 0), 1);
const industries = sorted.map((i) => ({
  ...i,
  emoji: this._industryEmoji(i.industry),
  hot_bar_pct: Math.min(100, Math.round(((i.hot_score || 0) / maxHot) * 100)),
}));
```

---

## 5. 前端改动 — `index.wxml`

### 5.1 hero 加 sort toggle bar

```xml
<view class="hero-card">...</view>

<!-- 排序 toggle bar (新增) -->
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

<view class="industries-list">...</view>
```

### 5.2 卡片 stat 改 2 行布局

```xml
<view class="industry-card {{item.recent_verified > 0 ? 'hot' : ''}}"
      data-industry="{{item.industry}}"
      data-topcity="{{item.top_city}}"
      data-avgsalary="{{item.avg_salary_max}}"
      bindtap="onSelectIndustry">

  <view class="industry-left">
    <view class="industry-header">
      <text class="industry-emoji">{{item.emoji}}</text>
      <text class="industry-name">{{item.industry}}</text>
      <view wx:if="{{item.recent_verified > 0}}" class="hot-badge">
        <text class="hot-badge-text">🔥 近期较好</text>
      </view>
    </view>

    <!-- 第一行：岗位数 / 新增 / 薪资 -->
    <view class="industry-stats">
      <text class="stat-item">📊 {{item.job_count}} 岗位</text>
      <text wx:if="{{item.recent_new_jobs > 0}}" class="stat-item stat-highlight">
        ✓ +{{item.recent_new_jobs}} 新增
      </text>
      <text wx:if="{{item.avg_salary_max > 0}}" class="stat-item">
        💰 {{item.avg_salary_max}}K
      </text>
    </view>

    <!-- 第二行：城市 / 学历 / 经验 (新增) -->
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

  <!-- 右侧热度条 (替换原箭头) -->
  <view class="hot-bar">
    <view class="hot-bar-fill" style="width: {{item.hot_bar_pct}}%"></view>
    <text class="hot-bar-text">{{item.hot_score}}</text>
  </view>
</view>
```

---

## 6. 前端改动 — `index.wxss`

### 6.1 卡片样式升级

```css
.industry-card {
  background: #ffffff;
  border: 1rpx solid #e5e5e7;
  border-radius: 20rpx;  /* 16 → 20 */
  padding: 28rpx 32rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);  /* 新 */
  box-shadow: 0 6rpx 20rpx rgba(99,102,241,0.08);  /* 新 */
  animation: cardIn 0.4s ease-out backwards;
}

.industry-card:active {
  transform: scale(0.98);
  background: #f9f9fb;
  border-color: #6366f1;
  box-shadow: 0 4rpx 16rpx rgba(99,102,241,0.16);  /* 加深 */
}
```

### 6.2 emoji + stat 高亮

```css
.industry-emoji {
  font-size: 36rpx;
  margin-right: 12rpx;
}

.stat-highlight {
  color: #07c160;  /* 绿色，新增高亮 */
  font-weight: 600;
}

.industry-stats-2 {
  margin-top: 8rpx;
  opacity: 0.85;  /* 第二行稍弱化 */
}
```

### 6.3 热度条

```css
.hot-bar {
  width: 80rpx;
  height: 56rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
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

### 6.4 sort toggle bar

```css
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

---

## 7. 兜底 / 边界

| 字段 | 为空时的行为 |
|------|-------------|
| `common_experience` | 隐藏整行 `💼 X` |
| `common_degree === '不限'` | 隐藏整行 `🎓 X` |
| `recent_new_jobs === 0` | 隐藏整行 `✓ +X 新增` |
| `top_city` 为空 | 隐藏 `📍 X` |
| `avg_salary_max === 0` | 隐藏 `💰 X` |
| `hot_score === 0` | 热度条 width=0，文字仍显示 "0" |
| industries 全空 | 已有 `.empty` 文案显示 |

---

## 8. 测试 / 验证

| # | 步骤 | 期望 |
|---|------|------|
| 1 | SSH 后端 → `pm2 reload resume-app-backend --update-env` | 进程 online，无错 |
| 2 | `curl https://43.139.176.199:443/api/industries \| jq '.data.industries[0]'` | 含 `common_experience` + `recent_new_jobs` 字段 |
| 3 | IDE Ctrl+B 重编译 → 看首页 | 卡片新样式、6 字段、热度条、3 toggle |
| 4 | 点 toggle「💰 薪资」| industries 重排，第一个最高薪 |
| 5 | 点 toggle「📊 岗位数」| 重排，第一个最多岗位 |
| 6 | 点 toggle「🔥 热度」| 重排，第一个 hot_score 最高 |
| 7 | 点卡片 | 仍跳 jobpilot（行为不变） |
| 8 | 检查 console | 无 JS error |

---

## 9. 风险 / 已知限制

| 风险 | 缓解 |
|------|------|
| 后端 correlated subquery 性能 | 30 行内可接受；如慢可拆 2 次 query |
| emoji 映射不准 | 用户看到 emoji + 名字，emoji 错也无碍；映射规则保守默认 🏷️ |
| hot_score 进度条超过 100% | 用 `min(100, hot_score / 2)` 截断，hot_score 通常 < 200 |
| 切排序触发 setData 整页重渲 | industries 数组只有 30 条，可接受 |

---

## 10. 不在范围 (Out of Scope)

- 卡片 hover 状态（移动端没 hover）
- 卡片预览 popup
- 行业搜索 / 过滤
- 行业收藏 / 订阅
- 排序持久化到 storage（每次 onShow 默认 hot）
- 后端 SQL ORDER BY 切换（前端做）

---

## 11. 验收清单

- [ ] 后端 reload 完成，`curl` 看新字段
- [ ] 前端 IDE 重编译无报错
- [ ] 视觉：圆角 / 阴影 / 过渡 / emoji / 热度条
- [ ] 信息：6 字段全显示 / 部分字段为空时正确隐藏
- [ ] 排序：3 toggle 切换正常
- [ ] 点击卡片仍跳 jobpilot
- [ ] 30 条数据下流畅无卡顿