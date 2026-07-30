-- 028-client-errors: 小程序前端运行时错误（App.onError / wx.onError / request_fail）
-- Source: schema.sql (was inline), extracted to migrations/ for runner (R63)
CREATE TABLE IF NOT EXISTS `client_errors` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `openid` VARCHAR(64) DEFAULT NULL,
  `appid` VARCHAR(64) DEFAULT 'wx3c0c93a02f5d2356',
  `version` VARCHAR(32) DEFAULT NULL,
  `platform` VARCHAR(32) DEFAULT NULL,
  `error_type` VARCHAR(64) DEFAULT NULL COMMENT 'app_onerror | wx_onerror | request_fail | unhandled_rejection',
  `message` TEXT,
  `stack` TEXT,
  `url` VARCHAR(512) DEFAULT NULL,
  `metadata` JSON DEFAULT NULL COMMENT 'statusCode, requestId 等扩展上下文',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_openid_created` (`openid`, `created_at`),
  KEY `idx_type_created` (`error_type`, `created_at`),
  KEY `idx_appid_version` (`appid`, `version`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;