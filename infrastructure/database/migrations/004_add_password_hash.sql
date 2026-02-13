-- Add password_hash column to users table for self-hosted authentication
-- Migration: 004_add_password_hash.sql

-- Add password_hash column (nullable for backward compatibility)
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);

-- Add index on password_hash for performance
CREATE INDEX IF NOT EXISTS idx_users_password_hash ON users(password_hash);

-- Add comment
COMMENT ON COLUMN users.password_hash IS 'Bcrypt hashed password for local authentication';
