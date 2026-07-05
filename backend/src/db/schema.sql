-- 简历推荐小程序数据库结构
-- MySQL 8.0+, utf8mb4

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- 1. 用户表
CREATE TABLE IF NOT EXISTS `users` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `openid` VARCHAR(64) NOT NULL COMMENT '微信 openid',
  `unionid` VARCHAR(64) DEFAULT NULL COMMENT '微信 unionid',
  `nickname` VARCHAR(64) DEFAULT NULL COMMENT '昵称（前端可改）',
  `avatar_url` VARCHAR(512) DEFAULT NULL,
  `is_admin` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '冗余字段，权威在 admins 表',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `last_login_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_openid` (`openid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户';

-- 2. 简历表
CREATE TABLE IF NOT EXISTS `resumes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `content_md` MEDIUMTEXT NOT NULL COMMENT 'LLM 生成的 Markdown',
  `content_json` JSON DEFAULT NULL COMMENT '结构化字段（阶段 3 用）',
  `source_form` JSON NOT NULL COMMENT '用户原始表单',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '业务层唯一活动简历',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_active` (`user_id`, `is_active`),
  KEY `idx_user_created` (`user_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='简历历史';

-- 3. 岗位表
CREATE TABLE IF NOT EXISTS `jobs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(128) NOT NULL COMMENT '岗位名',
  `company` VARCHAR(128) NOT NULL COMMENT '公司名',
  `city` VARCHAR(64) NOT NULL,
  `salary_min` INT UNSIGNED NOT NULL COMMENT 'K/月',
  `salary_max` INT UNSIGNED NOT NULL COMMENT 'K/月',
  `degree_required` VARCHAR(16) NOT NULL DEFAULT '不限' COMMENT '不限/大专/本科/硕士/博士',
  `experience_required` VARCHAR(16) NOT NULL DEFAULT '不限' COMMENT '不限/应届/1-3年/3-5年/5+年',
  `skills_required` JSON NOT NULL COMMENT '技能标签数组',
  `description_md` MEDIUMTEXT NOT NULL COMMENT '岗位描述',
  `is_online` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '上架开关',
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '软删',
  `sort_weight` INT NOT NULL DEFAULT 0 COMMENT '运营干预权重',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_online_city` (`is_online`, `is_deleted`, `city`),
  KEY `idx_salary` (`salary_min`, `salary_max`),
  KEY `idx_degree` (`degree_required`),
  KEY `idx_experience` (`experience_required`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='岗位';

-- 4. 匹配历史表（永不删除）
CREATE TABLE IF NOT EXISTS `matches` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `resume_id` BIGINT UNSIGNED NOT NULL,
  `job_id` BIGINT UNSIGNED NOT NULL,
  `match_batch_id` VARCHAR(64) NOT NULL COMMENT '同一次匹配的批次',
  `score` TINYINT UNSIGNED NOT NULL COMMENT '0-100',
  `reason` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '一句话理由',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_resume_batch` (`user_id`, `resume_id`, `match_batch_id`),
  KEY `idx_user_created` (`user_id`, `created_at`),
  KEY `idx_batch_score` (`match_batch_id`, `score`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='匹配历史';

-- 5. 管理员表
CREATE TABLE IF NOT EXISTS `admins` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `openid` VARCHAR(64) NOT NULL,
  `note` VARCHAR(128) DEFAULT NULL COMMENT '备注',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_openid` (`openid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管理员白名单';

-- 6. Prompt 模板表
CREATE TABLE IF NOT EXISTS `prompts` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(64) NOT NULL COMMENT 'resume_generate / match_rerank',
  `name` VARCHAR(128) NOT NULL,
  `content` MEDIUMTEXT NOT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_code_active` (`code`, `is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Prompt 模板';

-- 7. 管理操作日志
CREATE TABLE IF NOT EXISTS `admin_operation_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_openid` VARCHAR(64) NOT NULL,
  `action` VARCHAR(64) NOT NULL COMMENT 'job.create / job.update / job.delete / prompt.update ...',
  `target_type` VARCHAR(32) DEFAULT NULL COMMENT 'job / prompt',
  `target_id` VARCHAR(64) DEFAULT NULL,
  `detail` JSON DEFAULT NULL,
  `ip` VARCHAR(64) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_admin_time` (`admin_openid`, `created_at`),
  KEY `idx_action_time` (`action`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管理操作日志';

-- 8. 隐私 / 服务条款 版本 (Phase 8+)
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

SET FOREIGN_KEY_CHECKS = 1;

-- 9. 迁移记录（防重复跑）
CREATE TABLE IF NOT EXISTS `schema_migrations` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(128) NOT NULL,
  `applied_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Schema migration tracking';

-- 标记已有 migration 已应用（避免 db-init 重跑时冲突）
INSERT IGNORE INTO `schema_migrations` (`name`) VALUES
  ('001-jobs-index'),
  ('002-privacy-versions'),
  ('003-audit-archive'),
  ('004-admin-audit'),
  ('005-alerts-dead-letter'),
  ('028-client-errors');

-- 004-admin-audit: admin 写操作审计（双跑安全）
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

-- 005-alerts-dead-letter: outbound webhook 死信（重试耗尽后落库）
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

-- 028-client-errors: 小程序前端运行时错误（App.onError / wx.onError / request_fail）
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
