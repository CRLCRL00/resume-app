# Redis 持久化配置（AOF + RDB）

> Round 28 强化项 F — Redis persistence (AOF + RDB) + startup check.

## 为什么需要 AOF + RDB 同时启用？

Redis 提供两种持久化机制，**各有侧重**，生产环境建议同时启用：

| 维度 | RDB（快照） | AOF（追加日志） |
|---|---|---|
| 触发方式 | 定时 fork 子进程 dump | 每次写命令追加到文件 |
| 数据丢失 | 可能丢失最近一次快照之后的数据（分钟级窗口） | 默认 `everysec`，最多丢 1 秒数据 |
| 恢复速度 | **快**（直接加载二进制快照） | 慢（重放写命令） |
| 文件体积 | 小（紧凑二进制） | 大（每条写命令） |
| 适用场景 | 灾备 / 冷启动恢复 | 关键数据兜底 |

**AOF + RDB 同时启用 = 两全**：

- 启动恢复时优先用 AOF（数据更全），RDB 作为备份；
- AOF 文件损坏/丢失时，RDB 仍能恢复出大部分数据；
- 两者都启用不会冲突，Redis 内部有协调机制。

---

## 推荐生产 `redis.conf` 设置

```conf
# ---------- AOF ----------
appendonly yes
appendfsync everysec        # 平衡性能与数据安全；最坏丢 1s
# appendfsync always        # 最安全但性能差（不推荐）
# appendfsync no            # 最快但可能丢大量数据（不推荐）

# AOF 重写（避免文件无限膨胀）
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb

# ---------- RDB ----------
# 三档快照策略：
save 900 1                   # 900s 内至少 1 个 key 变更 → 快照
save 300 10                  # 300s 内至少 10 个 key 变更
save 60 10000                # 60s 内至少 10000 个 key 变更

# 快照文件名与压缩
dbfilename dump.rdb
rdbcompression yes
rdbchecksum yes

# ---------- 其它持久化相关 ----------
# 主从复制 & 故障恢复建议开启
# repl-backlog-size 1mb
# min-replicas-to-write 1
# min-replicas-max-lag 10
```

修改配置后需要 `redis-cli SHUTDOWN NOSAVE` + 重启，或发送 `CONFIG SET ...` 热加载（但 `appendonly` 必须重启生效）。

---

## 验证持久化状态

```bash
# 1. 查看 AOF
redis-cli CONFIG GET appendonly
# 期望输出: 1) "appendonly"   2) "yes"

# 2. 查看 RDB save 策略
redis-cli CONFIG GET save
# 期望输出: 1) "save"   2) "900 1 300 10 60 10000"

# 3. 查看持久化运行状态
redis-cli INFO persistence
# 关键字段：
#   aof_enabled: 1
#   aof_last_bgrewrite_status: ok
#   aof_last_write_status: ok
#   rdb_last_bgsave_status: ok
#   rdb_last_bgsave_time_sec
```

---

## 在已运行的 prod Redis 上热开启

> 适用于**不能停机**的场景。注意：`appendonly yes` 必须重启才会真正创建 AOF 文件，但 `CONFIG SET save` 可热加载。

```bash
# 1. 设置 RDB 快照策略（即时生效，下次 bgsave 触发）
redis-cli CONFIG SET save "900 1 300 10 60 10000"

# 2. 设置 AOF 标志（仅标志位，下次重启才真正启用）
redis-cli CONFIG SET appendonly yes

# 3. 重启 Redis（必须）
redis-cli SHUTDOWN NOSAVE
systemctl restart redis     # 或你的进程管理器命令

# 4. 重启后验证 AOF 文件已生成
ls -la /var/lib/redis/appendonlydir/
# 应看到 appendonly.aof.* 文件
```

> **警告**：第 4 步前不要在生产写入压力高峰操作 — 启动时 AOF 重放会阻塞服务。

---

## 本项目自带的启动检查

后端启动时 `src/db/diagnose.js` 会调用 `checkRedisPersistence(redis)`：

- `CONFIG GET appendonly` → 期望 `yes`
- `CONFIG GET save` → 期望非空
- `INFO persistence` → 记录 `aof_enabled` / `rdb_last_bgsave_status`

如果检测到 AOF 或 RDB 未启用，会通过 `logger.warn` 输出一条带 `hint: prod-recommendation` 的告警（不会让进程退出，因为开发/test 环境本来就可能没启用）。

测试环境（`NODE_ENV=test`）会跳过此检查 — 测试用的 Redis 通常不允许 `CONFIG GET`。

`/api/health` 响应中也会暴露当前持久化配置：

```json
{
  "code": 0,
  "data": {
    "status": "ok",
    "redis": {
      "ok": true,
      "latencyMs": 1,
      "persistence": {
        "aof": "yes",
        "rdb": "900 1 300 10 60 10000"
      }
    }
  }
}
```

如果 Redis 服务端禁用了 `CONFIG GET`（如托管 Redis），`persistence.aof` / `rdb` 会显示为 `"unknown"`。

---

## 故障排查

| 现象 | 原因 | 解决 |
|---|---|---|
| `aof_last_write_status: err` | 磁盘满 / fsync 失败 | 清理磁盘、检查 I/O 调度 |
| `rdb_last_bgsave_status: err` | 同上 | 同上 |
| AOF 文件无限膨胀 | `auto-aof-rewrite-percentage` 太高 / 没设置 | 调小阈值；手动 `BGREWRITEAOF` |
| 启动恢复极慢 | AOF 文件太大 | `BGREWRITEAOF` 后重启；或切回 RDB-only 评估 |
| `/api/health` 显示 `persistence.aof: unknown` | 托管 Redis 禁用了 `CONFIG GET` | 联系平台方；或自托管 Redis |

---

## 参考

- [Redis Persistence — 官方文档](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
- [Redis APPEND ONLY FILE FAQ](https://redis.io/docs/latest/develop/interact/programmability/)
- 本仓库：`backend/src/db/redisCheck.js`、`backend/src/routes/health.js`、`backend/src/db/diagnose.js`