# 开发日志 — 2026-07-14（Phase 8+ Round 52）

> 阶段：8+ Round 52 — wechat IP whitelist 不一致根因 + 修复步骤
> 前置：[2026-07-14-phase8-plus-round51.md](../devlog/2026-07-14-phase8-plus-round51.md)

## 起点

user 答"我已经是加过了啊" — R51 server 仍 `invalid ip 43.139.176.199, not in whitelist`。看似矛盾, 我深查。

## 真根因 (find)

历史 devlog 显示:

| round | 白名单 IP | server 公网 IP (出网) |
|-------|-----------|-------------------|
| R27 (2026-07-05) | `14.154.95.254` 已加 | `14.154.95.254` |
| R49 (2026-07-14) | 仍是 `14.154.95.254` (?) | **`43.139.176.199`** (已变) |

**R27 devlog 明确写**:
> "公网动态 IP, 每次重连可能变"

7-05 后 server 重启过 (R40 setup-script 后续 ops), 公网 IP 现在 **`43.139.176.199`**, 但 mp.weixin.qq.com 后台**仍只认 `14.154.95.254`** (user 当时加的那个)。

最终 R51 server curl wechat:
```
wechat error: invalid ip 43.139.176.199 ... not in whitelist
```

— 完全符合预期: wechat 后台白名单是 `14.154.95.254`, server 实际出口 `43.139.176.199` 不 match。

## 修法 (你做, 我不能)

我无法操作 mp.weixin.qq.com UI (浏览器扫码 + 表单)。需要 user 手动:

### Step: 把 `43.139.176.199` 加入 mp.weixin.qq.com 后台

1. 浏览器登录 https://mp.weixin.qq.com (微信扫码)
2. 左侧 → 开发 → 开发管理 → 开发设置
3. 找到 "服务器域名 / IP 白名单" 或 "小程序代码上传 IP 白名单"
   - 注意: **有 2-3 张白名单表**, 都要加:
     a. **小程序代码上传 IP 白名单** (R27 用过)
     b. **开发者 ID 服务器白名单** (R40 code2session 用)
     c. (公众号 / 小程序后台若有 "微信开发者工具 IP 白名单" 也加)
4. 当前位置显示 `14.154.95.254` (R27 时期加的)
5. **追加**: `43.139.176.199`
6. 保存 (微信加完可能要 5-30min 缓存, 也可能 24h)

### 验证 (让 server 走真路径)

```bash
ssh ubuntu@43.139.176.199
curl -sk -m 8 -X POST -H "Content-Type: application/json" \
  -d '{"code":"TEST_DUMMY_VALUE"}' \
  http://127.0.0.1:3003/api/auth/login
# 期望返: 40163 (invalid code) 而非 1001 (invalid ip)
# 1001 = IP 仍不在白名单 → 加错位置或 cache 未刷新
```

## 我 code-side 进一步动作 (R51 已 push)

R51 加 `/api/auth/dev-bypass-active` (`ENABLE_DEV_BYPASS=1` env) 是临时绕开 wechat 的兜底。

如果你不想现在加 IP (或者 mp.weixin.qq.com 卡):
- ops 启 R51 endpoint (临时): `echo ENABLE_DEV_BYPASS=1 >> .env; pm2 restart --update-env`
- 完成查清后关: `sed ...ENV=0...; pm2 restart --update-env`

但这只能 dev 调试用, 真机预览/提审仍必须走真 wechat IP 白名单。

## npm test baseline

无 backend 改动 — 422 / 0 fail / 1 skip 不变。

## Commits

| SHA | msg |
|-----|-----|
| (本 devlog) | docs: round 52 — wechat IP 白名单根因 + ops 修步骤 |

## follow-up

- 测下来 server IP 是否会变 (NAT 上游). 若会, 自动白名单同步脚本写到 R53
- 你加完 IP 后告诉我, 我 offline 跑 curl 真路径 verify
