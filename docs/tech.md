# 技术文档 — 简历推荐小程序

> 最后更新：2026-06-27
> 对应：[requirements.md](./requirements.md) / [design.md](./design.md)

## 1. 技术栈总览

| 层 | 技术 | 选型理由 |
|----|------|----------|
| 用户端 | 微信小程序（WXML + WXSS + JS 原生） | 平台强制；门槛最低 |
| 管理端 | 同小程序 + 分包加载 | 包体积隔离，后续可拆 Web |
| 后端 | Node.js 20 + Express | 生态熟、上手快 |
| 数据库 | MySQL 8 | 成熟、运维简单 |
| 缓存 | Redis 6 | 限流、锁、列表缓存 |
| 反向代理 | Nginx + Let's Encrypt | HTTPS 卸载（小程序硬性要求） |
| LLM | DeepSeek API（OpenAI 兼容协议） | 中文优、价格低 |
| 进程管理 | PM2 | 日志切割、热重启、守护 |
| 部署 | 腾讯云轻量 2C4G | 同机 MySQL+Redis，MVP 够用 |
| 包管理 | npm | Node 原生 |

## 2. 目录结构

```
d:/项目/简历app/
├── miniprogram/              # 微信小程序工程（用户端 + 管理端分包）
│   ├── pages/
│   │   ├── index/            # 首页
│   │   ├── form/             # 资料表单
│   │   ├── resume/           # 简历预览
│   │   ├── jobs/             # 岗位列表
│   │   └── job/              # 岗位详情
│   ├── admin/                # 管理端分包
│   │   └── pages/
│   │       ├── job-list/
│   │       ├── job-edit/
│   │       └── prompt-edit/
│   ├── utils/
│   │   ├── request.js        # 封装 wx.request
│   │   └── storage.js        # 草稿持久化
│   ├── app.js / app.json / app.wxss
│   └── project.config.json
├── backend/                  # Node 后端
│   ├── src/
│   │   ├── routes/
│   │   ├── controllers/
│   │   ├── services/
│   │   │   ├── llm.js        # DeepSeek 调用层
│   │   │   ├── match.js      # 两阶段匹配
│   │   │   ├── resume.js     # 简历生成
│   │   │   └── cache.js      # Redis 封装
│   │   ├── middlewares/
│   │   │   ├── auth.js       # 用户鉴权
│   │   │   ├── admin.js      # 管理员鉴权
│   │   │   └── ratelimit.js  # 限流
│   │   ├── db/
│   │   │   ├── mysql.js
│   │   │   ├── redis.js
│   │   │   └── migrations/   # SQL 迁移脚本
│   │   ├── config/
│   │   └── app.js
│   ├── .env                  # 不入 git
│   ├── .env.example          # 入 git
│   ├── .gitignore
│   ├── ecosystem.config.js   # PM2
│   └── package.json
├── docs/                     # 标准文档
│   ├── index.md
│   ├── requirements.md
│   ├── tech.md               # 本文件
│   ├── design.md
│   ├── execution.md
│   └── superpowers/specs/
│       └── 2026-06-27-简历推荐小程序-design.md
├── devlog/                   # 开发日志
│   ├── README.md
│   ├── template.md
│   └── 2026-06-27.md
├── scripts/                  # 运维脚本
│   ├── backup.sh
│   ├── deploy.sh
│   └── new-day.sh
└── README.md
```

## 3. 关键库依赖

### 后端 package.json 核心依赖

| 包 | 用途 |
|----|------|
| express | HTTP 服务 |
| mysql2 | MySQL 驱动（支持 Promise） |
| ioredis | Redis 客户端 |
| axios | HTTP（DeepSeek / 微信 API） |
| jsonwebtoken | session token 签发 |
| dotenv | .env 加载 |
| winston | 结构化日志 |
| express-rate-limit | 兜底限流 |
| joi | 参数校验 |

### 小程序核心库

| 包 | 用途 |
|----|------|
| towxml | Markdown 渲染 |
| 无 UI 框架 | 原生够用，避免体积膨胀 |

## 4. 环境配置

### 4.1 .env 必备字段

```bash
# 微信
WECHAT_APPID=
WECHAT_SECRET=

# DeepSeek
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com

# MySQL
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=jianli
MYSQL_PASS=
MYSQL_DB=jianli

# Redis
REDIS_URL=redis://:password@127.0.0.1:6379

# 服务
PORT=3000
SESSION_SECRET=

# 业务开关
RESUME_GEN_DAILY_LIMIT=3
MATCH_DAILY_LIMIT=5
MATCH_LOCK_TTL=30
LIST_CACHE_TTL=86400
```

### 4.2 Nginx 配置

`/etc/nginx/conf.d/jianli-app.conf`：

```nginx
server {
    listen 443 ssl;
    server_name your-domain.cn;

    ssl_certificate     /etc/letsencrypt/live/your-domain.cn/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.cn/privkey.pem;

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 60s;
    }

    access_log /var/log/nginx/jianli-app.access.log;
}
```

### 4.3 PM2 配置

`ecosystem.config.js`：

```js
module.exports = {
  apps: [{
    name: 'jianli-backend',
    script: './src/app.js',
    instances: 1,
    max_memory_restart: '500M',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    log_file: '/var/log/jianli-app/combined.log',
    error_file: '/var/log/jianli-app/error.log',
    out_file: '/var/log/jianli-app/out.log',
    log_split: true,
    merge_logs: true
  }]
};
```

### 4.4 MySQL 内存约束（my.cnf）

```ini
[mysqld]
innodb_buffer_pool_size = 512M
max_connections = 200
```

### 4.5 Redis 内存约束（redis.conf）

```
maxmemory 256mb
maxmemory-policy allkeys-lru
save 900 1
save 300 10
save 60 10000
requirepass your_password
```

## 5. LLM 调用规范

| 操作 | 输入上限 | 输出 max_tokens | 超时 | 重试 |
|------|----------|-----------------|------|------|
| 简历生成 | 1 份资料 | 1500 | 10s | 2 次 |
| 匹配精排 | ≤ 15 岗位 | 1000 | 10s | 2 次 |

**所有 LLM 输出必须为纯 JSON**，Prompt 加「只输出 JSON，不要任何额外解释」约束。

## 6. 安全基线

- `.env` 入 `.gitignore`
- MySQL 业务账号仅授当前库读写
- Redis 必设密码
- 所有接口参数 joi 校验
- SQL 全部参数化（mysql2 占位符）
- 用户输入转义后再渲染（防 XSS）

## 7. 备份策略

- `crontab` 每日 03:00 执行 `scripts/backup.sh`
- `mysqldump` 全量 → 压缩 → 上传 COS
- 脚本自动清理 7 天前的旧备份

## 8. 监控（MVP 简化）

- PM2 日志轮转
- 关键错误告警通过 winston 写文件，定期人工 review
- V2 接入 Sentry / 腾讯云监控