-- 005-audit-result: admin_operation_logs 加 result 列 + 索引
-- Round audit-filter：result 用于标记 success/failure，索引 for filter perf
-- 幂等：idx_action_time 可能已存在（schema.sql 默认建），用 information_schema 判断跳过
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'admin_operation_logs'
    AND COLUMN_NAME = 'result'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE admin_operation_logs ADD COLUMN `result` ENUM(''success'',''failure'',''unknown'') NOT NULL DEFAULT ''unknown'' AFTER `detail`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'admin_operation_logs'
    AND INDEX_NAME = 'idx_result'
);
SET @sql := IF(@idx_exists = 0,
  'ALTER TABLE admin_operation_logs ADD KEY `idx_result` (`result`)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT IGNORE INTO `schema_migrations` (`name`) VALUES ('005-audit-result');
