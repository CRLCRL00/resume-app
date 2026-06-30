-- Migration 002: privacy_versions 表 (B 隐私 policy 版本)
-- Date: 2026-06-30
-- 应用：app 启动比 storage.privacy_version 与 latest, 不一致重弹 popup

CREATE TABLE IF NOT EXISTS privacy_versions (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  doc_type     ENUM('privacy', 'terms') NOT NULL,
  version      VARCHAR(32) NOT NULL,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  note         VARCHAR(255),
  UNIQUE KEY uk_doc_version (doc_type, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- seed
INSERT INTO privacy_versions (doc_type, version, note) VALUES
  ('privacy', '2026-06-29', 'phase 7 initial'),
  ('terms',   '2026-06-29', 'phase 7 initial');
