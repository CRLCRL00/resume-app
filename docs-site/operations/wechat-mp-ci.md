# 微信小程序 CI 与发布 (Round 40)

> 目标: 把 mini-program 上传 + 体验版 + 审核 流程完整化, 加 CI 自动 + 文档化.

## 三种发布方式对比

| 方式 | 触发 | 输出 | 适用场景 |
| --- | --- | --- | --- |
| **微信开发者工具 IDE** | 人工点 上传 | 体验版 (二维码 + 后台链接) | 临时调试, 单次提交 |
| **本地脚本** `npm run wx:upload` | 开发者手动 | 体验版 | 不想开 IDE, 想用命令行 |
| **CI** `.github/workflows/upload-miniprogram.yml` | push 到 develop (改 mini-program) 或 workflow_dispatch | 体验版 | 主路径, PR 合 develop 后自动跑 |
| **预览 QR** `npm run wx:preview` 或 `.github/workflows/wx-mp-preview.yml` | 手动 | 二维码 (扫码直跑) | 不上传, 仅扫码测试 |

> **审核 提交不在上面任何流程里**. CI / 脚本只把代码变成 体验版.
> 提交审核 仍需开发者去 [mp.weixin.qq.com](https://mp.weixin.qq.com) → 版本管理 → 选中体验版 → 点 提交审核.
> 后续如果要做 审核 API 化, 见 follow-up.

## 密钥 base64 编码

CI runner 拿到的是 base64 字符串, 解码后还原成 `.key` 文件. 在 admin 本机 (一次性) 做:

```bash
# Git Bash / WSL / macOS / Linux
base64 -i "D:/小程序密钥.key" -o key.b64

# 或 PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("D:\小程序密钥.key")) | Out-File -Encoding ascii key.b64
```

把 `key.b64` 整文件内容粘到 GitHub repo → Settings → Secrets → `WX_MINIPROGRAM_KEY_BASE64`.

> 真实的 `D:\小程序密钥.key` 在 `.gitignore` (`*.key.txt` + 微信开发者工具本地配置段), **绝不**入仓.

## CI 流程图

```
push to develop (含 mini-program/**)
        │
        ▼
┌────────────────────────────────┐
│ upload-miniprogram.yml         │
│   checkout → setup-node →      │
│   npm ci → 解码 key →          │
│   miniprogram-ci upload        │
│   --uv 1.0.$RUN_NUMBER         │
│   --udata "$desc"              │
└────────────────────────────────┘
        │
        ▼
 微信后台 版本管理 → 体验版列表
        │
        ▼ (人工)
 提交审核 → 审核通过 → 发布
```

### 触发条件

- **自动**: push 到 `develop` 且 diff 含 `mini-program/**` 或本 workflow 文件
- **手动**: GitHub Actions → Upload Mini-Program → Run workflow (可填 version / desc)
- **预览 QR**: GitHub Actions → WeChat MP Preview (QR) → Run workflow (可填 desc / pagePath)

## 体验版 QR 用法

预览 QR 不上传代码, 只是生成一个临时二维码, 任何人微信扫码都能跑该分支的代码 (限 30 分钟).

```bash
# 本地
cd mini-program
npm run wx:preview                          # 默认首页
npm run wx:preview pages/admin/index        # 指定启动页

# 输出: ../dist/wx-mp-qr.png
```

CI: Actions → WeChat MP Preview (QR) → Run workflow. 跑完后:
1. Action summary 里直接渲染 PNG (markdown image)
2. artifact `wx-mp-qr` 下载 qr.png

## 注意事项

1. **CI 不会自动 提交审核**. 原因是:
   - 微信审核 API (`/wxa/submit_audit`) 需要先传 media_id + 多个分类 tag, 复杂度高
   - 审核驳回后还要走 撤回 + 重新提交 流程, 自动化易出错
   - 法务 / 资质材料需要人工介入
2. **IP 白名单**: mp.weixin.qq.com 后台 → 设置 → 第三方平台 → IP 白名单 加 `14.154.95.254` (GH runner 出口 IP)
3. **AppID**: `wx3c0c93a02f5d2356` (硬编码在 workflow, 不要改; 改值需同步 dev / prod 的 mp 后台)
4. **版本号格式**: `1.0.<整数>`. CI 用 `$GITHUB_RUN_NUMBER` (单调递增). 手动跑可填 `1.0.7` 等.
5. **密钥轮换**: 在 mp 后台 重新生成 → 重新 base64 → 覆盖 GH secret. 旧密钥当次有效, 后续上传会失败.
6. **首次上传**: 第一次 CI 跑会因 mp 后台还没登记这个 AppID 的代码管理 token 而失败, 需要先用 IDE 上传一次 (建立基线版本).

## Follow-up

- [ ] 审核 API 化 (`/wxa/submit_audit` + `/wxa/release`): 需先人工跑通 1-2 次确认 tag / 分类, 再写 CI 包装
- [ ] 灰度发布 (`getgrayreleaseplan`): 当前是全量发布, 高频改动的功能可考虑灰度
- [ ] 上传产物归档: 当前只传 wx, 没有存 `.zip` 在 S3 / OSS. 排查线上 bug 时回溯不便
- [ ] Slack / 飞书 webhook 通知 CI 上传结果

## 相关文件

- `.github/workflows/upload-miniprogram.yml` — 上传 CI (体验版)
- `.github/workflows/wx-mp-preview.yml` — 预览 QR CI
- `scripts/wx-mp-upload.sh` — 本地上传脚本
- `scripts/wx-mp-preview.sh` — 本地预览脚本
- `mini-program/package.json` — `wx:upload` / `wx:preview` npm scripts
- `mini-program/project.config.json` — appid + miniprogramRoot