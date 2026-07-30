# Admin Idempotency Keys

> 最后更新：2026-07-13
> Round 40 项 H — admin 写操作幂等键

## 概述

所有 admin 写操作（POST / PUT / PATCH / DELETE）支持 `Idempotency-Key` 头。
client 端在网络抖动 / 重试时，带上相同 key 的重放请求会得到原响应，不重复执行副作用。

## 用法

```bash
curl -X POST https://api/admin/jobs \
  -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000" \
  -H "Cookie: auth_token=..." \
  -H "Content-Type: application/json" \
  -d '{
    "title": "后端工程师",
    "company": "ACME",
    "city": "Shanghai",
    "salary_min": 20,
    "salary_max": 40,
    "degree_required": "本科",
    "experience_required": "3年",
    "skills_required": ["Node.js", "MySQL"],
    "description_md": "..."
  }'
```

## 何时用 / 何时不用

**用**：
- 网络重试（移动端 4G/5G 切换、SSL 握手失败）
- 客户端 retry-after（用户多次点击提交）
- 批量任务中需要"exactly-once"语义

**不用**：
- GET 请求 — 天然幂等
- 业务本身就幂等的接口（如 `set online=1` 这种 toggle）
- 无副作用的纯计算接口

## 语义

| 场景 | 响应 |
|------|------|
| 头缺失 | passthrough（正常处理） |
| 头非法（>128 字 / 非法字符） | 400 |
| 同 key + 同 body + 第一次 | 正常处理 + cache 24h |
| 同 key + 同 body + 第二次 | **重放**原响应（带 `Idempotency-Replay: true` 头） |
| 同 key + **不同** body | **409** `idempotency key reused with different payload` |
| 同 key + in-flight（另一并发请求正在跑） | **409** `idempotency key in-flight, retry after current request completes` |

注：2xx 响应才缓存 24h。4xx/5xx 不缓存，client 修正后可重试。

## 缓存 key 命名

```
admin-jobs:<owner>:<Idempotency-Key>
admin-prompts:<owner>:<key>
admin-2fa:<owner>:<key>
admin-users:<owner>:<key>
admin-legal:<owner>:<key>
admin-logs:<owner>:<key>
```

`<owner>` = `req.user.userId || req.user.openid || 'anon'`。这样不同 admin 用相同 key 不会冲突。

## 失败降级

- **Redis 挂** → log warn + passthrough（不抛 500，admin 操作照常成功）
- **并发 in-flight** → 简单实现：第二个请求 409（client 等待原请求完成再重试）

## TTL

- 缓存结果 24h（`SET ... EX 86400`）
- in-flight 锁 60s（`SET NX EX 60`）— 防止请求挂死占着 key

## 实现位置

- Middleware：`backend/src/middleware/idempotency.js`
- 已挂载：admin 目录下所有写路由（jobs / prompts / admins / twoFactor / legal / logs）

## Follow-up

- 同样保护 user 端写接口（`/api/resume/generate` 等）— 已有部分挂载，可统一审查
- OpenAPI 文档：把 `Idempotency-Key` 头补进 securitySchemes