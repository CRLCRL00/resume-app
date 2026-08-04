-- 006-industries-title-index: jobs 表加 idx_title_created 复合索引
-- 用途: industries 路由 GROUP BY title + recent_new_jobs 子查询 WHERE title
--       当前 schema.sql 没 title 索引 → 外层 GROUP BY + 子查询全表扫描
-- 复合索引 (title, created_at): 覆盖 GROUP BY title + 子查询 WHERE title + 范围 created_at
-- 幂等: idx_title_created 可能已存在, 用 information_schema.STATISTICS 判断跳过
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'jobs'
    AND INDEX_NAME = 'idx_title_created'
);
SET @sql := IF(@idx_exists = 0,
  'ALTER TABLE `jobs` ADD KEY `idx_title_created` (`title`, `created_at`)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;