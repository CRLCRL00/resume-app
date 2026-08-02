-- 029-chat-build-sessions: 对话建简历会话表 (R-JobPilot-v2)
--
-- 对话建简历模式: AI 像面试官一样主动追问, 5-8 轮对话生成简历 JSON.
-- 支持中断恢复: 用户退出后再进入可继续上次对话.
--
-- 命名: 029-chat-build-sessions.sql (跟现有 028 连续)
-- 执行: 通过 backend/src/db/migrate.js runner 自动跑 (NNN-name.sql 规范)

CREATE TABLE IF NOT EXISTS `chat_build_sessions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL COMMENT '用户 ID (users.id)',
  `image` VARCHAR(64) NOT NULL COMMENT '画像分类: ai_collaboration_project_lead / traditional_cs_fresh / career_transition / algorithm_research',
  `recommended_rounds` INT NOT NULL COMMENT '推荐对话轮数 (基于画像)',
  `current_round` INT NOT NULL DEFAULT 0 COMMENT '当前轮数 (0 = 未开始)',
  `current_field_id` VARCHAR(128) DEFAULT NULL COMMENT '当前字段 ID (e.g. projects[0].aiCollaboration)',
  `answered_fields` JSON DEFAULT NULL COMMENT '已答字段 [{fieldId, question, answer, extractedFields}]',
  `conversation_history` JSON DEFAULT NULL COMMENT '对话历史 [{role, content, ts}]',
  `status` VARCHAR(32) NOT NULL DEFAULT 'active' COMMENT 'active / completed / abandoned',
  `result` JSON DEFAULT NULL COMMENT '最终简历 JSON (status=completed 时填充)',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `completed_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_user_status` (`user_id`, `status`),
  KEY `idx_status_updated` (`status`, `updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对话建简历会话表, R-JobPilot-v2';

-- 029-chat-build-sessions migration complete