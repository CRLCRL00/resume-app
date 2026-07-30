# OpenAPI / Swagger

后端暴露 Swagger UI 在生产路径：

```
https://<your-host>/api/docs
```

JSON 规范：

```
https://<your-host>/api/docs/openapi.json
```

源：`backend/src/routes/openapi.js` — 手工写 OpenAPI 3.0 路径（不打 codegen），路由与 spec 同步。

## 注意事项

- 开发期 Swagger UI 在 `/api/docs`（Express 路由） — 不依赖外部 CDN
- 测试与 spec drift 校验：`tests/openapi-drift.test.js`（PR-only 检查）
- 部分敏感端点（`/api/admin/*`）仍以 Bearer token 鉴权，Swagger UI 点 "Authorize" 输 JWT

## 鉴权

```http
Authorization: Bearer <jwt>
```

JWT 从 `POST /api/auth/login`（带微信 code）取。Admin 路由还要 `Authorization: Bearer <admin-jwt>`（`admins` 表 openid 登录拿的 token）。

## 主要端点分类

| 类别 | 前缀 | 鉴权 |
|------|------|------|
| 健康 | `/api/health`, `/api/health/ready` | 公开 |
| 认证 | `/api/auth/{login,refresh,logout}` | 公开 |
| 用户 | `/api/user`, `/api/resume` | user JWT |
| 匹配 | `/api/match`, `/api/jobs` | user JWT（部分公开） |
| Admin | `/api/admin/*` | admin JWT (+ 2FA) |
| 内部 | `/api/internal/*` | Bearer `ALERT_TOKEN` |
| 文档 | `/api/docs` | 公开 |
| 法律 | `/api/legal/*` | 公开 |

详见 `backend/src/routes/openapi.js`。
