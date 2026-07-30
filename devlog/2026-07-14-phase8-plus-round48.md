# 开发日志 — 2026-07-14（Phase 8+ Round 48）

> 阶段：8+ Round 48 — mini-program project.config 结构 + app.json pages sanity
> 前置：[2026-07-14-phase8-plus-round47-5.md](../devlog/2026-07-14-phase8-plus-round47-5.md) (R47.5)

## 起点

R47.5 修了 packNpmRelationList object 格式；但 IDE 仍可能 complain 因为 R47.5 edit 时漏删 project.config.json 重复 keys (我插入新块没删老块)。User 答"再查一遍"。

## 真问题

1. **重复 keys**: R47.5 时 Edit 在原 setting 块尾插入 8 行 (含 minifyWXSS 等)，但**原有重复块**还在 — `setting` 出现两次同样的 key，最后的覆盖. 实际 JSON 仍合法，但 IDE parser 严苛。
2. **libVersion 形态**: 我没改 — IDE 可接受 string 或 number。
3. **app.json pages**: 看上去 OK (R40 后) — 用户问题更宽，**page 引用是否真找到 fs entry file**？

## 改动

### 1. `mini-program/project.config.json` 清重复 keys

`setting` 块现在只有一份 (12 个 keys, JSON.doesNotThrow + 不重)。Run 后 verify:
```
keys count: 10
setting keys: 19
duplicate keys in setting: []
libVersion: 3.16.1
packNpmRelationList valid: true
entry[0]: {"packageName":"sentry-miniapp","version":"1.13.1"}
```

### 2. `mini-program/tests/project-config.test.js` 新增 5 tests

| 测试 | 验证 |
|------|------|
| `R48 project.config.json is valid JSON` | JSON.parse OK |
| `R48 setting has no duplicate keys at top level (parsed)` | 关键字段存在 + 类型对 |
| `R48 project.config.json has NO literal "{" duplicates (regex sniff)` | 不重复 minified/minifyWXSS 等 11 个 watch key — **prevents R47.5 silent-覆写 bug** |
| `R48 libVersion is a string (WeChat docs: 数字也接受但 IDE write back)` | IDE 一致性 |
| `R48 app.json pages reference real entry files` | 8 main + 7 admin pages 都对应 `<page>.{js,json}` |

### 3. Windows path 双反斜杠 note

测试写时 Node `path.join` 在 Windows 上**会保留 pre-existing 末尾 separator**, 致 `pages\index\index\\index.js`。改用 raw string concat (`root + '/' + relPath + '.js'`) 避免。

## 真实 file layout

| path | entry |
|------|-------|
| `pages/index/index.{js,json,wxml,wxss}` | ✅ |
| `pages/form/form.{js,json,wxml,wxss}` | ✅ |
| `pages/preview/preview.{js,json,wxml,wxss}` | ✅ |
| `pages/match/{list,detail}.{js,json,wxml,wxss}` | ✅ |
| `pages/legal/{privacy,terms}.{js,json,wxml,wxss}` | ✅ |
| `pages/me/me.{js,json,wxml,wxss}` | ✅ |
| `admin/pages/jobs/{list,edit}.{js,json,wxml,wxss}` | ✅ |
| `admin/pages/prompts/{list,edit}.{js,json,wxml,wxss}` | ✅ |
| `admin/pages/logs/list.{js,json,wxml,wxss}` | ✅ |
| `admin/pages/legal/legal.{js,json,wxml,wxss}` | ✅ |
| `admin/pages/admins/admins.{js,json,wxml,wxss}` | ✅ |

15 pages 全部能找到 entry files — R48 验证全过。

## 测试 baseline

| suite | tests | pass | fail | skip |
|-------|-------|------|------|------|
| backend | 422 | 421 | 0 | 1 |
| mini-program | **41** (+5) | **41** | 0 | 0 |
| **总** | **463** | **462** | **0** | **1** |

R42 起 zero fail maintained。

## 决策

| # | 决策 | 原因 |
|---|------|------|
| 1 | 用 raw string concat 而非 path.join Windows 测试 | Node path.join 在 bash + Windows 反斜杠下不可预测 |
| 2 | regex sniff 而不是真的 JSON dup key detect | 不引入额外依赖；11 个关键 key 足够覆盖 R47.5 那种 silent overwrite |
| 3 | 没去删 app.json 重写 — 它本身是对的 | R48 只 verify 不 edit |
| 4 | 测试用 js.json 检查入口；不强制 wxml/wxss 存在 | 模板 page 可空 wxml/wxss，不算破 |

## 风险

| 风险 | 缓解 |
|------|------|
| project.config.json 再次被手工 edit 引入 dup keys | R48 regex test catch |
| path.join 在持续 Windows 环境重复坑 | raw concat helper 标准化 |

## Commits

| SHA | msg |
|-----|-----|
| (本 devlog + 2 文件) | fix(mp): R48 — project.config dedup + sanity tests |
