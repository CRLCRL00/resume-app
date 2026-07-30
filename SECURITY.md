# Security Policy

## Supported Versions

| 版本 | 支持 |
|------|------|
| `develop` (active) | ✅ 全部最新 |
| 旧版本 (< 30 天) | ✅ best-effort |
| 已发布体验版 | ✅ 审核期内 |

> 本项目仍 Pre-Production，没有正式 tagged release。

## Reporting a Vulnerability

**请勿 GitHub Issue 公开报告安全漏洞**。

### 渠道

| 渠道 | 详情 | 响应时间 |
|------|------|----------|
| 邮件 | `security@example.com` (TODO: 替换为真实) | 72h 内首响应 |
| 微信群 | 项目所有者微信号（直接联系） | 同 |
| 加密 | PGP（如需密钥私聊获取） | — |

### 报告内容（建议）

```
1. 漏洞类型（XSS / SQLi / auth bypass / 信息泄露 / ...）
2. 影响范围（endpoint + 操作步骤 + 截图/日志）
3. 复现步骤
4. 建议修复（如有）
5. 您的判断：critical / high / medium / low
6. 是否已公开披露（issue / blog / tweet 等）
```

### 响应 SLA

| 严重度 | 首响应 | 修复目标 |
|--------|--------|----------|
| Critical（RCE / auth 绕过） | 24h | 7 天内 |
| High（数据泄露） | 72h | 30 天内 |
| Medium（信息泄露 / DoS） | 7 天 | 下个 release |
| Low（最佳实践） | 30 天 | next quarter |

### Safe Harbor

合法安全研究者：
- 仅在自己的账号 / 测试环境复现
- 不获取 / 泄露真实用户数据
- 不进行 DoS / 暴力破解
- 不影响其他用户
- 给合理时间修复

→ 不会被起诉，会被感谢（todo: Hall of Fame / 致谢）。

## Security Posture (current)

✅ 已实施：
- HTTPS（cert valid via ZeroSSL via serveo.net，真机可达）
- HSTS preload（max-age=31536000; includeSubDomains; preload）
- Helmet 默认头 + 10+ 安全头
- JWT 黑名单（logout 即时撤销）
- JWT_SECRET 生产分级
- API rate limit（auth 5/15min）
- bcrypt-not-needed（OpenID 鉴权，密码登录无）
- 输入 joi validation
- SQL 注入防护（全部 prepared via mysql2）
- log redact（Bearer / sk-… / phone / 敏感 key 名）
- 备份 + 备份 verify cron（每日）
- monitor cron 5min + alert webhook HMAC
- GDPR 数据导出 + 硬删
- admin 操作审计（admin_operation_logs）
- 安全事件审计（securityLog）
- KEY 轮换 runbook（8 类 secret）

⚠️ 当前限制：
- 无 ICP 备案（server 用 IP + 自签 cert；serveo tunnel 真机可达）
- 无生产域名（待 Phase 8+ 上线）
- 服务 mock LLM client（真实 DeepSeek 调用仅生产）

## Version Disclosure

CVEs / 用过的依赖已通过：
```
npm audit --production
```

定期（建议周）跑一次更新 deps。critical CVE 48 小时内 hot-patch。

## Hardening Decks

完整 hardening 任务列表见 `devlog/`：
- 1: npm test hang + LLM mock
- 2: rate limit + log redact + backup cron
- 3: CI + health/deep + README/RUNBOOK
- 4: GDPR endpoints + helmet + OpenAPI
- 5: monitor cron + privacy version + admin audit
- 6: tests + privacy + pm2-logrotate + alert
- 7: login lockout + securityLog + test fix
- 8: audit logs read + update manager + LLM cost
- 9: backup verify + JWT blacklist + OpenAPI complete + Prometheus
- 10: HMAC monitor + secret rotation runbook + helmet硬化
- 11: HMAC raw body fix + legal cache + health thresholds
- 12: graceful shutdown + CORS whitelist + load smoke（本轮）

12+ 轮 hardening 累计 60+ commits。
