# 部署手册

> 最后更新：2026-06-27
> 阶段 0 骨架，阶段 6 补完

## 服务器

- IP：43.139.176.199
- 系统：Ubuntu 24.04（实际，不是计划的 22.04）
- 用户：`ubuntu`（非 root，需 `sudo`）
- SSH 密钥：`C:\Users\CRL\.ssh\id_r`

## 软件版本（实际）

| 软件 | 版本 | 用途 |
|------|------|------|
| Node | v20.20.2 | 后端运行时（NVM 装在 `~/.nvm`） |
| MySQL | 8.0.46 | 主存储 |
| Redis | 7.0.15（Ubuntu 24.04 默认源，API 兼容 6） | 缓存 + 限流 |
| Nginx | 1.24.0 | 反代 + HTTPS |
| PM2 | 7.0.1 | 进程管理 |

## 凭证（不入 git！）

```
MYSQL_ROOT_PASSWORD=ResumeApp@2026
REDIS_PASSWORD=ResumeRedis@2026
```

> 这些只写在本文件和服务器 `.env`。**不要** commit 到任何 git 仓库。

## 部署步骤（阶段 6 补完）

1. 本地 `git push origin develop`
2. SSH 服务器：`cd /opt/resume-app && git pull`
3. `cd backend && npm ci`
4. `pm2 reload ecosystem.config.js`
5. 健康检查：`curl -k https://43.139.176.199/api/health`

## 回滚（阶段 6 补完）

- 保留上一版本代码目录 `/opt/resume-app.bak`
- `pm2 start /opt/resume-app.bak/backend/ecosystem.config.js`
- 数据库回滚用昨日备份还原
