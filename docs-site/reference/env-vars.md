# 环境变量

> TL;DR：`backend/.env.example` 是模板。**绝不入仓**真实 `.env`。

## 数据库

| 变量 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `DB_HOST` | ✅ | localhost | MySQL host |
| `DB_PORT` | — | 3306 | |
| `DB_USER` | ✅ | — | 业务账号（DDL 禁） |
| `DB_PASSWORD` | ✅ | — | |
| `DB_NAME` | ✅ | resume_app | |
| `DB_POOL_MAX` | — | 10 | 连接池上限 |
| `SLOW_QUERY_MS` | — | 200 | 慢查询阈值 |

## Redis

| 变量 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `REDIS_HOST` | ✅ | localhost | |
| `REDIS_PORT` | — | 6379 | |
| `REDIS_PASSWORD` | — | — | 无密码留空 |

## JWT / 安全

| 变量 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `JWT_SECRET` | ✅ | — | 强随机，prod 必须 |
| `JWT_EXPIRES_IN` | — | 7d | |
| `CSRF_SECRET` | — | — | admin POST 启用 CSRF |
| `BOOT_DIAGNOSE_TOKEN` | — | — | `/api/internal/boot-diagnose` 鉴权 |

## 微信小程序

| 变量 | 必填 | 说明 |
|------|------|------|
| `WX_APPID` | ✅ | `wx3c0c93a02f5d2356` |
| `WX_SECRET` | ✅ | 微信 code2session |

## LLM (DeepSeek)

| 变量 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `DEEPSEEK_API_KEY` | ✅ | — | sk-... |
| `DEEPSEEK_BASE_URL` | — | https://api.deepseek.com/v1 | |
| `DEEPSEEK_MODEL` | — | deepseek-chat | |

## 告警

| 变量 | 默认 | 说明 |
|------|------|------|
| `ALERT_TOKEN` | — | `/api/internal/metrics/*` Bearer 鉴权 |
| `ALERT_RL_BLOCK_THRESHOLD` | 100 | `RateLimitSpike` |
| `ALERT_HTTP_ERROR_THRESHOLD` | 50 | `HighErrorRate` / `ElevatedErrorRate` |
| `ALERT_LLM_ERROR_THRESHOLD` | 20 | `LLMFailureSpike` |
| `ALERT_SLOW_OPS_THRESHOLD` | 10 | `SlowRequestRate` |
| `ALERT_SLOW_QUERY_THRESHOLD` | 50 | `SlowQuerySpike` |
| `ALERT_DB_POOL_RATIO` | 0.9 | `DBPoolExhausted` |
| `ALERT_DEDUPE_TTL_MS` | 3600000 | Slack 通知去重 TTL（1h） |
| `ALERT_MUTED` | — | CSV alert names 静默 |

## Slack

| 变量 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `SLACK_WEBHOOK_URL` | — | — | 不配只 log warn |
| `SLACK_DEFAULT_CHANNEL` | — | #alerts | |
| `SLACK_HMAC_SECRET` | — | — | incoming verify |

## 服务器 / 运行

| 变量 | 默认 | 说明 |
|------|------|------|
| `PORT` | 3003 | Express port |
| `LOG_LEVEL` | info | pino level |
| `NODE_ENV` | development | test/production 切行为 |
| `BENCH_P99_MS` | 2000 | perf-bench 阈值 |
| `BENCH_P95_MS` | 800 | perf-bench 阈值 |
| `BENCH_DURATION` | 10000 | perf-bench 单端点时长（ms） |
| `BENCH_REAL_LLM` | 0 | 1 = 真 LLM 跑 perf-bench |

## 保留 / Cron

| 变量 | 默认 | 说明 |
|------|------|------|
| `ADMIN_LOGS_RETENTION_DAYS` | 180 | audit log 保留 |
| `CLIENT_ERRORS_RETENTION_DAYS` | 90 | 客户端错误保留 |
