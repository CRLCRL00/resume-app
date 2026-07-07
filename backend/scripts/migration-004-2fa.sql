-- 004-2fa: admin TOTP 2FA (RFC 6238) step-up auth
ALTER TABLE admins
  ADD COLUMN `totp_secret` VARBINARY(128) DEFAULT NULL COMMENT 'TOTP base32 secret (encrypted at rest in app layer)' AFTER `note`,
  ADD COLUMN `totp_enabled` TINYINT(1) NOT NULL DEFAULT 0 AFTER `totp_secret`,
  ADD COLUMN `totp_verified_at` TIMESTAMP NULL DEFAULT NULL COMMENT 'last successful 2fa verify' AFTER `totp_enabled`,
  ADD COLUMN `backup_codes` TEXT DEFAULT NULL COMMENT 'JSON array of hashed backup codes (single-use)' AFTER `totp_verified_at`;