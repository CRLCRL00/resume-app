# Phase 7 微信审核准备 设计

> 阶段：7（微信小程序审核准备 / 体验版上线）
> 前置：[2026-06-29-llm-test-mock-fix.md](../../devlog/2026-06-29-llm-test-mock-fix.md)
> 决策：A 全部（用户选）

## 目标

准备微信小程序审核材料 + 接入用户隐私合规，实现：
1. 后端 `GET /api/legal/{privacy,terms}` 接口（小程序 read）
2. 小程序首次启动 **隐私协议弹窗**（强制）
3. 小程序设置页**查看/重新同意**协议
4. 审核材料（隐私协议/服务条款文案 + 审核说明 + 类目）
5. 测试账号准备（admin + 普通用户）
6. 服务类目选定 + 资质说明

## 服务类目决策

**工具 - 效率**（不选"招聘"）

| 候选 | 问题 |
|------|------|
| 工具 / 效率 | ✅ 无特殊资质，最快过审 |
| 招聘 / 求职 | ❌ 需《人力资源服务许可证》 |
| 教育 / 职业培训 | ❌ 边界模糊，重审核 |

文案：自我介绍为 "AI 智能简历助手，提供简历内容生成 + 岗位匹配参考"，不算 "直接提供招聘服务"。

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│ 微信小程序审核侧                                            │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐                │
│  │ 隐私协议弹窗 │  │ 服务条款页 │  │ 审核说明文本  │             │
│  └──────────┘  └──────────┘  └────────────┘                │
└────────────┬───────────────────┬────────────────────────────┘
             │                   │
             ▼                   ▼
┌─────────────────────────┐  ┌──────────────────────────────┐
│ app.js                  │  │ 后端 /api/legal/{privacy,    │
│  onLaunch               │  │ terms} (GET, 无鉴权)          │
│   ↓ getStorageSync      │  │   ↑                          │
│   ↓ 无 → 弹 privacy     │  │   docs/legal/{...}.md 编译   │
│   ↓ 同意 → setStorage   │  │   转 JSON                     │
│   ↓ 拒绝 → mini.exit    │  └──────────────────────────────┘
└─────────────────────────┘
```

## 组件

### 1. 法律文档（`docs/legal/`）

| 文件 | 内容主题 |
|------|----------|
| `privacy.md` | 收集微信 openid/简历表单/IP；用于鉴权+匹配；MySQL 存；DeepSeek API |
| `terms.md` | 服务内容；免责：匹配结果仅参考；用户数据归属；终止条件 |

### 2. 后端服务

**`backend/src/services/legal.js`**
```js
const fs = require('fs');
const path = require('path');

const PRIVACY = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'docs', 'legal', 'privacy.md'),
  'utf8'
);
const TERMS = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'docs', 'legal', 'terms.md'),
  'utf8'
);

function getPrivacy() {
  return { title: '隐私协议', content: PRIVACY, updated_at: '2026-06-29' };
}
function getTerms() {
  return { title: '服务条款', content: TERMS, updated_at: '2026-06-29' };
}

module.exports = { getPrivacy, getTerms };
```

> **注**：doc fs read 在 module load。生产可加 watch + cache。审核 scope 先简单。

**`backend/src/routes/legal.js`**
```js
const express = require('express');
const router = express.Router();
const legal = require('../services/legal');

router.get('/privacy', (req, res) => {
  res.json({ code: 0, data: legal.getPrivacy() });
});

router.get('/terms', (req, res) => {
  res.json({ code: 0, data: legal.getTerms() });
});

module.exports = router;
```

**`backend/src/app.js`** 加：
```js
app.use('/api/legal', require('./routes/legal'));
```

### 3. 测试

**`backend/tests/route-legal.test.js`**
```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');

test('GET /api/legal/privacy returns content', async () => {
  const res = await request(createApp()).get('/api/legal/privacy');
  assert.equal(res.status, 200);
  assert.equal(res.body.code, 0);
  assert.match(res.body.data.title, /隐私/);
  assert.ok(res.body.data.content.length > 100);
});

test('GET /api/legal/terms returns content', async () => {
  const res = await request(createApp()).get('/api/legal/terms');
  assert.equal(res.status, 200);
  assert.match(res.body.data.title, /服务/);
  assert.ok(res.body.data.content.length > 100);
});
```

### 4. 小程序组件：`mini-program/components/privacy-popup/`

**WXML**:
```xml
<view class="popup-mask" wx:if="{{visible}}">
  <view class="popup-card">
    <view class="popup-title">用户协议与隐私协议</view>
    <view class="popup-content">
      欢迎使用「智能简历助手」。在使用前，请阅读并同意
      <text class="link" bindtap="onTapPrivacy">《隐私协议》</text>
      与
      <text class="link" bindtap="onTapTerms">《服务条款》</text>
      。
      我们仅收集简历匹配所需的最小信息（微信 openid、您填写的简历、IP），
      数据存储在自有 MySQL，第三方调用仅 DeepSeek（用于简历生成与岗位匹配）。
    </view>
    <view class="popup-actions">
      <button class="btn-reject" bindtap="onReject">不同意并退出</button>
      <button class="btn-accept" bindtap="onAccept">同意并继续</button>
    </view>
  </view>
</view>
```

**JS**:
```js
Component({
  data: { visible: true },
  methods: {
    onTapPrivacy() { wx.navigateTo({ url: '/pages/legal/privacy' }); },
    onTapTerms() { wx.navigateTo({ url: '/pages/legal/terms' }); },
    onAccept() {
      wx.setStorageSync('privacy_accepted', true);
      wx.setStorageSync('privacy_accepted_at', Date.now());
      this.setData({ visible: false });
      this.triggerEvent('accepted');
    },
    onReject() {
      wx.showModal({
        title: '需同意',
        content: '不同意协议将无法使用本小程序。',
        showCancel: false,
        success: () => {
          // 用户必须接受才能继续
        },
      });
    },
  },
});
```

### 5. 小程序 app.js 集成首启弹窗

```js
App({
  onLaunch() {
    const accepted = wx.getStorageSync('privacy_accepted');
    this.globalData.privacyAccepted = !!accepted;
    if (!accepted) {
      // 延迟显示让首页先加载
      setTimeout(() => {
        this.popPrivacy();
      }, 500);
    }
  },
  popPrivacy() {
    // 用 page-level selector 显示 popup
    const pages = getCurrentPages();
    const cur = pages[pages.length - 1];
    cur.selectComponent('#privacy-popup').show();
  },
});
```

### 6. 小程序页面：`pages/legal/{privacy,terms}/`

每个页面 .js 调 `wx.request` 拉 `/api/legal/{privacy|terms}`，渲染 markdown（用 `<text>` + `\n` 转 `<br/>` 或简单分段）。

**`pages/legal/privacy/privacy.js`**:
```js
Page({
  data: { title: '', content: '', loading: true },
  onLoad() {
    wx.request({
      url: 'https://43.139.176.199/api/legal/privacy',
      success: (res) => {
        if (res.data.code === 0) {
          this.setData({
            title: res.data.data.title,
            content: res.data.data.content,
            loading: false,
          });
        }
      },
    });
  },
});
```

### 7. 审核材料

**`docs/audit/审核说明.md`** (填表用，120-200 字):
```
本小程序为「智能简历助手」：用户简单填写基本信息后，由 AI 自动生成完整简历内容，
并基于用户期望（城市/薪资/技能）从岗位库中匹配推荐参考。
所有数据由用户主动提供，存储于自有服务器，仅用于匹配，不外传给第三方（除 DeepSeek 用于 AI 生成）。
不属于招聘中介、不收费用、不发布职位。
```

**`docs/audit/类目说明.md`**:
- 服务类目：工具 - 效率
- 标签：简历、AI、求职助手
- icon：上传尺寸 144x144 / 圆形或方形
- 名称：智能简历助手

**`docs/audit/测试账号.md`**:
- Admin: openid 已在 admins 表（用户自助注册）
- 普通用户：留空（小程序无登录门槛，wx.login 即用）
- 后端 URL：https://43.139.176.199 (自签证书，注明)

### 8. 服务器域名白名单

填在微信小程序管理后台 → 开发 → 开发设置 → 服务器域名：
```
request 合法域名: https://43.139.176.199
uploadFile 合法域名: https://43.139.176.199
downloadFile 合法域名: https://43.139.176.199
```

> **已知限制**：43.139.176.199 是 IP + 自签证书，**正式上线需**：
> 1. 备案域名（如 crlcrl.com）
> 2. CA 证书（Let's Encrypt）
> 3. 备案后 30 天才能上线（小程序规则）
>
> 当前可走 **体验版 / 开发版** 不需备案。

## 数据流

```
小程序启动
  ↓
app.onLaunch
  ↓ 检查 storage
  ├─ 已有 → 进主页
  └─ 无 → 显示 privacy-popup
       ├─ 点同意 → setStorage + 进主页
       └─ 点拒绝 → showModal 重申，不退出（用户体验）

用户打开设置 / 关于
  ↓
wx.navigateTo /pages/legal/{privacy|terms}
  ↓
onLoad: wx.request GET /api/legal/{x}
  ↓
后端: 读 docs/legal/{x}.md → JSON
  ↓
小程序: setData 渲染

审核员扫码:
  ↓
看审核说明 → 进体验版 → 用 wx.login → 看隐私弹窗 → 同意 → 进首页
```

## 错误处理

| 场景 | 行为 |
|------|------|
| `/api/legal/privacy` 500 | 弹窗 + toast「服务暂不可用」 |
| 小程序 wx.request 失败 | 设置页显示「网络错误」+ 重试按钮 |
| 协议 .md 缺失 | 后端 fail 启动（fail-fast） |
| 同意后 storage 被清 | 下次启动重新弹（设计如此） |
| 拒绝协议 → 重弹 | 用户每次启动必看到协议（合规）|

## 测试（验收）

**后端**：
- `node --test tests/route-legal.test.js` → 2/2 pass
- `npm test` → 111 → 113/113 pass（+2 来自 legal），5x 稳定

**小程序端**：
- 微信开发者工具预览：手动验证弹窗 + 设置页跳转
- 无自动化测试（小程序测框架引入成本 > 一次手动）

**审核填表**：
- 类目选"工具 - 效率"
- 审核说明 200 字内
- 测试账号：admin 标 openid

## 决策记录

| # | 决策 | 原因 |
|---|------|------|
| 1 | A 全部（用户选） | 一次到位 |
| 2 | 服务类目 = 工具 - 效率 | 无需招聘资质，最快过审 |
| 3 | 用户数据存储自有 MySQL + Redis | 合规：用户数据自主权 |
| 4 | 第三方仅 DeepSeek | 透明 + 必要 |
| 5 | 拒绝协议 = 重申（不退出）| 微信合规要求强制同意 |
| 6 | 协议文案 md → backend fs.read | 后端单一来源，便于更新 |
| 7 | 小程序不写单测，仅手动 + 后端单测 | UI 测试成本 > 收益 |
| 8 | 当前用 IP + 自签证书，仅体验版 | 正式上线需 ICP 备案 + CA cert |

## 不做

- 不做用户数据导出 API（GDPR 范围，超审核 scope）
- 不做账户删除（用户自助清 OpenID + 后台清理，超 scope）
- 不做备案 / 域名购买（用户后续 Phase 8+）
- 不做小程序 UI 测试（手动即可）
- 不做管理员 web 端管理协议（用户可手动改 docs/legal/*.md）

## 风险

| 风险 | 缓解 |
|------|------|
| 协议更新后用户不重读 | 设置页有"重新同意"按钮 |
| 自签证书 + IP 在正式版被拒 | 注明体验版限定；上线前需备案 |
| DeepSeek API 暂不可用 → 简历生成失败 | 已是 Phase 5+ 现状，影响使用不影响审核 |
| 后端路径 `../../../docs` | 加注释说明；生产路径可改 ENV |

## 验收标清单

完成后给出：
- 后端：2 文件 + 1 测试 + commit + push
- 小程序：3 文件（privacy-popup + 2 pages）+ commit + push
- 文档：2 法律 md + 3 审核 md + commit + push
- 5x `npm test` 全绿
- devlog
