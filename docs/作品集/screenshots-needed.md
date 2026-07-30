# 截图清单 (5-13 张关键页面)

> 按优先级排序,按这个清单录/截图,放在 `docs/screenshots/` 目录。

## 📋 截图清单

| # | 文件名 | 页面 | 截图内容 | 优先级 |
|---|--------|------|----------|--------|
| 1 | `01-input-form.png` | 用户填资料 | 完整字段填写 (学校/工作/项目/技能) | ⭐⭐⭐⭐⭐ |
| 2 | `02-generating.png` | LLM 生成中 | loading + DeepSeek API 调用过程 | ⭐⭐⭐⭐⭐ |
| 3 | `03-resume-result.png` | 生成结果 | 完整生成的简历 (渲染版) | ⭐⭐⭐⭐⭐ |
| 4 | `04-match-recommend.png` | 岗位匹配 | Top 5 推荐岗位 (匹配度排序) | ⭐⭐⭐⭐⭐ |
| 5 | `05-ai-wizard.png` | Wizard 模式 | R115 AI 像面试官主动提问 | ⭐⭐⭐⭐ |
| 6 | `06-tinder-card.png` | Tinder 划卡 | R117 划卡 modal + AI 推断 | ⭐⭐⭐ |
| 7 | `07-admin-dashboard.png` | 管理员后台 | dashboard.html (数据看板) | ⭐⭐⭐⭐ |
| 8 | `08-github-actions.png` | CI 全绿 | 4 个 workflow 跑过 + 114 单测全绿 | ⭐⭐⭐⭐ |

## 🆕 R-JobSearch 重构后的 5 步流 (新增 5 张,优先级 ⭐⭐⭐⭐⭐)

| # | 文件名 | 页面 | 截图内容 | 优先级 |
|---|--------|------|----------|--------|
| 9 | `09-jobpilot-home.png` | 找岗位入口 | 首页 → 点 "🚀 找岗位 (AI 智能匹配)" | ⭐⭐⭐⭐ |
| 10 | `10-jobpilot-step1.png` | Step 1 画像诊断 | 5 题填好 + AI 输出 image + 推荐 chips | ⭐⭐⭐⭐⭐ |
| 11 | `11-jobpilot-step2.png` | Step 2 项目提取 | 项目表单 + AI 评分 7.x + 5 项 breakdown + 改进建议 + STAR 预览 | ⭐⭐⭐⭐⭐ |
| 12 | `12-jobpilot-step3.png` | Step 3 岗位匹配 | 匹配结果列表 — verify_status 三态 + 1-10 分 + 📮 标记已投按钮 | ⭐⭐⭐⭐⭐ |
| 13 | `13-jobpilot-step4.png` | Step 4 简历生成 | 3-5 个 STAR 卡片完整展开 + 简历文本预览 | ⭐⭐⭐⭐ |
| 14 | `14-jobpilot-step5.png` | Step 5 投递追踪 | applications 列表 + 状态按钮 (HR 已看 / 面试 / 发 offer / 拒绝) | ⭐⭐⭐⭐ |

## 📐 截图规格

| 维度 | 规格 |
|------|------|
| 分辨率 | 1920×1080 (桌面) 或 1080×1920 (手机) |
| 格式 | PNG (清晰) |
| 大小 | < 2MB 每张 |
| 命名 | `0X-页面名.png` (0X 编号保持顺序) |

## 🎬 截图工具

### 桌面
- **Mac**: Cmd+Shift+4 (选区) / Cmd+Shift+3 (全屏)
- **Windows**: Win+Shift+S (选区) / PrtSc (全屏)
- **微信开发者工具**: 自带截图 (工具 → 截屏)

### 手机 (小程序截图)
- **iPhone**: 电源 + 音量上
- **Android**: 电源 + 音量下
- **模拟器**: 微信开发者工具 → 模拟器截图按钮

## 📝 截图脚本 (每个页面怎么截)

### 1. `01-input-form.png` — 用户填资料
- 准备: 用 fake 数据预先填到一半 (让 HR 看到填写过程)
- 操作: 截图填到一半的页面
- 重点: 字段完整 + Wizard 主动提问的弹窗

### 2. `02-generating.png` — LLM 生成中
- 准备: 点"生成"按钮,loading 状态
- 操作: 截图 loading 页面 (3-5 秒窗口)
- 重点: 显示 "正在调用 DeepSeek..." 文字

### 3. `03-resume-result.png` — 生成结果
- 准备: 生成完成,显示完整简历
- 操作: 截完整结果页 (滚动到中部)
- 重点: 完整结构化输出 (教育/工作/项目/技能)

### 4. `04-match-recommend.png` — 岗位匹配
- 准备: 推荐 Top 5 岗位
- 操作: 截匹配结果页
- 重点: 匹配度分数 + 岗位描述

### 5. `05-ai-wizard.png` — Wizard 模式
- 准备: R115 Wizard 弹窗打开
- 操作: 截 AI 提问弹窗
- 重点: 进度条 + AI 问题

### 6. `06-tinder-card.png` — Tinder 划卡
- 准备: R117 划卡 modal 打开
- 操作: 截 modal
- 重点: 划卡 UI + AI 推荐 3 个

### 7. `07-admin-dashboard.png` — 管理员后台
- 准备: 登录管理员后台
- 操作: 截 dashboard.html
- 重点: 数据看板 + 图表

### 8. `08-github-actions.png` — CI 全绿
- 准备: GitHub Actions 历史全绿
- 操作: 截 GitHub Actions 页面
- 重点: 4 个 workflow + 114/114 单测

### 9. `09-jobpilot-home.png` — 首页 → 找岗位入口
- 准备: 首页有 hasResume=true,显示"🚀 找岗位 (AI 智能匹配)"按钮
- 操作: 截首页
- 重点: 找岗位按钮是第二主按钮 (开始填写之上)

### 10. `10-jobpilot-step1.png` — Step 1 画像诊断
- 准备: 填好 5 个问题 (教育/AI 能力/项目/求职目标/时间窗口) → 点 "AI 诊断 →"
- 操作: 截 AI 输出结果区 + 「下一步 →」按钮
- 重点: image 文字 + confidence 数字 + 3 个推荐岗位 chip + 优势/避免 bullets
- AI 响应时间: 3-8 秒 (DeepSeek)

### 11. `11-jobpilot-step2.png` — Step 2 项目提取 ⭐ 必拍细节
- 准备: 填项目表单 (项目名/技术栈/AI 协作/我的角色/URL) → 点 "AI 评估 →"
- 操作: 截完整结果区
- 重点 6 项:
  - 总分 7.x / 10
  - 5 项 breakdown (完成度 / AI 相关度 / 生产级 / 可展示 / 讲故事)
  - 改进建议 bullets
  - STAR 故事点预览 (situation + action)
  - 适合投岗位 chips
  - 薪资影响 (绿色高亮) — "+2000-3000 元/月"
- AI 响应时间: 8-15 秒 (含 STAR 生成)

### 12. `12-jobpilot-step2.png` — Step 3 岗位匹配 ⭐ 必拍细节
- 准备: 自动加载 resume_id (不用手动填) → 点"开始匹配"
- 操作: 截匹配结果列表
- 重点 4 项:
  - 简历 ID 自动显示 + 进度条 (3/5)
  - 匹配岗位有 3-5 个
  - 每个岗位有:
    - 1-10 分彩色徽章
    - verify_status 三态徽章 (绿 ✓ / 黄 ⚠ / 灰 ○)
    - 薪资范围 (K)
    - 评分原因文案
  - "📮 标记已投" 按钮 (操作点过 → 跳到 Step 5 自动看)

### 13. `13-jobpilot-step4.png` — Step 4 简历生成 ⭐ 必拍细节
- 准备: 自动加载 resume_id → 点"AI 生成"
- 操作: 截完整结果区
- 重点 2 项:
  - "模式: 结构化 (含 STAR)" 标题
  - 3-5 个 STAR 卡片,每张卡都有 4 段:
    - 📌 背景 (situation)
    - 🎯 任务 (task)
    - ⚡ 行动 (action)
    - 📈 结果 (result)
  - 底部简历内容预览框 (滚动可见)
- AI 响应时间: 5-10 秒

### 14. `14-jobpilot-step5.png` — Step 5 投递追踪
- 准备: 在 Step 3 标记过 2-3 个岗位 → 自动到 Step 5
- 操作: 截 applications 列表 + 状态按钮组
- 重点:
  - 投递列表 (标题 + 公司 + 城市 + 薪资)
  - status 彩色徽章 (submitted / viewed / interview_scheduled / offered / rejected)
  - ⚠ 该跟进了 (橙色)
  - 4 个状态按钮 (HR 已看 / 面试 / 发 offer / 拒绝)
  - 底部"已完成 (5/5) ✓" 进度条

## ⚠️ 截图前 Checklist

- [ ] 用 fake 数据,不暴露真实用户
- [ ] 隐藏敏感信息 (API key / 真实姓名 / 真实邮箱)
- [ ] 截图前关闭通知 (避免敏感信息)
- [ ] 截图前清空地址栏 / 开发工具
- [ ] 截图后检查没有敏感信息

## 🚀 截图后 Checklist

- [ ] 8 张图都齐了
- [ ] 文件名按 `0X-xxx.png` 格式
- [ ] 都放在 `docs/screenshots/` 目录
- [ ] README 已引用 (`screenshots/01-input-form.png` 等)
- [ ] Notion 作品集已上传
- [ ] 简历 v3 提到 "8 张截图见作品集"

## 📦 在 README 引用方式

```markdown
## 📸 截图

### 用户填资料
![用户填资料](docs/screenshots/01-input-form.png)

### LLM 生成简历
![LLM 生成中](docs/screenshots/02-generating.png)
![生成结果](docs/screenshots/03-resume-result.png)

### 岗位匹配
![岗位匹配](docs/screenshots/04-match-recommend.png)
```

## 🔄 维护规则

- **重大功能更新**: 重新截图
- **UI 改动**: 重新截图
- **数据更新**: 截新版数据看板
- **每 3 个月**: review 一次截图,更新过时内容