-- 002-privacy-versions: 隐私 / 服务条款 版本 (Phase 8+ 法务文档)
-- Source: schema.sql (was inline), extracted to migrations/ for runner (R63)
CREATE TABLE IF NOT EXISTS `privacy_versions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `doc_type` ENUM('privacy', 'terms') NOT NULL,
  `version` VARCHAR(32) NOT NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `note` VARCHAR(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_doc_version` (`doc_type`, `version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='法务文档版本';

INSERT IGNORE INTO `privacy_versions` (`doc_type`, `version`, `note`) VALUES
  ('privacy', '2026-06-29', 'phase 7 initial'),
  ('terms',   '2026-06-29', 'phase 7 initial');