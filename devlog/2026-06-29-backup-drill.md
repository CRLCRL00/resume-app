# 备份真演练 — 2026-06-29

## 演练摘要

| 项 | 数值 |
|----|------|
| 时间 | 2026-06-29 12:44 (UTC+8) |
| dump 文件大小 | 16K |
| 恢复 schema | resume_app_test |
| 验证方式 | 7 张表 COUNT(*) diff |
| 结果 | ✅ DRILL OK |

## 7 张表行数

| 表 | 生产 | 恢复 | diff |
|----|------|------|------|
| users | 2 | 2 | 0 |
| resumes | 0 | 0 | 0 |
| jobs_online | 20 | 20 | 0 |
| matches | 0 | 0 | 0 |
| admins | 1 | 1 | 0 |
| prompts | 2 | 2 | 0 |
| admin_logs | 0 | 0 | 0 |

## 演练命令

1. `mysqldump -u root -pResumeApp@2026 --single-transaction --routines --triggers resume_app > backup.sql`
2. `CREATE DATABASE resume_app_test`
3. `mysql resume_app_test < backup.sql`
4. `SELECT COUNT(*)` 逐表对比
5. `diff before.txt after.txt` → DRILL OK
6. `DROP DATABASE resume_app_test`

## 教训

- mysqldump 加 `--single-transaction` 避免锁表（InnoDB 友好）
- 加 `--routines --triggers` 确保函数和触发器也备份（虽然当前 schema 没用）
- 独立 schema `resume_app_test` 完全隔离生产，演练安全