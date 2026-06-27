# 监控手册

> 最后更新：2026-06-27
> 阶段 6 补完

## 健康检查

- `GET https://43.139.176.199/api/health` — 后端
- `redis-cli -a $REDIS_PASSWORD ping` — Redis
- `mysqladmin -uroot -p$MYSQL_ROOT_PASSWORD ping` — MySQL

## 资源监控

- CPU / 内存 / 磁盘：`top` / `free -h` / `df -h`
- PM2 进程：`pm2 monit`

## 告警（阶段 6 补完）

- PM2 邮件告警（pm2 notify）
- 钉钉 webhook（自建 cron 检查 + 推送）
- 监控项：API 5xx 比例、Redis 内存、MySQL 连接数、磁盘使用
