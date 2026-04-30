-- Migration: 012_must_change_password.sql
-- Adds must_change_password flag and token_version for session invalidation

ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

-- token_version is included in JWT payload; bumping it invalidates all existing tokens
-- without requiring Redis or a token blacklist
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_users_must_change_password ON users(must_change_password) WHERE must_change_password = true;