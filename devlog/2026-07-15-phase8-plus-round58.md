# 开发日志 — 2026-07-15（Phase 8+ Round 58）

> 阶段：8+ Round 58 — Dashboard 全屏 1920×1080 大屏模式
> 前置：[2026-07-15-phase8-plus-round56.md](../devlog/2026-07-15-phase8-plus-round56.md)

## 起点

R56 留 follow-up: "1920×1080 dashboard full-screen view" (大屏可视化).
R57 audit 后 user 答"没有相结合" → 看出 R40-R57 17 commits 完整但 dashboard 不支持大屏 → 建议 R58 做全屏.

## 设计

### Mode 自动判定

| 设备 | 屏幕宽 | 行为 |
|---|---|---|
| 手机 (iOS/Android WeChat) | < 1024 | compact 模式 (原样) |
| 平板横屏 / PC WeChat / 电视墙 | ≥ 1024 | 自动进 fullscreen |

`wx.getSystemInfoSync().windowWidth >= 1024` → fullscreen.
用户也可手动 ⛶ 全屏 / 退出全屏 toggle.

### Fullscreen 行为

- 标题栏: "简历推荐 · 实时业务大屏" + 实时时钟 `HH:MM:SS` + 退出按钮
- 字号放大: KPI `60rpx → 96rpx` (+60%), block title `32rpx → 36rpx` (+13%), bar `22rpx → 26rpx` (+18%)
- 间距放大: padding `24 → 48rpx` (2x), gap `16 → 32rpx` (2x)
- 横屏锁定: `wx.setPageOrientation({orientation: 'landscape'})` (失败静默)
- 自动刷新: 每 **30s** 后台静默拉数据, 不闪 loading mask
- 时钟: 每 1s 更新
- 布局: `flex column + height:100vh + flex:1` → 各 block 自适应填满, 1920×1080 单屏铺满不滚

### Compact 行为 (保留)

- 原 R54 布局不变
- 屏幕宽 ≥ 1024 时右上角多一个 `⛶ 全屏` 浮动按钮 (固定位置, 不挡内容)
- 保留下拉刷新
- 无时钟 / 无自动刷新

## 改了什么

| 文件 | 改动 |
|---|---|
| `admin/pages/dashboard/dashboard.js` | + `enterFullscreen/exitFullscreen/toggleFullscreen`, `_tickTime/_startAutoRefresh/_clearTimers`, `_loadAllSilent` (后台静默刷新), mode data field |
| `admin/pages/dashboard/dashboard.wxml` | + `fs-header` (title + clock + exit), + `cp-toggle` (compact 模式浮动), `class="dashboard dashboard--{{mode}}"`, loading mask 仅 compact 模式显示 |
| `admin/pages/dashboard/dashboard.wxss` | + `.dashboard--fullscreen` modifier (12 处字号/间距放大), + `.fs-header/.fs-title/.fs-time/.fs-exit/.cp-toggle` 全屏专属样式 |
| `admin/pages/dashboard/dashboard.json` | + `disableScroll: true` (防全屏下系统手势滚动) |

## 关键代码

```js
// dashboard.js
const FULLSCREEN_REFRESH_MS = 30000;
const FULLSCREEN_MIN_WIDTH = 1024;

onLoad() {
  const sys = wx.getSystemInfoSync();
  const wide = (sys.windowWidth || sys.screenWidth || 0) >= FULLSCREEN_MIN_WIDTH;
  this.setData({ fullscreenAvailable: wide });
  if (wide) this.enterFullscreen();
  else this.loadAll();
},

enterFullscreen() {
  this.setData({ mode: 'fullscreen', loading: true, error: null });
  try { wx.setPageOrientation({ orientation: 'landscape' }); } catch (e) {}
  this._tickTime();
  this._clockTimer = setInterval(() => this._tickTime(), 1000);
  this.loadAll().then(() => this._startAutoRefresh());
},
```

```css
/* dashboard.wxss — fullscreen 1920×1080 */
.dashboard--fullscreen {
  padding: 32rpx 48rpx;
  display: flex; flex-direction: column;
  height: 100vh; box-sizing: border-box;
}
.dashboard--fullscreen .kpi-n { font-size: 96rpx; }   /* 60→96 */
.dashboard--fullscreen .block { flex: 1 1 auto; }     /* 自适应填满 */
.dashboard--fullscreen .fs-time { font-size: 56rpx; }  /* 实时时钟 */
```

## Verify

| 检查 | 结果 |
|---|---|
| `node -c dashboard.js` | ✅ JS_OK |
| `JSON.parse(dashboard.json)` | ✅ JSON_OK |
| wxml view 标签 | ✅ 65 opens / 65 closes balanced |
| git status | ✅ 4 files modified |

## 设计决策

| # | 决策 | 原因 |
|---|---|---|
| 1 | fullscreen 阈值 = 1024 px | 平板横屏最小宽度; < 1024 强制 compact |
| 2 | auto-refresh 30s | 大屏场景: 不打扰用户; 同时 DB 5 endpoints 30s 内完成 |
| 3 | clock 1s tick | 大屏核心元素: 实时感 |
| 4 | 横屏锁失败静默 | 手机不支持 setPageOrientation; 不阻塞流程 |
| 5 | disableScroll 全局 | fullscreen 不应被系统手势滚; compact 用户可下拉刷新 (programmatic) |
| 6 | compact 模式保留 toggle 按钮 | 让用户能从紧凑切全屏 (反之亦然) |
| 7 | 静默刷新 vs loading mask | 大屏场景数据已显示; 静默更新更平滑 |

## 留 follow-up

| # | 项 | 谁 |
|---|---|----|
| 1 | 1920×1080 真机 / PC WeChat preview 验证全屏效果 | user (mp IDE 真机) |
| 2 | 真 admin openid → 解锁 dashboard 5 endpoint 数据闭环 | user |
| 3 | tunnel 切换 Pro / ngrok → 解锁 mp 真机联调 | user |
| 4 | dashboard 加自动切换布局 (compact ↔ wide 监听屏幕旋转) | R59 follow-up |

## baseline

mini-program tests: 47 / 0 fail (sentry-config 8 + project-config 6 + format/admin format/match format/admin validate/loading/validate).
未引入新依赖, 无 backend 改动.

## Commits

| SHA | msg |
|-----|-----|
| (本 devlog + 4 files) | feat(admin/dashboard): R58 — 全屏 1920×1080 大屏 + 30s auto-refresh + live clock |