-- Migration 003: audit log archive 表
-- Date: 2026-07-01
-- 用途：长期保留 admin 操作日志，>90d 移到 archive 表
-- schema 与 admin_operation_logs 相同 + destination 字段

CREATE TABLE IF NOT EXISTS `admin_operation_logs_archive` (
  `id` BIGINT UNSIGNED NOT NULL,
  `admin_openid` VARCHAR(64) NOT NULL,
  `action` VARCHAR(64) NOT NULL,
  `target_type` VARCHAR(32) DEFAULT NULL,
  `target_id` VARCHAR(64) DEFAULT NULL,
  `detail` JSON DEFAULT NULL,
  `ip` VARCHAR(64) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `archived_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_archived_time` (`archived_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='已归档的 admin 操作日志';
