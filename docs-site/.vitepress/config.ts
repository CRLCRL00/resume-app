import { defineConfig } from 'vitepress'

export default defineConfig({
  title: '简历推荐小程序 Docs',
  description: 'ResumeApp 后端 / 小程序 / 运维文档',
  lang: 'zh-CN',
  // 自定义域名部署在根路径，故 base = '/'（无子路径）。
  // 注意：未挂自定义域前，project URL (…/resume-app/) 下静态资源会 404。
  base: '/',
  lastUpdated: true,
  cleanUrls: true,
  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }],
  ],
  themeConfig: {
    nav: [
      { text: '指南', link: '/guide/', activeMatch: '^/guide/' },
      { text: '运维', link: '/operations/', activeMatch: '^/operations/' },
      { text: '参考', link: '/reference/', activeMatch: '^/reference/' },
      { text: '更新日志', link: '/changelog/', activeMatch: '^/changelog/' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: '指南',
          items: [
            { text: '总览', link: '/guide/' },
            { text: '快速开始', link: '/guide/quickstart' },
            { text: '架构', link: '/guide/architecture' },
          ],
        },
      ],
      '/operations/': [
        {
          text: '运维',
          items: [
            { text: '总览', link: '/operations/' },
            { text: '性能基准 (perf-bench)', link: '/operations/perf-bench' },
            { text: 'Smoke Test', link: '/operations/smoke-test' },
            { text: '告警与指标阈值', link: '/operations/alerts' },
            { text: '慢查询仪表盘', link: '/operations/admin-queries' },
            { text: 'Admin 操作审计', link: '/operations/audit-logs' },
            { text: 'Admin 两步验证 (2FA)', link: '/operations/two-factor' },
            { text: '混沌测试场景', link: '/operations/chaos-testing' },
            { text: '微信小程序 CI 与发布', link: '/operations/wechat-mp-ci' },
            { text: '自定义域名', link: '/operations/custom-domain' },
          ],
        },
      ],
      '/reference/': [
        {
          text: '参考',
          items: [
            { text: '总览', link: '/reference/' },
            { text: 'OpenAPI / Swagger', link: '/reference/openapi' },
            { text: '环境变量', link: '/reference/env-vars' },
          ],
        },
      ],
      '/changelog/': [
        {
          text: '更新日志',
          items: [
            { text: '总览', link: '/changelog/' },
          ],
        },
      ],
    },
    search: {
      provider: 'local',
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/CRLCRL00/resume-app' },
    ],
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026-present CRLCRL00',
    },
    outline: {
      level: [2, 3],
      label: '本页目录',
    },
    docFooter: {
      prev: '上一篇',
      next: '下一篇',
    },
  },
})
