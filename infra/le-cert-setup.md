# R41-Gap-18: Production HTTPS — Let's Encrypt + ICP 备案准备

> **目标**: 把当前自签证书 (`/etc/nginx/ssl/resume-app.{crt,key}`) 替换为可信 CA 签发,使浏览器 / 真机扫码可访问。
>
> **前置 (不是技术问题)**: ICP 备案。域名解析到大陆服务器 IP 必须在工信部备案系统登记完成;未备案的域名可能被运营商拦截 + 微信小程序审核拒绝。

## 流程概览

```
┌─────────────────┐    ┌────────────────┐    ┌─────────────────┐    ┌──────────────────┐
│ 1. 申请 ICP 备案 │ →  │ 2. 买域名       │ →  │ 3. dns 解析到 IP │ →  │ 4. acme.sh 申请   │
│  (工信部,~14 天) │    │  (aliyun/腾讯)  │    │ (备案通过后才生效)│    │   Let's Encrypt  │
└─────────────────┘    └────────────────┘    └─────────────────┘    └──────────────────┘
                                                                              │
                                                                              ↓
                                                              ┌─────────────────────────┐
                                                              │ 5. nginx reload + 强制  │
                                                              │    Enforce HTTPS + HSTS │
                                                              └─────────────────────────┘
```

## Step 1: ICP 备案

### 准备资料

| 项 | 要求 |
|----|------|
| 主体 | 身份证正反 + 手持照 + 联系方式 |
| 域名 | 已购,已完成实名认证 |
| 服务器 | 境內云厂商 ECS 提供的备案服务号 (aliyun/腾讯云/华为云均有) |
| 接入商 | 当前用 43.139.176.199 — 若非云厂商 ECS,需迁到云厂商(裸 IP 无法备案)|
| 备案服务号 | 阿里云免费 5 个;腾讯云免费 5 个 |
| 前置 | 公安 ICP 备案 — 主体非企业 (个人) 需额外 "个人网站承诺书" |

### 时间

- 阿里云初审: 1-2 个工作日
- 工信部审核: 10-20 个工作日(平均 14)
- 个体差异: 有时 30+ 天

### 接入限制

- **裸 IP 无法备案**: 工信部要求接入商为云厂商。若当前是裸 metal / IDC,先迁到云 ECS。
- **一次备案一个域名**: 子域可绑同一备案号。
- **服务范围**: 个人只可做 "个人博客/作品展示" 类,商业用途需企业资质。

### 自助途径

- aliyun: https://beian.aliyun.com
- tencent: https://console.cloud.tencent.com/beian
- 工信部备案系统: https://beian.miit.gov.cn

## Step 2: 域名

- **后缀**: `.cn` / `.com` / `.org` 都行;`.cn` 需要实名 + ICP 同步,流程略长。
- **推荐**: `.com`(国际通用,审核阻力小)。
- **WHOIS 隐私**: 国内注册商(阿里云/腾讯云)默认开隐私保护,合规无虞。

## Step 3: DNS 解析

| 记录 | 名称 | 值 | 备注 |
|------|------|-----|------|
| A | @ | 43.139.176.199 | 顶级域 |
| A | www | 43.139.176.199 | www 子 |
| A | api | 43.139.176.199 | API 入口(小程序要 https 的一个独立子)|

备案下来前 — 解析切到"暂停"或留空。否则会被 ISP 拦截 + 微信审核 fail。

## Step 4: Let's Encrypt 申请

### 选 DNS-01 challenge(推荐)

- 不依赖 80 端口可达;当前 server 80 端口已 301 → 443,但 Let's Encrypt HTTP-01 challenge 仍可工作(443 也能用 http-01 alt port)。
- DNS-01 更通用:对裸 IP + 单端口限制的 server 也 OK。

### acme.sh 安装

```bash
# server
ssh ubuntu@43.139.176.199
# 推荐用 dns 模式 (免 80 端口,免 nginx reload 风险)
curl https://get.acme.sh | sh -s email=you@example.com
. ~/.acme.sh/acme.sh.sh

# 选择 DNS provider (aliyun 示例)
export Ali_Key="<your-aliyun-accesskey-id>"
export Ali_Secret="<your-aliyun-accesskey-secret>"
acme.sh --issue --dns dns_ali -d api.example.com -d www.example.com --keylength ec-256
```

其他 DNS provider 列表: https://github.com/acmesh-official/acme.sh/wiki/dnsapi

### 安装 cert 到 nginx

```bash
mkdir -p /etc/nginx/ssl
acme.sh --install-cert -d api.example.com --ecc \
  --key-file       /etc/nginx/ssl/api.example.com.key \
  --fullchain-file /etc/nginx/ssl/api.example.com.crt \
  --reloadcmd      "systemctl reload nginx"
```

### 自动续期

- acme.sh 默认装 cron `0 0 * * *` 自动续 cert
- cert 60 天前自动续期,无需额外脚本

## Step 5: nginx 切换

### 修改 deploy/nginx/resume-app.conf

```diff
-  ssl_certificate     /etc/nginx/ssl/resume-app.crt;
-  ssl_certificate_key /etc/nginx/ssl/resume-app.key;
+  ssl_certificate     /etc/nginx/ssl/api.example.com.crt;
+  ssl_certificate_key /etc/nginx/ssl/api.example.com.key;
   ssl_protocols TLSv1.2 TLSv1.3;
-  ssl_ciphers HIGH:!aNULL:!MD5;
+  # Mozilla "intermediate" profile 2024
+  ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
+  ssl_prefer_server_ciphers off;
+
+  # HSTS — 仅在 cert 信任后开,否则自签 + HSTS 会锁死
+  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
+  add_header X-Content-Type-Options nosniff;
+  add_header X-Frame-Options DENY;
+  add_header Referrer-Policy "strict-origin-when-cross-origin";

-  server_name _;
+  server_name api.example.com www.example.com;
```

### HSTS preload (可选)

提交 https://hstspreload.org — 域名固化在浏览器 HSTS list,无法回退。慎重。

### 提交 sitemap / 验证

```bash
# server
nginx -t
systemctl reload nginx

# 检查 cert
curl -vI https://api.example.com 2>&1 | grep -i "subject\|issuer\|expire"

# A+ SSL Labs 测试(可选)
# https://www.ssllabs.com/ssltest/analyze.html?d=api.example.com
```

## Step 6: 微信小程序切换

- mp.weixin.qq.com → 开发管理 → 开发设置 → 服务器域名 → 修改
- 旧 serveo hostname 仍在 "request 合法域名" / "uploadFile 合法域名" 列表 — 改 https://api.example.com
- 真机扫码 → release 版本 → mp.weixin.qq.com 提交审核

## 降级 / 回滚

若 cert 更新失败或 cron 不工作 — 三个月内 cert 过期会"硬中断"所有 https。

- `acme.sh --list` 看 cert 状态
- `acme.sh --renew -d api.example.com --force` 手动续
- nginx 默认 fallback 到错误页面 → 立即排查

## Estimated time

| 阶段 | 时间 | 可并行 |
|------|------|--------|
| ICP 备案 | 14-30 天 | 同时准备域名 / acme.sh |
| 域名注册 + 实名 | 1-3 天 | 与 ICP 并行 |
| cert 申请 + nginx 切换 | 1 小时 | 备案通过后 |
| 微信小程序改域名 | 30 分钟 | cert OK 后 |

总: ~14-30 天,纯 ops 工作最少。

## 当前 backup 状态(R41 写时)

- **当前 cert**: 自签 `/etc/nginx/ssl/resume-app.crt`(365 天有效)
- **当前域名**: 无,仅 IP + serveo tunnel hostname
- **ICP**: 未备案

若想立即上线但懒得等 ICP — 接受纯 serveo tunnel + 自签 cert(微信小程序场景下微信不验 cert,所以技术上可用)。
用户教育程度可接受。但中国大陆境内用户打开会弹"不安全"。

## 相关文件

- `deploy/nginx/resume-app.conf` — 当前自签配置;改 + reload 即可切 LE
- `infra/setup-server.sh` Step 5 — 含自签生成步骤;长期应删
- `infra/server-state.md` — server 状态,sync 后 cert 路径需要更新
- `RUNBOOK.md` — 加一节"切 HTTPS" step
