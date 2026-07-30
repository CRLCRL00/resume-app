# Phase 7 微信审核准备 落地计划

> Spec：[2026-06-29-...-phase7-audit-design.md](../specs/2026-06-29-简历推荐小程序-phase7-audit-design.md)
> 决策：A 全部（用户选）

## 一、目标

准备微信小程序审核材料 + 接入隐私合规。

## 二、任务

| ID | 文件 | 动作 | 前置 |
|----|------|------|------|
| T1 | `docs/legal/privacy.md` | 新建：隐私协议文本 | 无 |
| T2 | `docs/legal/terms.md` | 新建：服务条款文本 | 无 |
| T3 | `backend/src/services/legal.js` | 新建：fs.readFileSync 读 .md → JSON | T1/T2 |
| T4 | `backend/src/routes/legal.js` | 新建：`/privacy` + `/terms` 路由 | T3 |
| T5 | `backend/src/app.js` | 加 `app.use('/api/legal', ...)` | T4 |
| T6 | `backend/tests/route-legal.test.js` | 新建：2 测试 | T5 |
| T7 | `mini-program/components/privacy-popup/{wxml,js,wxss,json}` | 新建弹窗 | 无 |
| T8 | `mini-program/pages/legal/privacy/{wxml,js,wxss,json}` | 新建查看页 | T7 |
| T9 | `mini-program/pages/legal/terms/{wxml,js,wxss,json}` | 新建查看页 | T8 |
| T10 | `mini-program/app.js` | 改：onLaunch 检测 + 显示弹窗 | T7-T9 |
| T11 | `mini-program/app.json` | 改：加 legal 页面到 pages | T8/T9 |
| T12 | `mini-program/pages/index/index.wxml` 或 `app.wxss` | 加隐私 popup 引用 | T10 |
| T13 | `docs/audit/审核说明.md` | 新建：审核表填的说明 | 无 |
| T14 | `docs/audit/类目说明.md` | 新建：类目选择 + 资质 | 无 |
| T15 | `docs/audit/测试账号.md` | 新建：测试用账号 | 无 |
| T16 | `docs/audit/服务器域名白名单.md` | 新建：request/upload/download 域名 + IP/证书注意点 | 无 |

## 三、内容大纲

### privacy.md 段落
1. 信息收集：openid（微信）/ 简历表单（用户填）/ IP（鉴权）
2. 使用目的：JWT 鉴权 / 简历匹配 / 求职推荐
3. 存储：MySQL `resume_app` 库 + Redis 缓存
4. 第三方：仅 DeepSeek 用于简历内容生成 + 岗位匹配
5. 用户权利：删除 / 导出 / 撤回同意
6. 联系方式

### terms.md 段落
1. 服务内容：简历生成 + 岗位匹配推荐
2. 免责声明：匹配结果仅参考，非具体岗位承诺
3. 用户责任：填写真实信息；不发布虚假内容
4. 数据归属：用户拥有自己填写的简历；我们保留匿名统计权
5. 终止：用户可随时停止使用、要求删除
6. 修改通知：本协议变更将通过应用内公告通知

### 审核说明（200 字内）
```
本小程序为「智能简历助手」：用户简单填写基本信息后，由 AI 自动生成完整简历内容，
并基于用户期望（城市/薪资/技能）从岗位库中匹配推荐参考。
所有数据由用户主动提供，存储于自有服务器，仅用于匹配，不外传给第三方（除 DeepSeek 用于 AI 生成）。
不属于招聘中介、不收费用、不发布职位。
```

### 类目
- 服务类目：工具 - 效率
- 标签：简历、AI、求职助手

## 四、生命周期

```
小程序启动 → app.onLaunch → wx.getStorageSync('privacy_accepted')
                            ↓
                            ├─ true → 进主页
                            └─ false → 1s 后显示 privacy-popup
                                       ├─ 同意 → setStorage + 进主页
                                       └─ 拒绝 → wx.showModal 重申

设置/关于 → navigateTo /pages/legal/{privacy|terms}
         → onLoad: GET /api/legal/{x}
         → 后端 fs.readFileSync docs/legal/{x}.md → JSON
         → 小程序 setData 渲染
```

## 五、验证

### 后端
```bash
cd backend
node -c src/services/legal.js
node -c src/routes/legal.js
node --test --test-force-exit tests/route-legal.test.js  # 2/2 pass
curl -sk https://43.139.176.199/api/legal/privacy | head
curl -sk https://43.139.176.199/api/legal/terms | head

# 全量
for i in 1 2 3; do
  npm test 2>&1 | grep -E "^ℹ (pass|fail|tests)"
done
# 期望：3x 全 113/113 绿
```

### 小程序
- 微信开发者工具 → 预览 → 手动验证
- 首启弹窗 → 同意 → 设置页可重新查看
- 拒绝 → showModal 重申
- /pages/legal/{privacy,terms} 能加载后端内容

## 六、风险

| 风险 | 缓解 |
|------|------|
| IP + 自签证书在正式版被拒 | 体验版限定；上线前要备案 |
| 后端 fs 路径相对位置 | 加注释，dev vs prod 都好 work |
| 小程序组件 requireId 错 | 改用 WXML 节点直接引用 |
| 用户删 storage 后被重弹 | 设计如此（合规要求）|

## 七、执行清单

- [ ] T1-T2: 法律 md
- [ ] T3-T5: 后端服务 + 路由 + 接入
- [ ] T6: 测试
- [ ] T7-T12: 小程序 UI
- [ ] T13-T16: 审核文档
- [ ] 5x 全量 npm test 113/113
- [ ] server smoke test (legal GET 返回 200)
- [ ] commit + push (multi-batch)
- [ ] devlog

## 八、commit 分批

| 批 | commit | 文件 |
|----|--------|------|
| 1 | `docs(legal): privacy + terms Markdown` | T1-T2 |
| 2 | `feat(legal): backend /api/legal/{privacy,terms}` | T3-T6 |
| 3 | `feat(mini-program): privacy popup + legal pages` | T7-T12 |
| 4 | `docs(audit): 审核说明 + 类目 + 测试账号 + 域名白名单` | T13-T16 |
| 5 | `docs(devlog): Phase 7 verification` | devlog |
