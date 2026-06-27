# 项目文档索引 — 简历推荐小程序

> 最后更新：2026-06-27

## 标准文档

按开发顺序阅读：

| # | 文档 | 作用 | 何时读 |
|---|------|------|--------|
| 1 | [requirements.md](./requirements.md) | **需求**：产品定位、功能范围、验收标准、风险 | 项目启动 / 需求变更时 |
| 2 | [tech.md](./tech.md) | **技术**：技术栈、目录结构、依赖、配置、安全基线 | 开始编码前 |
| 3 | [design.md](./design.md) | **设计规范**：信息架构、视觉、交互、页面规范 | 写前端前 |
| 4 | [execution.md](./execution.md) | **执行步骤**：7 个阶段的具体任务 + 验收标准 | 每阶段开始时 |
| 5 | [superpowers/specs/2026-06-27-简历推荐小程序-design.md](./superpowers/specs/2026-06-27-简历推荐小程序-design.md) | 完整设计文档（架构 / 数据模型 / 匹配流程 / 成本 / 分阶段） | 整体方案 review 时 |

## 开发日志

`devlog/` 文件夹：每日记录完成事项、待办事项、踩坑笔记。

- [devlog/README.md](../devlog/README.md) — 日志使用说明
- [devlog/template.md](../devlog/template.md) — 日志模板
- [devlog/2026-06-27.md](../devlog/2026-06-27.md) — 当日日志

## 工作流

```
每日开工
  ↓
打开 devlog/YYYY-MM-DD.md（不存在则 cp template.md 创建）
  ↓
按 execution.md 当阶段任务清单工作
  ↓
完成 / 卡住时更新日志
  ↓
每阶段结束：commit 代码 + 更新对应文档 + 评审
  ↓
进入下一阶段
```

## 关键决策速查

| 决策点 | 选择 | 详见 |
|--------|------|------|
| 平台 | 微信小程序 | requirements §1 / design §1 |
| 岗位数据 | 人工维护（管理端录入） | requirements §3 / execution §4 |
| 简历生成 | LLM（DeepSeek） | design §3 / tech §5 |
| 匹配算法 | SQL 粗筛 + LLM 精排 + 缓存 | design §2 |
| 后端 | 腾讯云轻量 + Node + MySQL + Redis | tech §1 |
| 反向代理 | Nginx + Let's Encrypt | tech §4 |
| 鉴权 | 微信 code2session + token + 管理员白名单 | design §1 |
| 部署 | PM2 + crontab 备份 + COS | tech §4 / execution §6 |

## 待办总览（来自 execution.md）

| 阶段 | 名称 | 状态 | 工作日 |
|------|------|------|--------|
| 0 | 基建（拆 3 子任务） | 未开始 | 3 |
| 1 | 后端骨架 | 未开始 | 5 |
| 1.5 | 缓冲 / 验收 | 未开始 | 1 |
| 2 | 小程序骨架 | 未开始 | 4 |
| 3 | 简历生成 | 未开始 | 4 |
| 4 | 岗位管理端 | 未开始 | 4 |
| 5 | 匹配核心 | 未开始 | 6 |
| 5.5 | 缓冲 / 验收 | 未开始 | 1 |
| 6 | 上线打磨 | 未开始 | 3 |
| 7 | 缓冲 | 未开始 | 1 |
| 8 | 微信审核 | 未开始 | 1-3 |