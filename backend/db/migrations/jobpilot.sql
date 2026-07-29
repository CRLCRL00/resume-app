-- JobPilot 数据库迁移 (R-JobSearch 重构)
--
-- 1) 加 resumes.story_points 字段 (保存 AI 生成的 STAR 故事点)
-- 2) 加 jobs.verify_status + jobs.verified_at (真实在招状态)
-- 3) 建 jobpilot_applications 表 (投递追踪)
--
-- 命名: 029-jobpilot.sql (跟现有 028 连续)
-- 执行: 通过现有 migrate.js 框架

-- ========================================
-- 1) resumes 表加 story_points 字段
-- ========================================
ALTER TABLE resumes
  ADD COLUMN story_points JSON NULL COMMENT 'AI 生成的 STAR 故事点,基于本次求职洞察:STAR > 通用简历' AFTER content_md;

-- ========================================
-- 2) jobs 表加 verify_status + verified_at 字段
-- ========================================
ALTER TABLE jobs
  ADD COLUMN verify_status VARCHAR(20) NOT NULL DEFAULT 'unverified'
    COMMENT 'verified/stale/unverified - 基于本次求职 verify 过的真实岗位' AFTER is_online,
  ADD COLUMN verified_at DATETIME NULL COMMENT '最近一次 verify 时间' AFTER verify_status;

-- 索引: 经常按 verify_status 筛
CREATE INDEX idx_jobs_verify ON jobs (verify_status, verified_at);

-- ========================================
-- 3) jobpilot_applications 表 (投递追踪)
-- ========================================
CREATE TABLE IF NOT EXISTS jobpilot_applications (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id         BIGINT NOT NULL,
    job_id          BIGINT NOT NULL,
    status          VARCHAR(30) NOT NULL DEFAULT 'submitted'
        COMMENT 'submitted/viewed/screening/interview_scheduled/interviewed/offered/rejected/withdrawn',
    note            TEXT,
    hr_contact      VARCHAR(200),
    applied_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    follow_up_at    DATETIME COMMENT '计划跟进时间 (默认 3 天后)',
    interview_at    DATETIME,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at      DATETIME,
    INDEX idx_user_status (user_id, status, deleted_at),
    INDEX idx_job (job_id),
    INDEX idx_follow_up (follow_up_at, status, deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT '投递追踪,基于本次求职洞察 #5:投递追踪 > 一次性';