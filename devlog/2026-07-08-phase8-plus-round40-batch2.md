# 开发日志 — 2026-07-08（Phase 8+ Round 40 Batch 2）

> 阶段：8+ Round 40 Batch 2 — ADF hardening
> 前置：[2026-07-08-phase8-plus-round40-batch1.md](../devlog/2026-07-08-phase8-plus-round40-batch1.md)

## 目标

3 项 MP 生态 + 文档域：
D. WeChat MP 审核 + 体验版（CI + 本地脚本 + 文档）
E. Sentry source map for mini-program
G. docs-site 自定义域名

## 最终结果

| 项 | 状态 |
|----|------|
| D WeChat MP CI | ✅ preview workflow + 2 local scripts + docs（4 文件，fcefb81）|
| E Sentry source map | ✅ sentry-miniapp + upload script + GH Actions + 6 测（80cde9c）|
| G docs-site domain | ✅ CNAME + workflow + custom-domain.md + vitepress build 4.83s（1694384）|
| **npm test 3x** | ✅ **402 / 399 pass / 2 fail / 1 skip** × 3 |

E 自有测 6/6 pass。G vitepress build 成功。Backend 无改动，402 不变。

## ⚠️ Staging Race

3 个 subagent 并行跑时 `git add` + `git commit` 不同步。

**问题**：G 的 commit `1694384` 误含 E 的 mini-program 文件：
- `mini-program/app.js`（+2 行：sentry require）
- `mini-program/package.json`（+9 行：sentry-miniapp devDep）
- `mini-program/package-lock.json`（+26 行）
- `mini-program/src/config.example.js`（+24 行）
- `mini-program/utils/sentry.js`（+41 行）
- `.gitignore`（+2 行：`mini-program/src/config.js`）

**结果**：所有 E 的功能代码已 commit（无丢失），但归属混在 G 的 commit 里。
**E 自己的 commit** `80cde9c` 覆盖 E 的 upload script + GH Actions + docs + tests + index cross-ref。
**D 的 4 个文件** 因 D agent 报告前已被 G 的 commit 抢先完成，staging race 没影响 D — D 全部文件 4 untracked → 由我手动 commit `fcefb81`。

**决策**：不重写历史（避免 force push）。devlog 记录实际状态。

## 改动详情

### D — WeChat MP 审核 + 体验版

`.github/workflows/wx-mp-preview.yml`（新，96 行）：
- trigger: `workflow_dispatch`（手动 + desc + pagePath 输入）
- 步骤：checkout → setup-node@v4 → `npm ci` mini-program → 解码 `WX_MINIPROGRAM_KEY_BASE64` → `miniprogram-ci preview --qrcode-format base64` → upload artifact `qr.png` + 写 `$GITHUB_STEP_SUMMARY`
- 体验版 QR 用法：开发者 push 后手动跑 → QR 在 Actions summary

`scripts/wx-mp-upload.sh`（新，~60 行，bash）：
- 手动 `npm run wx:upload` 替代开 IDE
- 用 `D:\小程序密钥.key`（不入仓）
- 接受参数：version + desc
- 检查密钥存在 + 目录存在 → `miniprogram-ci upload`

`scripts/wx-mp-preview.sh`（新，~70 行，bash）：
- `npm run wx:preview` 生成 QR PNG
- 输出到 `dist/wx-mp-qr.png`，自动 open（Windows explorer.exe / macOS open / Linux xdg-open）

`docs-site/operations/wechat-mp-ci.md`（新，104 行）：
- 4 种发布方式对比表（IDE / local / CI / preview QR）
- 密钥 base64 编码方法（Git Bash + PowerShell 双方案）
- CI 流程图 + 触发条件
- 审核说明：**CI 不自动提交审核**（mp.weixin.qq.com 仍需人工点 提交审核）
- Follow-up：审核 API 化

### E — Sentry Source Map MP

SDK 选择：
- `@sentry/mini-program` 404 不存在
- `@sentry/wxapp` 404 不存在
- `sentry-mina` 2020 停更 v0.4.7
- ✅ **`sentry-miniapp`** v1.13.1（2026-07-07）— 社区维护，官方 community-supported，原生 WeChat/Alipay/ByteDance 支持

`mini-program/package.json`：devDep `sentry-miniapp@^1.13.1` + script `sentry:sourcemap`。

`mini-program/utils/sentry.js`（新）：
```js
import * as Sentry from 'sentry-miniapp';
Sentry.init({
  dsn: process.env.SENTRY_DSN_MP || 'https://placeholder@sentry.example/1',
  release: process.env.APP_VERSION || 'dev',
  environment: process.env.NODE_ENV || 'development',
  tracesSampleRate: 0.1,
  beforeSend(event) {
    if (event.user) {
      delete event.user.ip_address;
      delete event.user.email;
    }
    return event;
  },
});
```

`mini-program/app.js`：顶部 `require('./utils/sentry')` 早于 `App()`。

`mini-program/src/config.example.js`（committed）+ `src/config.js`（gitignored）：
- 真运行时配置（DSN、API base URL）
- 默认 placeholder；本地 `cp config.example.js config.js` 后填真值

`mini-program/scripts/upload-sourcemaps.js`（新）：
- 手工 source map 上传 CLI（用 `@sentry/cli`）
- 接受 env: `SENTRY_AUTH_TOKEN` `SENTRY_ORG` `SENTRY_PROJECT`
- 调用 `sentry-cli releases new <release>` + `upload-sourcemaps ./dist`

`.github/workflows/sentry-mp.yml`（新）：
- trigger: `workflow_dispatch` + push tag `mp-v*`
- 默认 OFF（避免 dev 误触发上传垃圾 release）

`docs-site/operations/sentry-mp.md`（新）：
- mini-program 端 init
- source map 工作流
- PII 过滤策略（ip_address / email 删）
- 测试方法（dev 工具 console 跑 `Sentry.captureException(new Error('test'))`）

6 测：utils/sentry.js 存在 / config.example 存在 / config.js 默认空 DSN / beforeSend 过滤 / app.js 顺序 / devDeps 含 sentry-miniapp

### G — docs-site 自定义域名

`docs-site/CNAME`（新）：`docs.example.com`（占位，README 教改真域）

`docs-site/.vitepress/config.ts`（改）：显式 `base: '/'`（自定义域根路径）+ sidebar 加自定义域链接

`.github/workflows/docs-deploy.yml`（改）：
- build 后 `cp docs-site/CNAME docs-site/.vitepress/dist/CNAME`
- `actions/configure-pages@v4` 设 `enablement: true`
- cache step：`actions/cache@v4` 对 `docs-site/node_modules` + `.vitepress/cache`

`docs-site/operations/custom-domain.md`（新，89 行）：
- GH Pages 自定义域步骤
- DNS 配置示例（CNAME `docs` → `crlcrl00.github.io`）
- HTTPS 强制（Enforce HTTPS）
- 本地测试：改 hosts + `mkcert` 自签
- VitePress `cleanUrls` 兼容性

`README.md`（改）：加 "## 文档" 章节（当前 URL + 自定义域指引）

**Build 验证**：
- `vitepress build` 4.83s ✅
- `dist/CNAME` = `docs.example.com` ✅
- 内部链接 `/guide/quickstart` 形式（cleanUrls 生效）✅
- 资源引用 `/` 根路径（`base:'/'` 生效）✅

## ⚠️ Base 路径权衡

`base:'/'` 后，**未挂自定义域前** project URL `…/resume-app/` 静态资源 404 — 挂域后正常。
若需过渡期同时可用，需条件化 base（当前固定 `/`）。Follow-up。

## npm test

| Run | tests | pass | fail | skip |
|-----|-------|------|------|------|
| 1 | 402 | 399 | 2 | 1 |
| 2 | 402 | 399 | 2 | 1 |
| 3 | 402 | 399 | 2 | 1 |

Backend 无改动，402 不变。0 新 fail。

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | D preview workflow manual only | 避免 push 误触发 QR 生成；admin 决定何时 |
| 2 | D 本地脚本用 `D:\小程序密钥.key` 而非 base64 env | 本机一次配置，CI 才用 secret |
| 3 | D CI 不自动 提交审核 | 微信审核需人脸识别 / 协议勾选，无法 API 化 |
| 4 | E 选 `sentry-miniapp` 而非 `@sentry/wxapp` | 后者不存在；前者 v1.13.1 活跃维护 |
| 5 | E SDK 不上 `@sentry/node` shared | mini-program 环境差异大，独立 SDK 更稳 |
| 6 | E sentry workflow 默认 OFF | 避免 dev push 触发垃圾 release |
| 7 | E 真 DSN 走 config.js（gitignored）| config.example 模板 + 手动 cp；防误 commit 真 DSN |
| 8 | G CNAME 写占位 `docs.example.com` | 不 commit 真域名；用户控制 |
| 9 | G `base:'/'` 固定 | 自定义域主路径；过渡期 404 接受 |
| 10 | staging race 不重写历史 | force push 风险高；devlog 注明即可 |

## 风险

| 风险 | 缓解 |
|------|------|
| D CI 用真密钥 base64 误泄露 | GH secret + 仅 runner 解码；本地密钥不入仓 |
| D local 脚本路径写死 `D:\小程序密钥.key` | README 教改；WSL 用户需 /mnt/d/... |
| E 真 DSN 误 commit | config.js 已 gitignore；config.example 不含真值 |
| E Sentry 流量费用 | tracesSampleRate=0.1；可调 0.01 |
| G `base:'/'` 期间 GH Pages 404 | deploy 完后必须挂域；如未挂可临时回 `'/resume-app/'` |
| staging race 重现 | 后续 3-并行批次加"先 git add 自己文件再 commit"；或单线程 |

## 已知 Follow-up

| # | 项 | 优先级 |
|---|----|--------|
| 1 | 多 pod alert dedupe 改 Redis pub/sub | 低 |
| 2 | 微信 提交审核 API 化 | 中 |
| 3 | Sentry alert 配置（rule: error rate / release health）| 中 |
| 4 | docs-site `base` 条件化（domain vs project URL 兼容）| 中 |
| 5 | admin panel: 2FA 强制启用 + device fingerprint | 低 |
| 6 | Batch 2 subagent 串行而非并行（避免 staging race）| 低 |

## Commits

| SHA | msg |
|-----|-----|
| `fcefb81` | feat(mp): WeChat MP CI + 体验版 (preview workflow + local scripts + docs) |
| `80cde9c` | feat(mp): Sentry source map 上传 + GH Actions + docs |
| `1694384` | docs-site: 支持自定义域名（含 staging race 中混入的 E 文件）|

> 注：`1694384` 因 staging race 误含 E 的 6 个文件；E 自己的 commit 是 `80cde9c`。功能完整，仅归属混乱。
> R40 还有 Batch 3（H 幂等键 + A 多 pod dedupe）待派。
