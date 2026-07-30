# Mini-Program Page Convention (avoid 微信 loader confusion)

> 调试 Phase 8 学到的踩坑笔记。

## 1. 微信支持的两种 page 结构

微信对单 page 的物理结构支持两种风格，**项目内只能用一种**：

### 风格 A：Flat（推荐）
```
pages/legal/
  privacy.js
  privacy.json
  privacy.wxml
  privacy.wxss
```
- 注册：`"pages/legal/privacy"`
- 4 个文件同层，不分子目录

### 风格 B：Nested
```
pages/legal/
  privacy/
    privacy.js
    privacy.json
    privacy.wxml
    privacy.wxss
```
- 注册：`"pages/legal/privacy"`
- 文件在同名子目录

## 2. 致命错误：两种风格混用

如果同时存在：

```
pages/legal/
  privacy.js          ← flat (rogue)
  privacy.wxml        ← flat (rogue)
  privacy/            ← nested (正确)
    privacy.js
    privacy.json
    privacy.wxml
    privacy.wxss
```

→ 微信 loader 抛：`rootCompPath=... not found` + `Component is not found in path "wx://not-found"`

实际页面找不到，**IDE 编译过、真机却挂**。

## 3. 当前项目使用哪种风格？

我们项目里：

| Page | 风格 |
|------|------|
| pages/index | Flat (4 files at pages/index/) |
| pages/form | Flat |
| pages/preview | Flat |
| pages/legal/privacy | **Nested** (在 pages/legal/privacy/) |
| pages/legal/terms | **Nested** |
| pages/me | Flat |
| pages/match/list | Flat (在 pages/match/) |
| pages/match/detail | Flat (在 pages/match/) |

**项目混用了两种风格**（虽然各 page 自洽）。

## 4. 临时 fix

删除 rogue 文件，确保每个 page 只有一种结构：
- legal/privacy → 只保 nested（4 文件在子目录）
- legal/terms → 同上
- match → flat（不动）

## 5. 长期 fix（建议）

统一为一种风格。考虑到：
- 当前 7/8 page 是 flat
- 微信 loader 对 flat 更直接（少一次目录跳转）

建议**全改为 flat**：
```
pages/legal/privacy.{js,json,wxml,wxss}
pages/legal/terms.{js,json,wxml,wxss}
```

需要 8 文件移动（本 dev cycle 后做）。

## 6. 防呆

跑 `bash scripts/check-rogue-files.sh`：
- 扫 `pages/*/` 下子目录结构
- 如同时存在 `pages/X.js` 和 `pages/X/X.js` → 报错

## 7. 创建 page 的安全做法

1. cd 到 `pages/X/` 目录
2. Write 工具调用指定完整路径：`pages/X/X.js`（flat）或 `pages/X/X/X.js`（nested）
3. app.json 注册 `"pages/X/X"` 
4. **再次 ls 验证**：`ls pages/X/` 或 `ls pages/X/X/`

不要靠自动判断，按文件结构 plan 决定。

## 8. 子 agent 写文件建议

如果 dispatch subagent 创建 page：
- spec 必须明确指定文件结构（flat or nested）
- 在 subagent prompt 显式说「先建 `pages/X/X/` 子目录，再写 `pages/X/X/X.js`」
- 加 verify step：`ls -la pages/X/ && cat pages/X/X/X.json`
