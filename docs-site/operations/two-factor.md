# Admin 两步验证 2FA (R33 + R35)

> TL;DR：TOTP RFC 6238 + 8 个 backup code；step-up 模式（5 分钟内通过一次即放行）；恢复用 backup code 绕过。

## 启用流程

1. **setup** — `POST /api/admin/2fa/setup`
   - 生成 20 字节 base32 secret
   - 写 `admins.totp_secret` (Buffer)，`totp_enabled=0`
   - 返回 `{ otpauthUrl, base32, qrDataUrl }`
   - QR 编码走 `qrcode` 包 → data URL

2. **扫码** — admin 用 Google Authenticator / 1Password / Authy 扫 `qrDataUrl`
   - 兼容任意 RFC 6238 客户端
   - 标签 `ResumeApp:<openid>`

3. **enable** — `POST /api/admin/2fa/enable` body `{ code }`
   - 校验 6 位数字 + `speakeasy.totp.verify({ window: 1 })`
   - `totp_enabled=1` + `totp_verified_at=NOW()`
   - 生成 **8 个 backup code**（`a1b2-c3d4` 形式），**只此一次**返回
   - 写 `admin_2fa_backup_codes` 表

4. **status** — `GET /api/admin/2fa/status`
   ```json
   { "enabled": true, "hasSecret": true, "verifiedAt": "...", "backupCodesRemaining": 8 }
   ```

## Step-up 模式

敏感 admin 写操作（job CRUD / prompt / 2fa 自身）过 `twoFactorRequired` 中间件：

- 检查 Redis `2fa:verified:<openid>` 存在 + TTL < 300s
- 在 → 直接放行
- 不在 → 返 401 `{ code: 1401, message: '2FA required' }`

### 通过路径

`POST /api/admin/2fa/verify` body `{ code }`：

- 校验 6 位 TOTP → 写 `2fa:verified:<openid>` TTL 300s
- 或校验 backup code → consume（一次性）+ 写 `2fa:verified:<openid>` TTL 300s

5 分钟内不用再输。

## Backup Code

- 8 个，格式 `a1b2-c3d4`（4 字符 - 4 字符）
- 哈希存 DB（`admin_2fa_backup_codes` 表 `code_hash`）
- 一次性使用：consume → 删行
- 耗尽后再 enable 会**重新生成 8 个**
- admin 自己看 `backupCodesRemaining`，无需轮询后台

## 恢复（丢手机 / 误删）

1. **首选**：用 backup code 登录 → 重新 enable 2FA → 新 backup codes
2. **次选**：ops 手动 SQL 干预（生产禁用，留作 emergency）
   ```sql
   -- 紧急禁用（不删 secret，可重 enable）
   UPDATE admins SET totp_enabled=0, totp_verified_at=NULL WHERE openid=?;
   -- 紧急清空
   UPDATE admins SET totp_secret=NULL, totp_enabled=0, totp_verified_at=NULL WHERE openid=?;
   DELETE FROM admin_2fa_backup_codes WHERE openid=?;
   ```
3. ops 操作必须写 `admin_operation_logs` (action=`2fa.admin_reset`)

## Redis 失败行为

| 路径 | 行为 | 原因 |
|------|------|------|
| `isVerified` | fail-open → false | 读路径保守拒绝（让用户输一次码） |
| `markVerified` | 静默失败但放行 | 写信任路径失败时**降级**而非阻塞 |
| `issueChallengeToken` | 返回 token 但写失败 | caller 拿到 token 后 consume 失败 → fail-open 返 null |

`twoFactor.js` 全部 Redis ops try/catch + `logger.warn`。

## 测试

`tests/admin2fa.test.js` 覆盖：
- setup / enable / verify happy path
- backup code consume 一次性
- 错误 code 拒绝
- window=1 容差

`tests/twoFactorRequired.test.js` 覆盖中间件：
- 没 2FA → 401 1401
- 5 分钟内已 verify → 放行
- Redis down → fail-open 拒绝

## 安全注意

- secret base32 **不要** log（`logger` 已 redact secrets）
- backup code 只在 enable 响应里返一次
- step-up TTL 5 分钟（短，平衡 UX）
- secret 长度 20 字节 = 160 bit（RFC 4226 推荐上限）
