-- Add password reset functionality
-- Migration: 005_add_password_reset.sql

-- Add reset_code and reset_code_expiry columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_code VARCHAR(6);
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_code_expiry TIMESTAMP WITH TIME ZONE;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_reset_code ON users(reset_code, reset_code_expiry);

-- Add comments
COMMENT ON COLUMN users.reset_code IS '6-digit password reset code';
COMMENT ON COLUMN users.reset_code_expiry IS 'Expiry timestamp for reset code (15 minutes from generation)';