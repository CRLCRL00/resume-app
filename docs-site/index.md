---
layout: home

hero:
  name: 简历推荐小程序
  text: 后端 / 小程序 / 运维文档
  tagline: 用户填资料 → LLM 生成简历 → 语义匹配人工岗位库 → 推荐公司+岗位
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/quickstart
    - theme: alt
      text: 架构总览
      link: /guide/architecture
    - theme: alt
      text: 运维手册
      link: /operations/
    - theme: alt
      text: 更新日志
      link: /changelog/

features:
  - title: 微信小程序
    details: 5+3 pages，WeChat code2session + JWT，DeepSeek LLM 驱动简历生成与岗位匹配
  - title: Express 后端
    details: Node 22 + MySQL 8 + Redis 7，R31-R36 已接入 metrics + alerts + audit + 2FA + chaos
  - title: GitHub Actions
    details: 后端 CI / 部署 / 体验版上传 / Perf 门禁 / 文档站点全自动
---

## 这是什么

本站点聚合了 ResumeApp 项目的全部运维 / 后端 / 前端文档，方便：

- **新加入开发者** 从 [快速开始](/guide/quickstart) 入手
- **值班 ops** 直接进 [运维](/operations/) 查告警 / 慢查询 / 审计 / 2FA / 混沌
- **审核员 / 微信后台** 在 [参考](/reference/openapi) 看 OpenAPI 与环境变量

源码仓库：[github.com/CRLCRL00/resume-app](https://github.com/CRLCRL00/resume-app)
