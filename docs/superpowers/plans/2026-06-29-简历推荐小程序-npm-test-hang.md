# npm test Hang 修复落地计划

> 阶段：6+（上线打磨后）
> Spec：[2026-06-29-...-npm-test-hang-design.md](../specs/2026-06-29-简历推荐小程序-npm-test-hang-design.md)
> 决策方案：A+E+D 混合

## 一、核心目标

输出可直接落地的 `npm test` 卡顿问题修复执行计划，确保 `cd backend && npm test` 能在 30 秒内正常退出且全量用例通过，同时保持生产环境代码兼容性。

## 二、任务拆分

| 任务ID | 涉及文件/模块 | 执行动作 | 前置条件 |
|--------|---------------|----------|----------|
| T1 | `src/config/db.js` | 新增 `createPool()` 函数，保留默认 singleton 导出 | 无 |
| T2 | `src/config/redis.js` | 新增 `createRedis()` 函数，保留默认 singleton 导出；维持原有 error 监听逻辑 | 无 |
| T3 | `tests/helpers/db.js` | 新建文件，实现 `getPool`/`getRedis` 懒初始化、`cleanup` 生命周期管理函数 | T1、T2 |
| T4 | `package.json` | 修改 test 脚本，追加 `--test-force-exit` 参数 | 无 |
| T5 | `tests/service-matchService.test.js` | 1. 替换为 helper 管理 DB/Redis；2. 新增 beforeEach 清理 rateLimit 相关 key；3. test.after 替换为 cleanup | T3 |
| T6 | 15+ 测试文件 | 1. 替换 DB/Redis 引入方式为 helper；2. 新增/替换 test.after 为 cleanup；3. 移除直接调用 singleton 的 end/quit 逻辑 | T3 |
| T7 | `README.md` | 新增 Node 版本要求（≥22），说明 `--test-force-exit` 兼容性 | T4 |

## 三、时间节点

| 阶段 | 时间窗口 | 核心产出 | 验证方式 |
|------|----------|----------|----------|
| 开发阶段 | D1 | T1-T4 基础文件修改 | 本地验证文件语法无报错，helper 文件可正常引入 |
| 适配阶段 | D2 | T5-T6 所有测试文件改造 | 单文件测试可独立运行通过 |
| 验收阶段 | D3 上半 | 全量测试跑通，文档补充 | 见下方验收脚本 |
| 复盘阶段 | D3 下半 | 落地总结，风险记录 | 重复3次全量测试 |

## 四、交付物

1. 代码改动包：所有文件修改/新建
2. 验收测试报告：单文件、rateLimit 文件、matchService、全量耗时 & 通过率
3. 版本兼容说明：README.md 中 Node 版本要求
4. 风险台账：mysql2/redis 兼容性、Node 版本依赖风险缓解

## 五、验证闭环

### 本地开发中

```bash
# 基础文件语法
node -c src/config/db.js
node -c src/config/redis.js
node -c tests/helpers/db.js

# 单文件改造有效性
node --test tests/health.test.js
node --test tests/service-matchService.test.js
```

### 验收

```bash
cd backend
# 1. 基准单文件
node --test tests/health.test.js      # <5s 通过
# 2. rateLimit 核心
node --test tests/service-rateLimit.test.js  # <5s 通过
# 3. matchService（rateLimit 修复验证）
node --test tests/service-matchService.test.js  # <12s, 5/5
# 4. 全量
time npm test                         # <30s, exit 0
# 5. 稳定
for i in 1 2 3; do time npm test; done  # 3次均 <30s
```

## 六、风险兜底

| 风险点 | 兜底措施 |
|--------|----------|
| `createPool` 挂载到 singleton 兼容性问题 | 临时拆分 `createPool` 到独立文件，不挂载到 singleton；本地 `npm test` 观察 |
| Node <22 不支持 `--test-force-exit` | 降级 `node --test tests/*.test.js && pkill -f node`；Node 20 环境验证 |
| helper 文件路径引入错误 | helper 顶部加路径校验日志；`node --test tests/resume-save.test.js` 观察 |

## 七、落地规则

1. 所有改动提交到 feature 分支，评审后合并
2. 合并前完成全量验收验证，保留测试日志
3. 合并后更新项目依赖文档（Node 版本要求）
4. CI 环境异常优先回滚并触发复盘

## 八、执行任务清单（按 spec 实现）

- [ ] T1: `src/config/db.js` 加 `createPool()`
- [ ] T2: `src/config/redis.js` 加 `createRedis()`
- [ ] T3: `tests/helpers/db.js` 新建
- [ ] T4: `package.json` `test` 加 `--test-force-exit`
- [ ] T5: `service-matchService.test.js` 改 helper + beforeEach
- [ ] T6: 15+ 测试文件改 helper
- [ ] T7: README.md Node ≥22 提示
- [ ] 验收：全量 ≤30s, 3 次稳定
