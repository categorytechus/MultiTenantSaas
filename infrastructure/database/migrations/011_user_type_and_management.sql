-- Migration: 011_user_type_and_management.sql
-- Adds user_type to users table and backfills from existing RBAC roles

-- =============================================================================
-- ADD user_type COLUMN TO users TABLE
-- =============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS user_type VARCHAR(50) NOT NULL DEFAULT 'user'
  CHECK (user_type IN ('super_admin', 'org_admin', 'user'));

CREATE INDEX IF NOT EXISTS idx_users_user_type ON users(user_type);

-- =============================================================================
-- BACKFILL user_type FROM EXISTING RBAC DATA
-- =============================================================================

-- Promote users who hold the system super_admin RBAC role
UPDATE users u
SET user_type = 'super_admin'
WHERE EXISTS (
  SELECT 1 FROM user_roles ur
  JOIN roles r ON ur.role_id = r.id
  WHERE ur.user_id = u.id
    AND r.name = 'super_admin'
    AND r.is_system = true
);

-- Promote users who hold the system org_admin RBAC role (skip already-promoted super_admins)
UPDATE users u
SET user_type = 'org_admin'
WHERE u.user_type = 'user'
  AND EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = u.id
      AND r.name = 'org_admin'
      AND r.is_system = true
  );

-- Also promote users who are 'admin' in organization_members (catches legacy seed data)
UPDATE users u
SET user_type = 'org_admin'
WHERE u.user_type = 'user'
  AND EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.user_id = u.id AND om.role IN ('admin', 'org_admin')
  );
