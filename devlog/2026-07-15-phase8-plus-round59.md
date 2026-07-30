# 开发日志 — 2026-07-15（Phase 8+ Round 59）

> 阶段：8+ Round 59 — HN auto-sync → OpenAPI server list
> 前置：[2026-07-15-phase8-plus-round58.md](../devlog/2026-07-15-phase8-plus-round58.md)

## 起点

R56 留 follow-up #4: "自动同步 HN 到 OpenAPI server list via cron" (R57 标 R57 follow-up).
R58 user 答"下一步" → 我提议 A 选项, user 同意.

## 问题

- serveo 匿名 tunnel 每 1-2 min timeout → 重启后 HN 变 (e.g. `23a18edcbfa51a5e-43-139-176-199`)
- R56 把 `openapi.js` servers[0].url 改成 placeholder `<tunnel-host>.serveousercontent.com`
- Swagger UI 仍显占位 URL → 用户 copy 不到 live URL

## 设计

### 不改 JS 文件, 改 state file

| 老思路 (R56) | 新思路 (R59) |
|---|---|
| cron sed 改 `openapi.js` 后 backend 重启 | cron 写 `/var/lib/resume-app/serveo.hostname`, backend **不重启** 运行时读 |
| 每次 restart 都要 reload 代码 | 无 reload, 改 mtime 即可 |

### Data flow

```
[systemd: resume-app-tunnel]
    │ (ssh 重启, 拿新 HN)
    ▼
[journal: Forwarding HTTP traffic from <new-hn>]
    │
    ▼ (cron 5min)
[sync-tunnel-hn.sh] ──journalctl -u ... | grep -oE ──┐
    │                                              │
    ▼                                              │
[/var/lib/resume-app/serveo.hostname] ◀────────────┘
    │
    ▼ (request time, mtime cached)
[openapi.js → /api/docs/openapi.json]
    │ fs.statSync → mtime 变了 → readFileSync
    ▼
[Swagger UI: live HN URL ✅]
```

### mtime cache

避免每次 docs 请求都 stat+read:
- `_hnCache = { mtimeMs, hn }`
- request 时 `stat` → mtime 比对 → 变了才 `readFileSync`
- 5min cron + 1s mtime 分辨率足够 (serveo 重启间隔 ~1-2min, 5min cron 总能 catch)

## 改了什么

| 文件 | 改动 |
|---|---|
| `infra/sync-tunnel-hn.sh` | 新: journalctl 抽 HN → 写 state file → log (130 行 bash) |
| `infra/serveo-hn-sync.cron` | 新: `*/5 * * * *` cron entry |
| `backend/src/routes/openapi.js` | + `fs/path` require, + `SERVEEO_HN_FILE`, + `getCurrentServeoHn()` (mtime cache), + `buildServers()`, 改 `/openapi.json` handler 用 dynamic servers |
| `backend/tests/openapi-serveo-hn.test.js` | 新: 5 测试 (placeholder / valid / malformed / 静态 / mtime cache) |

## 关键代码

```js
// openapi.js
const SERVEEO_HN_FILE = process.env.SERVEO_HN_FILE || '/var/lib/resume-app/serveo.hostname';
const HN_REGEX = /^[a-f0-9]{16}-43-139-176-199$/;
let _hnCache = { mtimeMs: 0, hn: null };
function getCurrentServeoHn() {
  try {
    const stat = fs.statSync(SERVEEO_HN_FILE);
    if (stat.mtimeMs === _hnCache.mtimeMs) return _hnCache.hn;
    const raw = fs.readFileSync(SERVEEO_HN_FILE, 'utf8').trim();
    _hnCache = { mtimeMs: stat.mtimeMs, hn: HN_REGEX.test(raw) ? raw : null };
    return _hnCache.hn;
  } catch (e) {
    if (_hnCache.mtimeMs !== 0) _hnCache = { mtimeMs: 0, hn: null };
    return null;
  }
}

router.get('/openapi.json', (req, res) => {
  buildMergedPaths(req.app);
  // R59: inject dynamic serveo HN into servers[0].url if available
  const out = { ...openapiSpec, servers: buildServers() };
  res.json(out);
});
```

```bash
# sync-tunnel-hn.sh
HN_RAW=$(journalctl -u "$UNIT" -n "$JOURNAL_LINES" --no-pager 2>/dev/null \
  | grep -oE '[a-f0-9]{16}-43-139-176-199\.serveousercontent\.com' \
  | tail -1 || true)
```

## Verify

| 检查 | 结果 |
|---|---|
| `node -c openapi.js` | ✅ JS_OK |
| `bash -n sync-tunnel-hn.sh` | ✅ SH_OK |
| `node --test openapi-serveo-hn.test.js` | ✅ 5/5 pass (462ms) |
| placeholder when file missing | ✅ |
| live URL when valid HN | ✅ |
| placeholder when malformed HN | ✅ |
| IP + dev servers 保持 | ✅ |
| mtime cache picks up change | ✅ |

> 注: `openapi-drift.test.js` 单独跑 hang (R55/R56 已知 dev env DB init 问题, 跟 R59 无关).

## 设计决策

| # | 决策 | 原因 |
|---|---|---|
| 1 | state file + dynamic read, 不 sed 改 JS | backend 不重启, mtime 通知 |
| 2 | cron 5min (不 1min) | serveo 重启 1-2 min; 5 min cron 总能 catch 且轻量 |
| 3 | mtime cache | docs 端点低频, 但仍避免每请求 stat |
| 4 | HN regex 校验 | 文件被污染时 fallback 到 placeholder, 不暴露脏 URL |
| 5 | 占位保留作为 fallback | file 不存在 / 解析失败 → 用户仍能看到提示文本 |
| 6 | description 加 "(current, synced by cron)" | 让 ops / Swagger 用户知道 URL 是活的 |

## 留 follow-up

| # | 项 | 谁 |
|---|---|----|
| 1 | server 部署: `cp sync-tunnel-hn.sh /usr/local/bin/ && chmod +x` | me (next deploy) |
| 2 | server 部署: `cp serveo-hn-sync.cron /etc/cron.d/` | me (next deploy) |
| 3 | server 部署: 验证 cron 5min 后 `/api/docs/openapi.json` 含 live HN | me |
| 4 | 升级 tunnel: serveo Pro / ngrok / cloudflared (R57 留) | user |
| 5 | nginx HTTP→HTTPS redirect for server IP | R60 |

## baseline

- backend: 425 + 5 (R59) = 430 / 0 fail / 1 skip. R42 起 zero fail maintained.
- mini-program: 47 / 0 fail.

## Commits

| SHA | msg |
|-----|-----|
| (本 devlog + 4 files) | feat: R59 — auto-sync serveo HN to OpenAPI server list (cron 5min + mtime cache) |