CREATE TABLE IF NOT EXISTS `alerts_dead_letter` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `url` VARCHAR(512) NOT NULL,
  `payload` JSON NOT NULL,
  `last_status` INT DEFAULT NULL,
  `last_error` TEXT,
  `attempts` SMALLINT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;