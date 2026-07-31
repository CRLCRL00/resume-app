-- R133: MySQL 任务队列表 (异步任务支持)
-- 解决 LLM 长任务 sync timeout 问题.
-- EdgeCareer 借鉴 Inngest 异步架构, 我们自己实现轻量 MySQL 任务队列.
--
-- 流程:
--   1. API POST /api/tasks → 写 tasks 表 (status=pending) + 返回 task_id (202)
--   2. Client GET /api/tasks/:id → poll 查 status + result
--   3. Worker (PM2 cron /api/internal/tasks/worker 10s 一次) → poll pending → 跑 → update status
--
-- Retry: retry_count < 3 自动重试, > 3 标记 failed

CREATE TABLE IF NOT EXISTS tasks (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    type            VARCHAR(50) NOT NULL COMMENT 'ai_evaluate / ai_generate / ai_assist / verify_jobs',
    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
        COMMENT 'pending / running / done / failed',
    user_id         BIGINT NULL COMMENT 'openid 关联 (nullable)',
    payload         JSON NOT NULL COMMENT 'input params',
    result          JSON NULL COMMENT 'output (LLM response 等)',
    error           TEXT NULL COMMENT '失败时错误信息',
    retry_count     INT NOT NULL DEFAULT 0,
    max_retry       INT NOT NULL DEFAULT 3,
    scheduled_at    DATETIME NULL COMMENT '计划执行时间 (cron 用)',
    started_at      DATETIME NULL,
    completed_at    DATETIME NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_type_status (type, status, created_at),
    INDEX idx_user (user_id, created_at),
    INDEX idx_status_scheduled (status, scheduled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT '异步任务队列, R133 借鉴 EdgeCareer/Inngest 模式';

-- R133 task-queue migration complete