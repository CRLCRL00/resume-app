-- 004-admin-audit: admin 写操作审计
CREATE TABLE IF NOT EXISTS `admin_audit` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `openid` VARCHAR(64) NOT NULL,
  `action` VARCHAR(64) NOT NULL,
  `target_type` VARCHAR(32) NOT NULL,
  `target_id` VARCHAR(64) DEFAULT NULL,
  `method` VARCHAR(8) NOT NULL,
  `path` VARCHAR(255) NOT NULL,
  `ip` VARCHAR(45) DEFAULT NULL,
  `status` SMALLINT DEFAULT NULL,
  `request_id` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_openid_created` (`openid`, `created_at`),
  KEY `idx_target` (`target_type`, `target_id`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;